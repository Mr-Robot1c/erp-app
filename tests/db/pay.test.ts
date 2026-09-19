import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createItem, createPartner, createTestTenant, createWarehouse, sql, type TenantMember, type TestTenant } from "./helper";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const idem = () => ({ "idempotency-key": randomUUID() });

describe("trả nhà cung cấp (lô 3.4) — AC-24", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let adminToken: string;
  let accToken: string;
  let chiefToken: string;
  let chiefMember: TenantMember;
  let directorToken: string;
  let buyerToken: string;
  let leadToken: string;
  let whToken: string;
  let supplierId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const [acc, chief, director, buyer, lead, wh] = await Promise.all(
      (["accountant", "chief_accountant", "director", "purchasing", "dept_lead", "warehouse"] as const).map((r) => addTenantMember(tenant.tenantId, r)),
    );
    members.push(acc, chief, director, buyer, lead, wh);
    chiefMember = chief;
    adminToken = (await tenant.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    chiefToken = (await chief.signIn()).accessToken;
    directorToken = (await director.signIn()).accessToken;
    buyerToken = (await buyer.signIn()).accessToken;
    leadToken = (await lead.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    supplierId = await createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  /** Khoản phải trả dựng thẳng (sổ phụ) — đủ để kiểm phân bổ; luồng thật từ hoá đơn mua có ca riêng bên dưới. */
  async function payable(amount: number, due: string) {
    const [row] = await sql`insert into payables (tenant_id, partner_id, amount, due_date) values (${tenant.tenantId}, ${supplierId}, ${amount}, ${due}) returning id`;
    return row.id as string;
  }
  const pay = (token: string, amount: number, extra: Record<string, unknown> = {}) =>
    post("/api/purchase/pay", token, { supplierId, amount, method: "bank", ...extra }, idem());
  const payableRows = async () =>
    (await sql`select id, amount, paid from payables where tenant_id = ${tenant.tenantId} order by due_date`).map((p) => ({ id: p.id as string, amount: Number(p.amount), paid: Number(p.paid) }));
  const allocSum = async () => Number((await sql`select coalesce(sum(amount),0) v from payment_allocations where tenant_id = ${tenant.tenantId}`)[0].v);

  it("AC-24 3 khoản đến hạn tổng 50tr, ngưỡng 20tr: lập phiếu chi -> chờ kế toán trưởng; duyệt -> 3 khoản trả đủ, Σ phân bổ 50tr, khớp giao dịch ngân hàng", async () => {
    await payable(20_000_000, "2026-10-01");
    await payable(15_000_000, "2026-10-05");
    await payable(15_000_000, "2026-10-10");

    const r = await pay(accToken, 50_000_000, { bankRef: "BK-24" });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("pending");
    expect(r.json.data.meta.chain).toEqual(["chief_accountant"]);
    const id = r.json.data.id as string;
    // Chưa chi thật: chưa phân bổ, chưa bút toán, chưa ghi giao dịch ngân hàng.
    expect(await allocSum()).toBe(0);
    expect((await sql`select 1 from journal_entries where document_id = ${id}`).length).toBe(0);
    expect((await sql`select 1 from bank_txns where tenant_id = ${tenant.tenantId} and bank_ref = 'BK-24'`).length).toBe(0);

    const wrong = await post("/api/approvals/decide", accToken, { docId: id, decision: "approve" });
    expect(wrong.json.error.code).toBe("forbidden"); // người lập không tự duyệt

    const ok = await post("/api/approvals/decide", chiefToken, { docId: id, decision: "approve" });
    expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    expect(ok.json.data.status).toBe("done");
    expect((await payableRows()).every((p) => p.paid === p.amount)).toBe(true);
    expect(await allocSum()).toBe(50_000_000);
    const [tx1] = await sql`select receipt_id from bank_txns where tenant_id = ${tenant.tenantId} and bank_ref = 'BK-24'`;
    expect(tx1.receipt_id).toBe(id);
    const jl = await sql`select l.account_code c, l.debit d, l.credit k from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${id} order by l.account_code`;
    expect(jl.map((x) => [x.c, Number(x.d), Number(x.k)])).toEqual([["112", 0, 50_000_000], ["331", 50_000_000, 0]]);
    expect((await sql`select 1 from tasks where document_id = ${id} and not done`).length).toBe(0);
  });

  it("≤ ngưỡng: chi ngay, phân bổ theo hạn tăng dần (khoản sớm nhất trước), trả một phần được", async () => {
    await payable(6_000_000, "2026-10-10");
    await payable(8_000_000, "2026-10-01");
    const r = await pay(accToken, 10_000_000, { method: "cash" });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("done");
    const rows = await payableRows(); // theo hạn: 10/01 (8tr) rồi 10/10 (6tr)
    expect(rows.map((p) => p.paid)).toEqual([8_000_000, 2_000_000]);
    expect(await allocSum()).toBe(10_000_000);
    const [line] = await sql`select l.account_code c from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${r.json.data.id} and l.credit > 0`;
    expect(line.c).toBe("111");
  });

  it("vượt tổng nợ phải trả -> invalid_argument, không tạo phiếu chi", async () => {
    await payable(5_000_000, "2026-10-01");
    const r = await pay(accToken, 5_000_001);
    expect(r.json.error.code).toBe("invalid_argument");
    expect((await sql`select 1 from documents where tenant_id = ${tenant.tenantId} and doc_type = 'PAY'`).length).toBe(0);
    expect((await payableRows())[0].paid).toBe(0);
  });

  it("trùng mã giao dịch ngân hàng -> duplicate; idempotency-key gửi lại không chi 2 lần", async () => {
    await payable(9_000_000, "2026-10-01");
    const key = randomUUID();
    const body = { supplierId, amount: 4_000_000, method: "bank", bankRef: "BK-DUP" };
    const a = await post("/api/purchase/pay", accToken, body, { "idempotency-key": key });
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    const replay = await post("/api/purchase/pay", accToken, body, { "idempotency-key": key });
    expect(replay.json.data.id).toBe(a.json.data.id);
    expect((await payableRows())[0].paid).toBe(4_000_000);
    const dup = await pay(accToken, 1_000_000, { bankRef: "BK-DUP" });
    expect(dup.json.error.code).toBe("duplicate");
  });

  it("kế toán trưởng tự lập khoản lớn -> chuỗi lên giám đốc (không tự duyệt); từ chối -> huỷ, không chi", async () => {
    await payable(30_000_000, "2026-10-01");
    const r = await pay(chiefToken, 25_000_000);
    expect(r.json.data.meta.chain).toEqual(["director"]);
    const self = await post("/api/approvals/decide", chiefToken, { docId: r.json.data.id, decision: "approve" });
    expect(self.json.error.code).toBe("forbidden");
    const rej = await post("/api/approvals/decide", directorToken, { docId: r.json.data.id, decision: "reject", reason: "Chưa đến hạn" });
    expect(rej.json.data.status).toBe("cancelled");
    expect((await payableRows())[0].paid).toBe(0);
    expect(await allocSum()).toBe(0);
    void chiefMember;
  });

  it("luồng thật: đơn mua -> nhập kho -> hoá đơn mua -> trả tiền -> khoản phải trả hết nợ, 331 về 0", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await post("/api/purchase/orders", buyerToken, { supplierId, lines: [{ itemId: x, qty: 10, price: 10_000 }] }, idem());
    await post("/api/purchase/orders/confirm", buyerToken, { poId: po.json.data.id });
    await post("/api/approvals/decide", leadToken, { docId: po.json.data.id, decision: "approve" });
    const rcv = await post("/api/purchase/receive", whToken, { poId: po.json.data.id, lines: [{ lineNo: 1, qty: 10 }] }, idem());
    expect(rcv.json.ok, JSON.stringify(rcv.json)).toBe(true);
    const inv = await post("/api/purchase/vendor-invoice", accToken, { poId: po.json.data.id, invoiceNo: "HD-P", lines: [{ lineNo: 1, qty: 10, price: 10_000 }] }, idem());
    expect(inv.json.ok, JSON.stringify(inv.json)).toBe(true);
    const total = Number(inv.json.data.meta.total); // 100.000 + thuế 10% = 110.000
    expect(total).toBe(110_000);
    const r = await pay(accToken, total);
    expect(r.json.data.status).toBe("done");
    const [p] = await payableRows();
    expect(p.paid).toBe(p.amount);
    // GRN Có 331 100.000 + VINV Có 331 10.000 (thuế) − chi Nợ 331 110.000 = 0
    const [{ bal }] = await sql`select coalesce(sum(credit - debit),0) bal from journal_lines where tenant_id = ${tenant.tenantId} and account_code = '331'`;
    expect(Number(bal)).toBe(0);
    void adminToken;
  });
});
