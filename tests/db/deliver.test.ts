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

describe("xuất kho, ký nhận, hoá đơn nháp (lô 2.4) — AC-12, 13, 14, 43", () => {
  let tenant: TestTenant;
  let sales: TenantMember;
  let wh: TenantMember;
  let salesToken: string;
  let whToken: string;
  let partnerId: string;
  let whId: string;

  beforeEach(async () => {
    tenant = await createTestTenant({ role: "admin" });
    sales = await addTenantMember(tenant.tenantId, "sales");
    wh = await addTenantMember(tenant.tenantId, "warehouse");
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    partnerId = await createPartner(tenant.tenantId, "KH1");
    whId = await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    await sales?.cleanup();
    await wh?.cleanup();
    await tenant?.cleanup();
  });

  const stock = (itemId: string, qty: number, extra: { lot?: string } = {}) =>
    sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost, lot_no)
        values (${tenant.tenantId}, ${itemId}, ${whId}, ${qty}, 500000, ${extra.lot ?? null})`;
  const onHandOf = async (itemId: string) =>
    Number((await sql`select coalesce(sum(qty),0) v from stock_moves where tenant_id = ${tenant.tenantId} and item_id = ${itemId}`)[0].v);

  async function draftOrder(itemId: string, qty: number, price = 1_000_000) {
    const q = await post("/api/quotes", salesToken, { partnerId, lines: [{ itemId, qty, price }] }, idem());
    expect(q.json.ok, JSON.stringify(q.json)).toBe(true);
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    expect(o.json.ok, JSON.stringify(o.json)).toBe(true);
    return o.json.data.id as string;
  }
  async function confirmedOrder(itemId: string, qty: number) {
    const id = await draftOrder(itemId, qty);
    const c = await post("/api/orders/confirm", salesToken, { orderId: id });
    expect(c.json.data.status, JSON.stringify(c.json)).toBe("confirmed");
    return id;
  }
  const deliver = (orderId: string, lines: unknown[], extra: Record<string, unknown> = {}) =>
    post("/api/orders/deliver", whToken, { orderId, lines, ...extra }, idem());
  const status = async (id: string) => (await sql`select status, meta from documents where id = ${id}`)[0];

  it("AC-12 xuất theo lô: tồn + lô giảm, giá vốn 632/156, phiếu xuất done, ĐÚNG 1 hoá đơn nháp đúng dòng đã giao, kế toán nhận việc", async () => {
    const x = await createItem(tenant.tenantId, "XL", { price: 1_000_000, cost: 500_000, tracking: "lot" });
    await stock(x, 10, { lot: "L1" });
    const o = await confirmedOrder(x, 4);

    const d = await deliver(o, [{ lineNo: 1, qty: 4, lots: [{ lotNo: "L1", qty: 4 }] }], { signedBy: "Anh Bình", date: "2026-09-19" });
    expect(d.json.ok, JSON.stringify(d.json)).toBe(true);
    expect(d.json.data.deliveredAll).toBe(true);

    expect(await onHandOf(x)).toBe(6);
    const [lot] = await sql`select sum(qty) v from stock_moves where item_id = ${x} and lot_no = 'L1'`;
    expect(Number(lot.v)).toBe(6);

    const jl = await sql`select l.account_code, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
                         where e.document_id = ${d.json.data.doId} order by l.account_code`;
    expect(jl.map((r) => [r.account_code, Number(r.debit), Number(r.credit)])).toEqual([
      ["156", 0, 2_000_000],
      ["632", 2_000_000, 0],
    ]);

    const [dO] = await sql`select status, meta from documents where id = ${d.json.data.doId}`;
    expect(dO.status).toBe("done");
    expect(dO.meta.signedBy).toBe("Anh Bình");

    const invs = await sql`select d.id, d.status, d.meta from documents d where d.doc_type = 'INV' and d.meta->>'soId' = ${o}`;
    expect(invs).toHaveLength(1);
    expect(invs[0].status).toBe("draft");
    expect(invs[0].meta.deliverDate).toBe("2026-09-19");
    const invLines = await sql`select qty, price from document_lines where document_id = ${invs[0].id}`;
    expect(invLines.map((r) => [Number(r.qty), Number(r.price)])).toEqual([[4, 1_000_000]]);

    const so = await status(o);
    expect(so.meta.deliveredAll).toBe(true);
    const [{ n }] = await sql`select count(*)::int n from tasks where document_id = ${invs[0].id} and role = 'accountant'`;
    expect(n).toBe(1);
  });

  it("AC-13 đơn nháp -> state_invalid, không phiếu xuất, tồn không đổi", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    await stock(x, 10);
    const o = await draftOrder(x, 2);
    const d = await deliver(o, [{ lineNo: 1, qty: 2 }]);
    expect(d.json.error.code).toBe("state_invalid");
    expect(await onHandOf(x)).toBe(10);
    const [{ n }] = await sql`select count(*)::int n from documents where tenant_id = ${tenant.tenantId} and doc_type = 'DO'`;
    expect(n).toBe(0);
  });

  it("AC-14 giao 6/10 -> giao một phần, hoá đơn 6, còn giữ 4; giao nốt -> giao đủ, hết giữ", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    await stock(x, 10);
    const o = await confirmedOrder(x, 10);

    const d1 = await deliver(o, [{ lineNo: 1, qty: 6 }]);
    expect(d1.json.ok, JSON.stringify(d1.json)).toBe(true);
    expect(d1.json.data.deliveredAll).toBe(false);
    expect((await status(o)).status).toBe("partial");
    const [inv] = await sql`select l.qty from documents d join document_lines l on l.document_id = d.id where d.id = ${d1.json.data.invId}`;
    expect(Number(inv.qty)).toBe(6);
    const [held] = await sql`select qty from reservations where document_id = ${o}`;
    expect(Number(held.qty)).toBe(4);

    const over = await deliver(o, [{ lineNo: 1, qty: 5 }]); // vượt số đang giữ
    expect(over.json.error.code).toBe("state_invalid");

    const d2 = await deliver(o, [{ lineNo: 1, qty: 4 }]);
    expect(d2.json.data.deliveredAll).toBe(true);
    expect(await sql`select 1 from reservations where document_id = ${o}`).toHaveLength(0);
    expect(await onHandOf(x)).toBe(0);
  });

  it("AC-43 xuất 2 thùng (1 thùng = 12 cái) -> tồn 30 - 24 = 6; đơn vị lạ -> invalid_argument", async () => {
    const x = await createItem(tenant.tenantId, "XU", { price: 100_000, cost: 50_000 });
    await sql`update items set uom_factors = '{"thùng": 12}'::jsonb where id = ${x}`;
    await stock(x, 30);
    const o = await confirmedOrder(x, 24);
    const bad = await deliver(o, [{ lineNo: 1, qty: 1, uom: "pallet" }]);
    expect(bad.json.error.code).toBe("invalid_argument");
    const ok = await deliver(o, [{ lineNo: 1, qty: 2, uom: "thùng" }]);
    expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    expect(await onHandOf(x)).toBe(6);
  });

  it("hàng serial phải khai đủ số serial; kỳ đã khoá -> period_locked; cùng Idempotency-Key -> 1 phiếu xuất", async () => {
    const s1 = await createItem(tenant.tenantId, "XS", { price: 1_000_000, cost: 500_000, tracking: "serial" });
    await stock(s1, 2);
    const o = await confirmedOrder(s1, 2);
    const missing = await deliver(o, [{ lineNo: 1, qty: 2, serials: ["SN1"] }]);
    expect(missing.json.error.code).toBe("invalid_argument");

    await sql`insert into periods (tenant_id, ym, status) values (${tenant.tenantId}, '2026-01', 'locked')`;
    const locked = await deliver(o, [{ lineNo: 1, qty: 2, serials: ["SN1", "SN2"] }], { date: "2026-01-15" });
    expect(locked.json.error.code).toBe("period_locked");

    const key = { "idempotency-key": randomUUID() };
    const body = { orderId: o, lines: [{ lineNo: 1, qty: 2, serials: ["SN1", "SN2"] }] };
    const a = await post("/api/orders/deliver", whToken, body, key);
    const b = await post("/api/orders/deliver", whToken, body, key);
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    expect(b.json.data.doId).toBe(a.json.data.doId);
    const [{ n }] = await sql`select count(*)::int n from documents where tenant_id = ${tenant.tenantId} and doc_type = 'DO'`;
    expect(n).toBe(1);
    const sn = await sql`select serial_no from stock_moves where item_id = ${s1} and qty < 0 order by serial_no`;
    expect(sn.map((r) => r.serial_no)).toEqual(["SN1", "SN2"]);
  });
});
