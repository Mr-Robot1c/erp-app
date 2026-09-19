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

describe("phát hành hoá đơn + thu tiền (lô 2.5) — AC-15, 17, 18", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let whToken: string;
  let accToken: string;
  let partnerId: string;
  let whId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const sales = await addTenantMember(tenant.tenantId, "sales");
    const wh = await addTenantMember(tenant.tenantId, "warehouse");
    const acc = await addTenantMember(tenant.tenantId, "accountant");
    members.push(sales, wh, acc);
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    partnerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    whId = await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  /** Đơn 1 dòng giá `net` (đúng giá bảng), tồn đủ, đã xác nhận. */
  async function confirmedOrder(net: number, terms: "cash" | "credit" = "credit", depositPct = 0) {
    const item = await createItem(tenant.tenantId, `X${randomUUID().slice(0, 8)}`, { price: net, cost: net / 2 });
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${item}, ${whId}, 5, ${net / 2})`;
    const q = await post("/api/quotes", salesToken, { partnerId, lines: [{ itemId: item, qty: 1, price: net }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms, depositPct }, idem());
    const c = await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    expect(c.json.data.status, JSON.stringify(c.json)).toBe("confirmed");
    return o.json.data.id as string;
  }
  async function delivered(orderId: string, date?: string) {
    const d = await post("/api/orders/deliver", whToken, { orderId, lines: [{ lineNo: 1, qty: 1 }], ...(date ? { date } : {}) }, idem());
    expect(d.json.ok, JSON.stringify(d.json)).toBe(true);
    return d.json.data.invId as string;
  }
  const issue = (invoiceId: string, date?: string) => post("/api/invoices/issue", accToken, { invoiceId, ...(date ? { date } : {}) }, idem());
  const receipt = (body: Record<string, unknown>) => post("/api/receipts", accToken, body, idem());
  const advanceOf = async () => Number((await sql`select amount from partner_advances where tenant_id = ${tenant.tenantId} and partner_id = ${partnerId}`)[0]?.amount ?? 0);
  const receivableOf = async (docId: string) => (await sql`select amount, paid, to_char(due_date, 'YYYY-MM-DD') as due_date, kind from receivables where document_id = ${docId} and kind = 'invoice'`)[0];

  it("AC-15 phát hành: doanh thu 10tr + thuế 1tr, phải thu 11tr cấn ứng trước 3tr còn 8tr hạn +30 ngày, bút toán cân, ghi theo NGÀY GIAO", async () => {
    const o = await confirmedOrder(10_000_000, "credit");
    await sql`insert into partner_advances (tenant_id, partner_id, amount) values (${tenant.tenantId}, ${partnerId}, 3000000)`;
    const invId = await delivered(o, "2026-09-10");

    const r = await issue(invId, "2026-09-19");
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.status).toBe("done");

    const lines = await sql`select l.account_code c, l.debit d, l.credit k, to_char(e.entry_date, 'YYYY-MM-DD') ed from journal_lines l join journal_entries e on e.id = l.entry_id
                            where e.document_id = ${invId} order by l.account_code`;
    expect(lines.map((x) => [x.c, Number(x.d), Number(x.k)])).toEqual([
      ["131", 11_000_000, 0],
      ["3331", 0, 1_000_000],
      ["511", 0, 10_000_000],
    ]);
    expect(lines.every((x) => x.ed === "2026-09-10")).toBe(true); // ngày giao, không phải ngày phát hành
    expect(lines.reduce((s, x) => s + Number(x.d) - Number(x.k), 0)).toBe(0);

    const rec = await receivableOf(invId);
    expect(Number(rec.amount) - Number(rec.paid)).toBe(8_000_000);
    expect(rec.due_date).toBe("2026-10-19"); // 2026-09-19 + 30 ngày
    expect(await advanceOf()).toBe(0);
    const [a] = await sql`select amount, note from receipt_allocations where receipt_id = ${invId}`;
    expect([Number(a.amount), a.note]).toEqual([3_000_000, "Cấn trừ ứng trước"]);
  });

  it("cọc đã thu của đơn được cấn trừ khi phát hành: đơn cọc 30% -> thu cọc -> giao -> phát hành còn 7,7tr", async () => {
    const o = await confirmedOrder(10_000_000, "cash", 30); // tổng 11tr, cọc 3,3tr
    const dep = await receipt({ partnerId, amount: 3_300_000, method: "bank" });
    expect(dep.json.ok, JSON.stringify(dep.json)).toBe(true);
    const [so] = await sql`select meta from documents where id = ${o}`;
    expect(so.meta.depositPaid).toBe(true);
    const [{ n }] = await sql`select count(*)::int n from tasks where document_id = ${o} and role = 'accountant' and text like 'Thu cọc%' and not done`;
    expect(n).toBe(0);
    expect(await advanceOf()).toBe(0); // vào khoản cọc, không phải ứng trước

    const invId = await delivered(o);
    const r = await issue(invId);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const rec = await receivableOf(invId);
    expect(Number(rec.amount) - Number(rec.paid)).toBe(7_700_000);
    const [a] = await sql`select amount, note from receipt_allocations where receipt_id = ${invId}`;
    expect([Number(a.amount), a.note]).toEqual([3_300_000, "Cấn trừ cọc"]);
  });

  it("AC-17 giao dịch G 8,5tr cho nợ 8tr: gửi 2 lần chỉ ghi 1 phiếu thu, thu đủ, dư 0,5tr thành ứng trước", async () => {
    const o = await confirmedOrder(7_272_727, "credit"); // ~8tr gồm thuế
    const invId = await delivered(o);
    await issue(invId);
    const rec = await receivableOf(invId);
    const debt = Number(rec.amount);

    const body = { partnerId, amount: debt + 500_000, method: "bank", bankRef: "G1" };
    const a = await receipt(body);
    const b = await receipt(body);
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    expect(b.json.ok).toBe(false);
    expect(b.json.error.code).toBe("duplicate");

    const after = await receivableOf(invId);
    expect(Number(after.amount) - Number(after.paid)).toBe(0);
    expect(await advanceOf()).toBe(500_000);
    const [{ n }] = await sql`select count(*)::int n from documents where tenant_id = ${tenant.tenantId} and doc_type = 'RCPT'`;
    expect(n).toBe(1);
    const [{ t }] = await sql`select count(*)::int t from bank_txns where tenant_id = ${tenant.tenantId} and bank_ref = 'G1'`;
    expect(t).toBe(1);
    const jl = await sql`select l.account_code c, l.debit d, l.credit k from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${a.json.data.id}`;
    expect(jl.map((x) => [x.c, Number(x.d), Number(x.k)]).sort()).toEqual([["112", debt + 500_000, 0], ["131", 0, debt + 500_000]].sort());
  });

  it("AC-18 giao dịch không mã, không có khoản mở: toàn bộ thành ứng trước, nằm ở hàng chờ khớp tay (phân bổ 'Ứng trước')", async () => {
    const r = await receipt({ partnerId, amount: 1_000_000, method: "cash" });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(await advanceOf()).toBe(1_000_000);
    const unmatched = await sql`
      select d.doc_no from documents d join receipt_allocations a on a.receipt_id = d.id
      where d.tenant_id = ${tenant.tenantId} and d.doc_type = 'RCPT' and a.receivable_id is null and a.note = 'Ứng trước'`;
    expect(unmatched).toHaveLength(1);
  });

  it("song song: 2 phiếu thu cùng lúc cho 1 khoản nợ không làm paid vượt amount", async () => {
    const o = await confirmedOrder(10_000_000, "credit");
    const invId = await delivered(o);
    await issue(invId);
    const debt = Number((await receivableOf(invId)).amount);
    const [r1, r2] = await Promise.all([
      receipt({ partnerId, amount: debt, method: "bank", bankRef: "P1" }),
      receipt({ partnerId, amount: debt, method: "bank", bankRef: "P2" }),
    ]);
    expect(r1.json.ok && r2.json.ok, JSON.stringify([r1.json, r2.json])).toBe(true);
    const rec = await receivableOf(invId);
    expect(Number(rec.paid)).toBe(debt); // không vượt
    expect(await advanceOf()).toBe(debt); // phiếu còn lại thành ứng trước
  });

  it("kỳ của ngày giao đã khoá -> period_locked; đơn giao đủ + phát hành + thu đủ -> đơn done", async () => {
    const o1 = await confirmedOrder(1_000_000, "credit");
    const inv1 = await delivered(o1, "2026-01-15");
    await sql`insert into periods (tenant_id, ym, status) values (${tenant.tenantId}, '2026-01', 'locked')`;
    const locked = await issue(inv1);
    expect(locked.json.error.code).toBe("period_locked");

    const o2 = await confirmedOrder(2_000_000, "credit");
    const inv2 = await delivered(o2);
    await issue(inv2);
    expect((await sql`select status from documents where id = ${o2}`)[0].status).toBe("confirmed"); // chưa thu
    await receipt({ partnerId, amount: Number((await receivableOf(inv2)).amount), method: "bank", bankRef: "Z1" });
    expect((await sql`select status from documents where id = ${o2}`)[0].status).toBe("done");
  });

  it("phát hành 2 lần / hoá đơn không tồn tại -> state_invalid / not_found", async () => {
    const o = await confirmedOrder(1_000_000, "cash");
    const inv = await delivered(o);
    expect((await issue(inv)).json.ok).toBe(true);
    expect((await issue(inv)).json.error.code).toBe("state_invalid");
    expect((await issue(randomUUID())).json.error.code).toBe("not_found");
  });
});
