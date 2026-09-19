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

describe("nhận hàng theo đơn mua (lô 3.2) — AC-11, AC-21", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let buyerToken: string;
  let leadToken: string;
  let whToken: string;
  let salesToken: string;
  let supplierId: string;
  let customerId: string;
  let mainWh: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const buyer = await addTenantMember(tenant.tenantId, "purchasing");
    const lead = await addTenantMember(tenant.tenantId, "dept_lead");
    const wh = await addTenantMember(tenant.tenantId, "warehouse");
    const sales = await addTenantMember(tenant.tenantId, "sales");
    members.push(buyer, lead, wh, sales);
    buyerToken = (await buyer.signIn()).accessToken;
    leadToken = (await lead.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    salesToken = (await sales.signIn()).accessToken;
    supplierId = await createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    customerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    mainWh = await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  /** Đơn mua đã xác nhận (mua hàng lập + xác nhận, trưởng bộ phận duyệt). Tổng ≤ ngưỡng nên chỉ 1 cấp duyệt. */
  async function confirmedPo(itemId: string, qty: number, price: number) {
    const po = await post("/api/purchase/orders", buyerToken, { supplierId, lines: [{ itemId, qty, price }] }, idem());
    expect(po.json.ok, JSON.stringify(po.json)).toBe(true);
    const id = po.json.data.id as string;
    await post("/api/purchase/orders/confirm", buyerToken, { poId: id });
    const ok = await post("/api/approvals/decide", leadToken, { docId: id, decision: "approve" });
    expect(ok.json.data.status, JSON.stringify(ok.json)).toBe("confirmed");
    return id;
  }
  const receive = (poId: string, lines: unknown[], extra: Record<string, unknown> = {}) =>
    post("/api/purchase/receive", whToken, { poId, lines, ...extra }, idem());
  const onHandOf = async (itemId: string) =>
    Number((await sql`select coalesce(sum(m.qty),0) v from stock_moves m join warehouses w on w.id = m.warehouse_id where m.tenant_id = ${tenant.tenantId} and m.item_id = ${itemId} and w.code <> 'QC'`)[0].v);
  const poRow = async (id: string) => (await sql`select status, meta, refs from documents where id = ${id}`)[0];
  const availableOf = async (itemId: string) =>
    Number((await sql`select available from v_available where tenant_id = ${tenant.tenantId} and item_id = ${itemId}`)[0]?.available ?? 0);

  it("AC-21 đơn 100, dung sai 2%: nhận 95 (đợt cuối) -> nhập 95, phiếu ghi lệch -5, mua hàng nhận 1 việc, bút toán 156/331 = giá PO", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 100, 10_000);
    const r = await receive(po, [{ lineNo: 1, qty: 95 }], { final: true });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("done");
    expect(await onHandOf(x)).toBe(95);

    const [grn] = await sql`select id, meta from documents where id = ${r.json.data.id}`;
    expect(grn.meta.variance).toHaveLength(1);
    expect(grn.meta.variance[0].diff).toBe(-5);
    const [{ n }] = await sql`select count(*)::int n from tasks where document_id = ${grn.id} and role = 'purchasing' and not done`;
    expect(n).toBe(1);

    const jl = await sql`select l.account_code c, l.debit d, l.credit k from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${grn.id} order by l.account_code`;
    expect(jl.map((x2) => [x2.c, Number(x2.d), Number(x2.k)])).toEqual([
      ["156", 950_000, 0],
      ["331", 0, 950_000],
    ]);
    const p = await poRow(po);
    expect(p.status).toBe("partial");
    expect(p.meta.closedShort).toBe(true);
  });

  it("nhận thiếu nhưng CHƯA phải đợt cuối: không báo lệch (còn giao tiếp); nhận đủ 2 đợt -> đủ, không việc lệch", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 100, 10_000);
    const r1 = await receive(po, [{ lineNo: 1, qty: 60 }]);
    expect(r1.json.ok).toBe(true);
    expect((await sql`select 1 from tasks where document_id = ${r1.json.data.id}`).length).toBe(0);
    expect((await poRow(po)).status).toBe("partial");

    const r2 = await receive(po, [{ lineNo: 1, qty: 40 }]);
    expect(r2.json.ok).toBe(true);
    const p = await poRow(po);
    expect(p.meta.receivedAll).toBe(true);
    expect(p.refs).toHaveLength(2);
    expect(await onHandOf(x)).toBe(100);
    const [{ received }] = await sql`select (meta->>'received')::numeric as received from document_lines where document_id = ${po}`;
    expect(Number(received)).toBe(100);
  });

  it("AC-11 đơn bán thiếu 1 X, yêu cầu mua đã thành đơn mua: nhập 1 X -> giữ cho đơn gốc, khả dụng KHÔNG tăng", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    const q = await post("/api/quotes", salesToken, { partnerId: customerId, lines: [{ itemId: x, qty: 1, price: 1_000_000 }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    const soId = o.json.data.id as string;
    const [pr] = await sql`select id from documents where tenant_id = ${tenant.tenantId} and doc_type = 'PR' and meta->>'forSO' = ${soId}`;

    const po = await post("/api/purchase/orders", buyerToken, { supplierId, fromPrId: pr.id }, idem());
    await post("/api/purchase/orders/confirm", buyerToken, { poId: po.json.data.id });
    await post("/api/approvals/decide", leadToken, { docId: po.json.data.id, decision: "approve" });

    const before = await availableOf(x); // chưa có tồn
    const r = await receive(po.json.data.id as string, [{ lineNo: 1, qty: 1 }]);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const [held] = await sql`select coalesce(sum(qty),0) v from reservations where document_id = ${soId} and item_id = ${x}`;
    expect(Number(held.v)).toBe(1);
    expect(await onHandOf(x)).toBe(1);
    expect(await availableOf(x)).toBe(before);
    expect(await availableOf(x)).toBe(0);
  });

  it("hàng cần kiểm vào kho QC (không tính khả dụng) -> pass-qc chuyển kho chính; chuyển 2 lần -> state_invalid", async () => {
    await createWarehouse(tenant.tenantId, "QC");
    const x = await createItem(tenant.tenantId, "XQ", { price: 12_000, cost: 10_000 });
    await sql`update items set inspect = true where id = ${x}`;
    const po = await confirmedPo(x, 10, 10_000);
    const r = await receive(po, [{ lineNo: 1, qty: 10 }]);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(await onHandOf(x)).toBe(0);
    expect(await availableOf(x)).toBe(0);
    const [qc] = await sql`select coalesce(sum(m.qty),0) v from stock_moves m join warehouses w on w.id = m.warehouse_id where m.item_id = ${x} and w.code = 'QC'`;
    expect(Number(qc.v)).toBe(10);

    const denied = await post("/api/purchase/pass-qc", salesToken, { grnId: r.json.data.id }, idem());
    expect(denied.json.error.code).toBe("forbidden");
    const pass = await post("/api/purchase/pass-qc", whToken, { grnId: r.json.data.id }, idem());
    expect(pass.json.ok, JSON.stringify(pass.json)).toBe(true);
    expect(await onHandOf(x)).toBe(10);
    expect(await availableOf(x)).toBe(10);
    const [qc2] = await sql`select coalesce(sum(m.qty),0) v from stock_moves m join warehouses w on w.id = m.warehouse_id where m.item_id = ${x} and w.code = 'QC'`;
    expect(Number(qc2.v)).toBe(0);
    const again = await post("/api/purchase/pass-qc", whToken, { grnId: r.json.data.id }, idem());
    expect(again.json.error.code).toBe("state_invalid");
    void mainWh;
  });

  it("vật tư ghi 152; hàng serial phải khai đủ serial; đơn chưa xác nhận / kỳ khoá / cùng Idempotency-Key", async () => {
    const mat = await createItem(tenant.tenantId, "VT", { price: 5_000, cost: 4_000, kind: "material" });
    const po1 = await confirmedPo(mat, 10, 4_000);
    const g = await receive(po1, [{ lineNo: 1, qty: 10 }]);
    const jl = await sql`select l.account_code c from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${g.json.data.id} and l.debit > 0`;
    expect(jl.map((x) => x.c)).toEqual(["152"]);

    const ser = await createItem(tenant.tenantId, "SR", { price: 5_000, cost: 4_000, tracking: "serial" });
    const po2 = await confirmedPo(ser, 2, 4_000);
    const bad = await receive(po2, [{ lineNo: 1, qty: 2, serials: ["A1"] }]);
    expect(bad.json.error.code).toBe("invalid_argument");
    const key = { "idempotency-key": randomUUID() };
    const body = { poId: po2, lines: [{ lineNo: 1, qty: 2, serials: ["A1", "A2"] }] };
    const a = await post("/api/purchase/receive", whToken, body, key);
    const b = await post("/api/purchase/receive", whToken, body, key);
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    expect(b.json.data.id).toBe(a.json.data.id);
    expect((await sql`select 1 from documents where tenant_id = ${tenant.tenantId} and doc_type = 'GRN' and meta->>'poId' = ${po2}`).length).toBe(1);

    const draft = await post("/api/purchase/orders", buyerToken, { supplierId, lines: [{ itemId: mat, qty: 1, price: 1 }] }, idem());
    const notYet = await receive(draft.json.data.id, [{ lineNo: 1, qty: 1 }]);
    expect(notYet.json.error.code).toBe("state_invalid");

    await sql`insert into periods (tenant_id, ym, status) values (${tenant.tenantId}, '2026-01', 'locked')`;
    const po3 = await confirmedPo(mat, 1, 4_000);
    const locked = await receive(po3, [{ lineNo: 1, qty: 1 }], { date: "2026-01-10" });
    expect(locked.json.error.code).toBe("period_locked");
  });
});
