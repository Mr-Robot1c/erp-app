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

describe("sổ cái, số dư, truy ngược (lô 4.1) — AC-35", () => {
  let tenant: TestTenant;
  let other: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let whToken: string;
  let accToken: string;
  let customerId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    other = await createTestTenant({ role: "admin" });
    const [sales, wh, acc] = await Promise.all((["sales", "warehouse", "accountant"] as const).map((r) => addTenantMember(tenant.tenantId, r)));
    members.push(sales, wh, acc);
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    customerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    const k1 = await createWarehouse(tenant.tenantId, "K1");
    const item = await createItem(tenant.tenantId, "X", { price: 10_000_000, cost: 5_000_000 });
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${item}, ${k1}, 5, 5000000)`;
    // Đơn 10tr (thuế 10% → 11tr), giao, phát hành, thu 3tr
    const q = await post("/api/quotes", salesToken, { partnerId: customerId, lines: [{ itemId: item, qty: 1, price: 10_000_000 }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "credit", depositPct: 0 }, idem());
    await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    const d = await post("/api/orders/deliver", whToken, { orderId: o.json.data.id, lines: [{ lineNo: 1, qty: 1 }] }, idem());
    const i = await post("/api/invoices/issue", accToken, { invoiceId: d.json.data.invId }, idem());
    expect(i.json.ok, JSON.stringify(i.json)).toBe(true);
    const r = await post("/api/receipts", accToken, { partnerId: customerId, amount: 3_000_000, method: "bank" }, idem());
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
    await other?.cleanup();
  });

  it("AC-35 công nợ khách K = Σ hoá đơn − Σ phiếu thu = 8tr; mọi dòng sổ cái có document_id; sổ cân", async () => {
    const { client } = await tenant.signIn();
    const { data: bal, error } = await client.from("v_partner_balance").select("*").eq("partner_id", customerId).eq("account_code", "131");
    expect(error).toBeNull();
    expect(bal).toHaveLength(1);
    expect(Number(bal![0].balance)).toBe(8_000_000);

    // Truy ngược: các dòng 131 của K gồm hoá đơn (Nợ) và phiếu thu (Có), cộng lại đúng số báo cáo
    const { data: lines } = await client.from("v_journal").select("*").eq("partner_id", customerId).eq("account_code", "131");
    const invoices = (lines ?? []).filter((l) => l.doc_type === "INV").reduce((a, l) => a + Number(l.debit), 0);
    const receipts = (lines ?? []).filter((l) => l.doc_type === "RCPT").reduce((a, l) => a + Number(l.credit), 0);
    expect(invoices).toBe(11_000_000);
    expect(receipts).toBe(3_000_000);
    expect(invoices - receipts).toBe(8_000_000);
    for (const l of lines ?? []) expect(l.document_id).not.toBeNull();

    const { data: all } = await client.from("v_journal").select("document_id, doc_no, debit, credit");
    expect((all ?? []).length).toBeGreaterThan(0);
    for (const l of all ?? []) {
      expect(l.document_id).not.toBeNull();
      expect(l.doc_no).not.toBeNull();
    }
    expect((all ?? []).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0)).toBe(0);
  });

  it("số dư tài khoản theo kỳ: doanh thu 511 có 10tr, thuế 3331 có 1tr, tiền 112 nợ 3tr; kỳ khác không lẫn", async () => {
    const { client } = await tenant.signIn();
    const ym = new Date().toISOString().slice(0, 7);
    const { data } = await client.from("v_account_balance").select("ym, account_code, debit, credit").eq("ym", ym);
    const by = new Map((data ?? []).map((r) => [r.account_code as string, r]));
    expect(Number(by.get("511")!.credit)).toBe(10_000_000);
    expect(Number(by.get("3331")!.credit)).toBe(1_000_000);
    expect(Number(by.get("112")!.debit)).toBe(3_000_000);
    const { data: none } = await client.from("v_account_balance").select("account_code").eq("ym", "2000-01");
    expect(none).toHaveLength(0);
  });

  it("tenant khác không thấy sổ cái của mình (RLS qua view)", async () => {
    const { client } = await other.signIn();
    for (const v of ["v_journal", "v_account_balance", "v_partner_balance"]) {
      const { data, error } = await client.from(v).select("*");
      expect(error).toBeNull();
      expect(data ?? [], v).toHaveLength(0);
    }
  });
});
