import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTenantMember,
  apiUrl,
  createItem,
  createPartner,
  createTestTenant,
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

describe("đơn bán (lô 2.2) — AC-07 (chuyển đơn), AC-08, AC-09", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let chiefToken: string;
  let adminToken: string;
  let partnerId: string;
  let itemA: string;
  let itemB: string;

  async function setup(creditLimit = 1_000_000_000) {
    tenant = await createTestTenant({ role: "admin" });
    const sales = await addTenantMember(tenant.tenantId, "sales");
    const chief = await addTenantMember(tenant.tenantId, "chief_accountant");
    members.push(sales, chief);
    salesToken = (await sales.signIn()).accessToken;
    chiefToken = (await chief.signIn()).accessToken;
    adminToken = (await tenant.signIn()).accessToken;
    partnerId = await createPartner(tenant.tenantId, "KH1", { creditLimit });
    itemA = await createItem(tenant.tenantId, "SPA", { price: 20_000_000 });
    itemB = await createItem(tenant.tenantId, "SPB", { price: 3_000_000 });
  }

  beforeEach(() => {
    members.length = 0;
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  async function confirmedQuote(lines: { itemId: string; qty: number; price: number }[]) {
    const c = await post("/api/quotes", salesToken, { partnerId, lines }, idem());
    expect(c.json.ok, JSON.stringify(c.json)).toBe(true);
    const id = c.json.data.id as string;
    const conf = await post("/api/quotes/confirm", salesToken, { quoteId: id });
    expect(conf.json.data.status).toBe("confirmed");
    return id;
  }
  async function draftOrder(net: number, terms: "cash" | "credit", depositPct = 0) {
    // mặt hàng riêng có giá bảng = net để báo giá không bị "giá thấp hơn bảng" (chờ duyệt) làm lệch ca kiểm hạn mức
    const item = await createItem(tenant.tenantId, `X${randomUUID().slice(0, 8)}`, { price: net });
    const q = await confirmedQuote([{ itemId: item, qty: 1, price: net }]);
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q, terms, depositPct }, idem());
    expect(o.json.ok, JSON.stringify(o.json)).toBe(true);
    return o.json.data.id as string;
  }
  const tasksOf = async (docId: string, role: string) =>
    (await sql`select 1 from tasks where document_id = ${docId} and role = ${role} and not done`).length;

  it("AC-08 chốt đơn: đúng dòng/tổng, cọc đúng %, KHÔNG có phải thu hoá đơn, kho nhận đúng 1 việc", async () => {
    await setup();
    const q = await confirmedQuote([
      { itemId: itemA, qty: 1, price: 20_000_000 },
      { itemId: itemB, qty: 8, price: 3_000_000 },
    ]);
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q, terms: "cash", depositPct: 30 }, idem());
    expect(o.json.ok, JSON.stringify(o.json)).toBe(true);
    const orderId = o.json.data.id as string;
    expect(o.json.data.status).toBe("draft");

    const conf = await post("/api/orders/confirm", salesToken, { orderId });
    expect(conf.json.ok, JSON.stringify(conf.json)).toBe(true);
    expect(conf.json.data.status).toBe("confirmed");

    const lines = await sql`select 1 from document_lines where document_id = ${orderId}`;
    expect(lines).toHaveLength(2);
    const [doc] = await sql`select meta, refs from documents where id = ${orderId}`;
    expect(Number(doc.meta.total)).toBe(48_400_000); // 44tr + thuế 10%
    expect(doc.refs).toHaveLength(2); // báo giá gốc + yêu cầu mua tự sinh do kho chưa có hàng (lô 2.3)
    const deposit = await sql`select amount from receivables where document_id = ${orderId} and kind = 'deposit'`;
    expect(Number(deposit[0].amount)).toBe(14_520_000); // 30% của 48,4tr
    const invoices = await sql`select 1 from receivables where document_id = ${orderId} and kind = 'invoice'`;
    expect(invoices).toHaveLength(0);
    expect(await tasksOf(orderId, "warehouse")).toBe(1);
    expect(await tasksOf(orderId, "accountant")).toBe(1); // thu cọc

    const [quote] = await sql`select status, refs from documents where id = ${q}`;
    expect(quote.status).toBe("done");
    expect(quote.refs).toHaveLength(1);
  });

  it("AC-07 chuyển đơn: quá hạn/đã huỷ/đã chuyển -> state_invalid", async () => {
    await setup();
    const q1 = await confirmedQuote([{ itemId: itemB, qty: 1, price: 3_000_000 }]);
    await sql`update documents set meta = meta || '{"validTo":"2020-01-01"}'::jsonb where id = ${q1}`;
    const expired = await post("/api/quotes/to-order", salesToken, { quoteId: q1, terms: "cash" }, idem());
    expect(expired.json.error.code).toBe("state_invalid");

    await post("/api/quotes/expire-sweep", adminToken, {});
    const afterSweep = await post("/api/quotes/to-order", salesToken, { quoteId: q1, terms: "cash" }, idem());
    expect(afterSweep.json.error.code).toBe("state_invalid");

    const q2 = await confirmedQuote([{ itemId: itemB, qty: 1, price: 3_000_000 }]);
    const first = await post("/api/quotes/to-order", salesToken, { quoteId: q2, terms: "cash" }, idem());
    expect(first.json.ok).toBe(true);
    const again = await post("/api/quotes/to-order", salesToken, { quoteId: q2, terms: "cash" }, idem());
    expect(again.json.error.code).toBe("state_invalid");
  });

  it("AC-09 vượt hạn mức: pending chờ kế toán trưởng, kho CHƯA có việc; duyệt xong kho nhận việc", async () => {
    await setup(10_000_000);
    await sql`insert into receivables (tenant_id, kind, partner_id, amount, due_date)
              values (${tenant.tenantId}, 'invoice', ${partnerId}, 8000000, current_date + 30)`;
    const orderId = await draftOrder(5_000_000, "credit"); // 8tr + 5tr*1,1 = 13,5tr > 10tr
    const conf = await post("/api/orders/confirm", salesToken, { orderId });
    expect(conf.json.data.status).toBe("pending");
    expect(await tasksOf(orderId, "chief_accountant")).toBe(1);
    expect(await tasksOf(orderId, "warehouse")).toBe(0);

    const ok = await post("/api/approvals/decide", chiefToken, { docId: orderId, decision: "approve" });
    expect(ok.json.data.status).toBe("confirmed");
    expect(await tasksOf(orderId, "warehouse")).toBe(1);
  });

  it("có nợ quá hạn -> pending dù còn hạn mức; đơn tiền mặt không bị kiểm hạn mức", async () => {
    await setup(1_000_000_000);
    await sql`insert into receivables (tenant_id, kind, partner_id, amount, due_date)
              values (${tenant.tenantId}, 'invoice', ${partnerId}, 1000000, current_date - 1)`;
    const credit = await draftOrder(1_000_000, "credit");
    const c1 = await post("/api/orders/confirm", salesToken, { orderId: credit });
    expect(c1.json.data.status).toBe("pending");

    const cash = await draftOrder(1_000_000, "cash");
    const c2 = await post("/api/orders/confirm", salesToken, { orderId: cash });
    expect(c2.json.data.status).toBe("confirmed");
  });

  it("song song: 2 đơn công nợ cùng khách xác nhận cùng lúc, chỉ 1 lọt hạn mức", async () => {
    await setup(15_000_000);
    const a = await draftOrder(10_000_000, "credit"); // 11tr mỗi đơn
    const b = await draftOrder(10_000_000, "credit");
    const [ra, rb] = await Promise.all([
      post("/api/orders/confirm", salesToken, { orderId: a }),
      post("/api/orders/confirm", salesToken, { orderId: b }),
    ]);
    const statuses = [ra.json.data.status, rb.json.data.status].sort();
    expect(statuses).toEqual(["confirmed", "pending"]);
  });
});
