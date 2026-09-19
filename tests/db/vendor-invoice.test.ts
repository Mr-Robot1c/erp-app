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

describe("hoá đơn mua, khớp ba bên (lô 3.3) — AC-22, AC-23", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let adminToken: string;
  let buyerToken: string;
  let leadToken: string;
  let whToken: string;
  let accToken: string;
  let chiefToken: string;
  let supplierId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const [buyer, lead, wh, acc, chief] = await Promise.all(
      (["purchasing", "dept_lead", "warehouse", "accountant", "chief_accountant"] as const).map((r) => addTenantMember(tenant.tenantId, r)),
    );
    members.push(buyer, lead, wh, acc, chief);
    adminToken = (await tenant.signIn()).accessToken;
    buyerToken = (await buyer.signIn()).accessToken;
    leadToken = (await lead.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    chiefToken = (await chief.signIn()).accessToken;
    supplierId = await createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  async function confirmedPo(itemId: string, qty: number, price: number) {
    const po = await post("/api/purchase/orders", buyerToken, { supplierId, lines: [{ itemId, qty, price }] }, idem());
    expect(po.json.ok, JSON.stringify(po.json)).toBe(true);
    const id = po.json.data.id as string;
    await post("/api/purchase/orders/confirm", buyerToken, { poId: id });
    const ok = await post("/api/approvals/decide", leadToken, { docId: id, decision: "approve" });
    expect(ok.json.data.status, JSON.stringify(ok.json)).toBe("confirmed");
    return id;
  }
  const receive = async (poId: string, qty: number) => {
    const r = await post("/api/purchase/receive", whToken, { poId, lines: [{ lineNo: 1, qty }] }, idem());
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    return r.json.data.id as string;
  };
  const vinv = (token: string, poId: string, invoiceNo: string, lines: unknown[], extra: Record<string, unknown> = {}) =>
    post("/api/purchase/vendor-invoice", token, { poId, invoiceNo, lines, ...extra }, idem());
  const payablesOf = async () =>
    (await sql`select id, amount, paid, due_date::text as due_date from payables where tenant_id = ${tenant.tenantId} order by created_at`).map((p) => ({ ...p, amount: Number(p.amount), paid: Number(p.paid) }));
  const linesOf = async (docId: string) =>
    (await sql`select l.account_code c, l.debit d, l.credit k from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${docId} order by l.account_code`).map(
      (x) => [x.c as string, Number(x.d), Number(x.k)],
    );
  const sumAcc = async (acc: string, side: "debit" | "credit") =>
    Number((await sql`select coalesce(sum(${sql(side)}),0) v from journal_lines where tenant_id = ${tenant.tenantId} and account_code = ${acc}`)[0].v);

  it("AC-22 đơn 100×10.000, nhập 100, dung sai 1%: hoá đơn 100×10.050 không thuế -> phải trả 1.005.000, không cần duyệt, giá vốn điều chỉnh 5.000, Σ Có 331 = phải trả", async () => {
    await post("/api/tenant/settings", adminToken, { expThreshold: 10_000_000, poThreshold: 20_000_000, tolerancePct: 1, terms: 30 });
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 100, 10_000);
    await receive(po, 100);

    const r = await vinv(accToken, po, "HD-001", [{ lineNo: 1, qty: 100, price: 10_050, taxPct: 0 }], { date: "2026-03-10" });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("done");
    expect(r.json.data.meta.cogsAdjustment).toBe(5_000);

    const p = await payablesOf();
    expect(p).toHaveLength(1);
    expect(p[0].amount).toBe(1_005_000);
    expect(String(p[0].due_date)).toContain("2026-04-09"); // ngày + 30
    expect((await sql`select 1 from documents where tenant_id = ${tenant.tenantId} and doc_type = 'VINV' and status = 'pending'`).length).toBe(0);
    expect(await linesOf(r.json.data.id)).toEqual([["156", 5_000, 0], ["331", 0, 5_000]]);

    // Chứng minh không ghi Có 331 hai lần: Σ Có 331 (GRN + VINV) = payable; tổng Nợ 156 = 1.005.000.
    expect(await sumAcc("331", "credit")).toBe(p[0].amount);
    expect(await sumAcc("156", "debit")).toBe(1_005_000);
    const [pl] = await sql`select meta from document_lines where document_id = ${po} and line_no = 1`;
    expect(pl.meta.invoiced).toBe(100);
  });

  it("ví dụ CÓ thuế: đơn 1.000.000, hoá đơn 1.005.000 + VAT 10% -> Nợ 156 5.000, Nợ 133 100.500 / Có 331 105.500, phải trả 1.105.500", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 2_000_000, cost: 1_000_000 });
    const po = await confirmedPo(x, 1, 1_000_000);
    await receive(po, 1);
    const r = await vinv(accToken, po, "HD-VAT", [{ lineNo: 1, qty: 1, price: 1_005_000 }]);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("done");
    expect(await linesOf(r.json.data.id)).toEqual([["133", 100_500, 0], ["156", 5_000, 0], ["331", 0, 105_500]]);
    const p = await payablesOf();
    expect(p[0].amount).toBe(1_105_500);
    expect(await sumAcc("331", "credit")).toBe(p[0].amount);
  });

  it("AC-23 chưa nhập hàng mà ghi hoá đơn -> state_invalid, không có khoản phải trả, không có hoá đơn mua", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 100, 10_000);
    const r = await vinv(accToken, po, "HD-SOM", [{ lineNo: 1, qty: 100, price: 10_000 }]);
    expect(r.json.ok).toBe(false);
    expect(r.json.error.code).toBe("state_invalid");
    expect(r.json.error.message).toContain("no_receipt");
    expect(await payablesOf()).toHaveLength(0);
    expect((await sql`select 1 from documents where tenant_id = ${tenant.tenantId} and doc_type = 'VINV'`).length).toBe(0);
  });

  it("hoá đơn vượt số đã nhận bị chặn; ghi từng phần theo số đã nhận, cộng dồn không vượt", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 100, 10_000);
    await receive(po, 60);
    const over = await vinv(accToken, po, "HD-A", [{ lineNo: 1, qty: 80, price: 10_000, taxPct: 0 }]);
    expect(over.json.error.code).toBe("state_invalid");
    const part = await vinv(accToken, po, "HD-B", [{ lineNo: 1, qty: 60, price: 10_000, taxPct: 0 }]);
    expect(part.json.ok, JSON.stringify(part.json)).toBe(true);
    const again = await vinv(accToken, po, "HD-C", [{ lineNo: 1, qty: 10, price: 10_000, taxPct: 0 }]);
    expect(again.json.error.code).toBe("state_invalid"); // đã ghi đủ 60 đã nhận
    await receive(po, 40);
    const rest = await vinv(accToken, po, "HD-D", [{ lineNo: 1, qty: 40, price: 10_000, taxPct: 0 }]);
    expect(rest.json.ok, JSON.stringify(rest.json)).toBe(true);
    expect((await payablesOf()).map((p) => p.amount)).toEqual([600_000, 400_000]);
    // Hoá đơn khớp đúng giá tạm: không có dòng chênh, chỉ Nợ/Có 331 ngược nhau bằng 0 -> không sinh dòng nào ngoài 331 = 0.
    expect(await sumAcc("331", "credit")).toBe(1_000_000);
  });

  it("giá lệch quá dung sai -> chờ kế toán trưởng duyệt, CHƯA ghi sổ; người lập không tự duyệt; duyệt xong ghi phải trả + chênh vào 156", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 100, 10_000);
    await receive(po, 100);
    const r = await vinv(buyerToken, po, "HD-LECH", [{ lineNo: 1, qty: 100, price: 10_500, taxPct: 0 }]); // +5% > 2%
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("pending");
    expect(r.json.data.meta.chain).toEqual(["chief_accountant"]);
    expect(r.json.data.meta.matchNote).toContain("lệch giá");
    const id = r.json.data.id as string;
    expect(await payablesOf()).toHaveLength(0);
    expect((await sql`select 1 from journal_entries where document_id = ${id}`).length).toBe(0);
    const [task] = await sql`select role from tasks where document_id = ${id} and not done`;
    expect(task.role).toBe("chief_accountant");

    const self = await post("/api/approvals/decide", buyerToken, { docId: id, decision: "approve" });
    expect(self.json.error.code).toBe("forbidden");
    const wrongRole = await post("/api/approvals/decide", accToken, { docId: id, decision: "approve" });
    expect(wrongRole.json.error.code).toBe("forbidden");

    const ok = await post("/api/approvals/decide", chiefToken, { docId: id, decision: "approve" });
    expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    expect(ok.json.data.status).toBe("done");
    const p = await payablesOf();
    expect(p).toHaveLength(1);
    expect(p[0].amount).toBe(1_050_000);
    expect(await linesOf(id)).toEqual([["156", 50_000, 0], ["331", 0, 50_000]]);
    expect((await sql`select meta from documents where id = ${id}`)[0].meta.cogsAdjustment).toBe(50_000);
    expect((await sql`select 1 from tasks where document_id = ${id} and not done`).length).toBe(0);
  });

  it("kế toán trưởng từ chối hoá đơn lệch -> huỷ, không ghi phải trả, số hoá đơn ghi lại được", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 10, 10_000);
    await receive(po, 10);
    const r = await vinv(accToken, po, "HD-X", [{ lineNo: 1, qty: 10, price: 12_000, taxPct: 0 }]);
    expect(r.json.data.status).toBe("pending");
    const rej = await post("/api/approvals/decide", chiefToken, { docId: r.json.data.id, decision: "reject", reason: "Sai giá" });
    expect(rej.json.data.status).toBe("cancelled");
    expect(await payablesOf()).toHaveLength(0);
    const [pl] = await sql`select meta from document_lines where document_id = ${po} and line_no = 1`;
    expect(pl.meta.invoiced ?? 0).toBe(0);
    const retry = await vinv(accToken, po, "HD-X", [{ lineNo: 1, qty: 10, price: 10_000, taxPct: 0 }]);
    expect(retry.json.ok, JSON.stringify(retry.json)).toBe(true);
    expect(retry.json.data.status).toBe("done");
  });

  it("dịch vụ khớp 2 bên (không qua phiếu nhập): ghi đủ Nợ 642 + Nợ 133 / Có 331; trùng số hoá đơn -> duplicate; idempotency", async () => {
    const svc = await createItem(tenant.tenantId, "SV", { kind: "service", price: 500_000, cost: 0 });
    const po = await confirmedPo(svc, 2, 500_000);
    const key = randomUUID();
    const body = { poId: po, invoiceNo: "HD-SV", lines: [{ lineNo: 1, qty: 2, price: 500_000 }] };
    const r = await post("/api/purchase/vendor-invoice", accToken, body, { "idempotency-key": key });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(await linesOf(r.json.data.id)).toEqual([["133", 100_000, 0], ["331", 0, 1_100_000], ["642", 1_000_000, 0]]);
    expect((await payablesOf())[0].amount).toBe(1_100_000);

    const replay = await post("/api/purchase/vendor-invoice", accToken, body, { "idempotency-key": key });
    expect(replay.json.data.id).toBe(r.json.data.id);
    expect(await payablesOf()).toHaveLength(1);

    const dup = await vinv(accToken, po, "HD-SV", [{ lineNo: 1, qty: 1, price: 500_000 }]);
    expect(dup.json.error.code).toBe("duplicate");
  });

  it("phân quyền: kho/trưởng bộ phận bị chặn; mua hàng + kế toán được", async () => {
    const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    const po = await confirmedPo(x, 1, 10_000);
    await receive(po, 1);
    const line = [{ lineNo: 1, qty: 1, price: 10_000, taxPct: 0 }];
    expect((await vinv(whToken, po, "HD-K", line)).status).toBe(403);
    expect((await vinv(leadToken, po, "HD-L", line)).status).toBe(403);
    expect((await vinv(buyerToken, po, "HD-M", line)).json.ok).toBe(true);
  });
});
