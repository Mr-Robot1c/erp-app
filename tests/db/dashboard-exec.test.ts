import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function execDashboard(token: string) {
  const res = await fetch(apiUrl("/api/dashboard/exec"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: "{}",
  });
  return { status: res.status, json: await res.json() };
}

async function seedExec(tenantId: string, suffix: string, revenue: number, overdue: number, stockValue: number) {
  const partnerId = await createPartner(tenantId, "UI4-KH");
  const itemId = await createItem(tenantId, `UI4-${suffix}`, { cost: stockValue });
  const warehouseId = await createWarehouse(tenantId, `UI4-${suffix}`);
  const [delivery] = await sql`
    insert into documents (tenant_id, doc_type, doc_no, partner_id)
    values (${tenantId}, 'DO', ${`UI4-PX-${suffix}`}, ${partnerId}) returning id`;
  await sql`
    insert into document_lines (tenant_id, document_id, line_no, item_id, qty, price)
    values (${tenantId}, ${delivery.id as string}, 1, ${itemId}, 1, ${revenue})`;
  await sql`update documents set status = 'done' where tenant_id = ${tenantId} and id = ${delivery.id as string}`;
  await sql`
    insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost)
    values (${tenantId}, ${itemId}, ${warehouseId}, 1, ${stockValue})`;
  await sql`
    insert into receivables (tenant_id, kind, document_id, partner_id, amount, paid, due_date)
    values (${tenantId}, 'invoice', ${delivery.id as string}, ${partnerId}, ${overdue}, 0, current_date - 1)`;

  const [quote] = await sql`
    insert into documents (tenant_id, doc_type, doc_no, status, partner_id)
    values (${tenantId}, 'QUOTE', ${`UI4-BG-${suffix}`}, 'done', ${partnerId}) returning id`;
  await sql`
    insert into documents (tenant_id, doc_type, doc_no, status, partner_id, meta)
    values (${tenantId}, 'SO', ${`UI4-DB-${suffix}`}, 'draft', ${partnerId}, ${sql.json({ quoteId: quote.id } as never)})`;
  await sql`
    insert into documents (tenant_id, doc_type, doc_no, status, partner_id, meta)
    values
      (${tenantId}, 'RCPT', ${`UI4-PT-${suffix}`}, 'done', ${partnerId}, ${sql.json({ amount: 700 } as never)}),
      (${tenantId}, 'PAY', ${`UI4-PC-${suffix}`}, 'done', ${partnerId}, ${sql.json({ amount: 200 } as never)})`;
}

describe("UI-4C — dashboard giám đốc tách tenant và chặn vai", () => {
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let empty: TestTenant;
  let salesA: TenantMember;

  beforeAll(async () => {
    tenantA = await createTestTenant({ role: "admin" });
    tenantB = await createTestTenant({ role: "admin" });
    empty = await createTestTenant({ role: "admin" });
    salesA = await addTenantMember(tenantA.tenantId, "sales");
    await seedExec(tenantA.tenantId, "A", 1_000, 300, 500);
    await seedExec(tenantB.tenantId, "B", 900_000, 800_000, 700_000);
  });

  afterAll(async () => {
    await salesA?.cleanup();
    await tenantA?.cleanup();
    await tenantB?.cleanup();
    await empty?.cleanup();
  });

  it("hai tenant cùng mã khách vẫn chỉ thấy toàn bộ số của tenant mình", async () => {
    const a = await execDashboard((await tenantA.signIn()).accessToken);
    expect(a.status).toBe(200);
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    expect(a.json.data).toMatchObject({
      revenueTrend: { current: 1_000 },
      cashflow: { receipts: 700, payments: 200, net: 500 },
      topCustomers: [{ code: "UI4-KH", revenue: 1_000 }],
      overdueAr: { total: 300, customerCount: 1 },
      deadStock: { value: 500, skuCount: 1 },
      quoteConversion: { totalQuotes: 1, convertedQuotes: 1, pct: 100 },
    });
  });

  it("vai sales gọi API bị chặn 403", async () => {
    const result = await execDashboard((await salesA.signIn()).accessToken);
    expect(result.status).toBe(403);
    expect(result.json).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("tenant rỗng trả số 0 và danh sách rỗng, không throw", async () => {
    const result = await execDashboard((await empty.signIn()).accessToken);
    expect(result.status).toBe(200);
    expect(result.json.data).toEqual({
      revenueTrend: { current: 0, previous: 0, deltaPct: 0 },
      cashflow: { receipts: 0, payments: 0, net: 0 },
      topCustomers: [],
      overdueAr: { total: 0, customerCount: 0 },
      deadStock: { value: 0, skuCount: 0 },
      quoteConversion: { totalQuotes: 0, convertedQuotes: 0, pct: 0 },
    });
  });
});
