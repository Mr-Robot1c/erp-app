import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTenantMember,
  apiUrl,
  createItem,
  createPartner,
  createTestTenant,
  createWarehouse,
  sql,
  type TenantMember,
  type TestTenant,
} from "./helper";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const idem = () => ({ "idempotency-key": randomUUID() });

describe("giữ tồn + tự sinh yêu cầu mua/lệnh SX (lô 2.3) — AC-10", () => {
  let tenant: TestTenant;
  let sales: TenantMember;
  let warehouse: TenantMember;
  let salesToken: string;
  let whToken: string;
  let partnerId: string;
  let whId: string;

  beforeEach(async () => {
    tenant = await createTestTenant({ role: "admin" });
    sales = await addTenantMember(tenant.tenantId, "sales");
    warehouse = await addTenantMember(tenant.tenantId, "warehouse");
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await warehouse.signIn()).accessToken;
    partnerId = await createPartner(tenant.tenantId, "KH1");
    whId = await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    await sales?.cleanup();
    await warehouse?.cleanup();
    await tenant?.cleanup();
  });

  const stock = (itemId: string, qty: number) =>
    sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${whId}, ${qty}, 100)`;

  /** Đơn bán đã xác nhận (giá = giá bảng, tiền mặt) gồm các dòng {item, qty}. */
  async function confirmedOrder(lines: { itemId: string; qty: number; price: number }[]) {
    const q = await post("/api/quotes", salesToken, { partnerId, lines }, idem());
    expect(q.json.ok, JSON.stringify(q.json)).toBe(true);
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    expect(o.json.ok, JSON.stringify(o.json)).toBe(true);
    const id = o.json.data.id as string;
    const c = await post("/api/orders/confirm", salesToken, { orderId: id });
    expect(c.json.data.status).toBe("confirmed");
    return id;
  }
  const reservedFor = async (orderId: string, itemId: string) =>
    Number((await sql`select coalesce(sum(qty),0) v from reservations where document_id = ${orderId} and item_id = ${itemId}`)[0].v);
  const prsFor = (orderId: string) =>
    sql`select d.id, l.qty, l.item_id from documents d join document_lines l on l.document_id = d.id
        where d.doc_type = 'PR' and d.meta->>'forSO' = ${orderId} and d.status = 'confirmed'`;
  const availableOf = async (itemId: string) =>
    Number((await sql`select available from v_available where tenant_id = ${tenant.tenantId} and item_id = ${itemId}`)[0]?.available ?? 0);

  it("AC-10 kho 3, đang giữ 2, đơn cần 2 -> giữ 1, yêu cầu mua 1 gắn đơn, khả dụng 0", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    await stock(x, 3);
    const a = await confirmedOrder([{ itemId: x, qty: 2, price: 1_000_000 }]);
    expect(await reservedFor(a, x)).toBe(2);
    expect(await prsFor(a)).toHaveLength(0);

    const b = await confirmedOrder([{ itemId: x, qty: 2, price: 1_000_000 }]);
    expect(await reservedFor(b, x)).toBe(1);
    const prs = await prsFor(b);
    expect(prs).toHaveLength(1);
    expect(Number(prs[0].qty)).toBe(1);
    expect(await availableOf(x)).toBe(0);
    const [{ n }] = await sql`select count(*)::int n from tasks where role = 'purchasing' and document_id = ${prs[0].id} and not done`;
    expect(n).toBe(1);
    const [so] = await sql`select refs from documents where id = ${b}`;
    expect(so.refs).toHaveLength(2); // báo giá gốc + PR tự sinh (tham chiếu 2 chiều)
  });

  it("song song: khả dụng còn 1, 2 đơn cùng xác nhận -> tổng giữ = 1, chỉ 1 đơn có yêu cầu mua", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    await stock(x, 1);
    // Tạo sẵn 2 đơn nháp, rồi xác nhận đồng thời.
    const draft = async () => {
      const q = await post("/api/quotes", salesToken, { partnerId, lines: [{ itemId: x, qty: 1, price: 1_000_000 }] }, idem());
      await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
      const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
      return o.json.data.id as string;
    };
    const [a, b] = [await draft(), await draft()];
    const [ra, rb] = await Promise.all([
      post("/api/orders/confirm", salesToken, { orderId: a }),
      post("/api/orders/confirm", salesToken, { orderId: b }),
    ]);
    expect(ra.json.ok && rb.json.ok, JSON.stringify([ra.json, rb.json])).toBe(true);
    const [{ total }] = await sql`select coalesce(sum(qty),0) total from reservations where tenant_id = ${tenant.tenantId} and item_id = ${x}`;
    expect(Number(total)).toBe(1);
    const prCount = (await prsFor(a)).length + (await prsFor(b)).length;
    expect(prCount).toBe(1);
  });

  it("thành phẩm thiếu -> lệnh sản xuất (MO) + việc cho kho/xưởng; dịch vụ không giữ tồn, không sinh yêu cầu", async () => {
    const fin = await createItem(tenant.tenantId, "TP", { price: 2_000_000, cost: 1_000_000, kind: "finished" });
    const svc = await createItem(tenant.tenantId, "DV", { price: 500_000, kind: "service" });
    const o = await confirmedOrder([
      { itemId: fin, qty: 2, price: 2_000_000 },
      { itemId: svc, qty: 1, price: 500_000 },
    ]);
    expect(await reservedFor(o, fin)).toBe(0);
    expect(await reservedFor(o, svc)).toBe(0);
    const mos = await sql`select d.id, l.qty from documents d join document_lines l on l.document_id = d.id
                          where d.doc_type = 'MO' and d.meta->>'forSO' = ${o} and d.status = 'confirmed'`;
    expect(mos).toHaveLength(1);
    expect(Number(mos[0].qty)).toBe(2);
    expect(await prsFor(o)).toHaveLength(0);
  });

  it("đáp ứng lại: không sinh trùng yêu cầu mua; có hàng rồi thì giữ đủ; chỉ kho/admin gọi được", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    const o = await confirmedOrder([{ itemId: x, qty: 3, price: 1_000_000 }]); // kho 0 -> PR 3
    expect(await prsFor(o)).toHaveLength(1);

    const denied = await post("/api/orders/refulfil", salesToken, { orderId: o });
    expect(denied.json.error.code).toBe("forbidden");

    const again = await post("/api/orders/refulfil", whToken, { orderId: o });
    expect(again.json.ok, JSON.stringify(again.json)).toBe(true);
    expect(await prsFor(o)).toHaveLength(1); // yêu cầu cũ còn mở -> không sinh thêm

    await stock(x, 5); // hàng về
    const filled = await post("/api/orders/refulfil", whToken, { orderId: o });
    expect(filled.json.ok).toBe(true);
    expect(await reservedFor(o, x)).toBe(3);
  });
});
