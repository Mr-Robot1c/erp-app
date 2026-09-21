import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createItem, createPartner, createTestTenant, createWarehouse, sql, type TenantMember, type TestTenant } from "./helper";

const JOB_TOKEN = process.env.JOB_TOKEN ?? "test-job-token";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const idem = () => ({ "idempotency-key": randomUUID() });
const sweep = async (tenantId: string, token: string | null = JOB_TOKEN) => {
  const res = await fetch(apiUrl("/api/jobs/overdue-sweep"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-job-token": token } : {}) },
    body: JSON.stringify({ tenantId }),
  });
  return { status: res.status, json: await res.json() };
};

describe("quét công nợ quá hạn (lô 4.2) — AC-19", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let chiefToken: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const sales = await addTenantMember(tenant.tenantId, "sales");
    const chief = await addTenantMember(tenant.tenantId, "chief_accountant");
    members.push(sales, chief);
    salesToken = (await sales.signIn()).accessToken;
    chiefToken = (await chief.signIn()).accessToken;
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  /** Hoá đơn đã phát hành + khoản phải thu `amount` quá hạn từ hôm qua. */
  async function overdueInvoice(partnerId: string, docNo: string, amount: number) {
    const [inv] = await sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${tenant.tenantId}, 'INV', ${docNo}, 'done', ${partnerId}) returning id`;
    const [rec] = await sql`insert into receivables (tenant_id, kind, document_id, partner_id, amount, due_date) values (${tenant.tenantId}, 'invoice', ${inv.id}, ${partnerId}, ${amount}, ${yesterday()}) returning id`;
    return { invId: inv.id as string, recId: rec.id as string };
  }
  const recRow = async (id: string) => (await sql`select overdue, paid from receivables where id = ${id}`)[0];
  const blockedOf = async (id: string) => (await sql`select blocked from partners where id = ${id}`)[0].blocked as boolean;

  it("AC-19 khách K quá hạn 1 ngày và vượt hạn mức: 2 việc nhắc (kinh doanh + kế toán), khoản đánh dấu quá hạn, K bị chặn; chạy lại không nhắc trùng", async () => {
    const k = await createPartner(tenant.tenantId, "K", { creditLimit: 5_000_000 });
    const { invId, recId } = await overdueInvoice(k, "HD-QH1", 8_000_000);

    const r = await sweep(tenant.tenantId);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data).toMatchObject({ overdue: 1, reminders: 2, blocked: 1 });
    const tasks = await sql`select role, text from tasks where tenant_id = ${tenant.tenantId} and document_id = ${invId} and not done order by role`;
    expect(tasks.map((t) => t.role)).toEqual(["accountant", "sales"]);
    expect(tasks[0].text).toContain("HD-QH1");
    expect((await recRow(recId)).overdue).toBe(true);
    expect(await blockedOf(k)).toBe(true);

    const again = await sweep(tenant.tenantId);
    expect(again.json.data).toMatchObject({ overdue: 1, reminders: 0, blocked: 0 });
    expect((await sql`select 1 from tasks where tenant_id = ${tenant.tenantId} and document_id = ${invId}`).length).toBe(2);
  });

  it("chỉ quá hạn nhưng chưa vượt hạn mức: nhắc nhưng KHÔNG chặn; hạn mức 0 (không giới hạn) không chặn", async () => {
    const k = await createPartner(tenant.tenantId, "K2", { creditLimit: 100_000_000 });
    const free = await createPartner(tenant.tenantId, "K3", { creditLimit: 0 });
    await overdueInvoice(k, "HD-QH2", 1_000_000);
    await overdueInvoice(free, "HD-QH3", 9_000_000);
    const r = await sweep(tenant.tenantId);
    expect(r.json.data).toMatchObject({ overdue: 2, reminders: 4, blocked: 0 });
    expect(await blockedOf(k)).toBe(false);
    expect(await blockedOf(free)).toBe(false);
  });

  it("khách bị chặn: xác nhận đơn công nợ phải chờ kế toán trưởng duyệt; thu đủ nợ → quét lại mở chặn và hết cờ quá hạn", async () => {
    const k = await createPartner(tenant.tenantId, "K", { creditLimit: 5_000_000 });
    const item = await createItem(tenant.tenantId, "X", { price: 100_000, cost: 50_000 });
    await createWarehouse(tenant.tenantId, "K1");
    const { recId } = await overdueInvoice(k, "HD-QH1", 8_000_000);
    await sweep(tenant.tenantId);
    expect(await blockedOf(k)).toBe(true);

    // Đơn công nợ nhỏ (trong hạn mức nếu không bị chặn) vẫn phải qua kế toán trưởng
    const q = await post("/api/quotes", salesToken, { partnerId: k, lines: [{ itemId: item, qty: 1, price: 100_000 }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "credit", depositPct: 0 }, idem());
    const c = await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    expect(c.json.data.status, JSON.stringify(c.json)).toBe("pending");
    expect(c.json.data.meta.chain).toEqual(["chief_accountant"]);
    void chiefToken;

    await sql`update receivables set paid = amount where id = ${recId}`;
    const r = await sweep(tenant.tenantId);
    expect(r.json.data).toMatchObject({ overdue: 0, unblocked: 1 });
    expect(await blockedOf(k)).toBe(false);
    expect((await recRow(recId)).overdue).toBe(false);
  });

  it("chỉ gọi được bằng token việc định kỳ: thiếu/sai token -> forbidden", async () => {
    expect((await sweep(tenant.tenantId, null)).json.error.code).toBe("forbidden");
    const bad = await sweep(tenant.tenantId, "sai-token");
    expect(bad.status).toBe(403);
    expect(bad.json.error.code).toBe("forbidden");
  });
});
