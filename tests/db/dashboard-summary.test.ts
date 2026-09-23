import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createPartner, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

async function summary(token: string, ym: string) {
  const res = await fetch(apiUrl("/api/dashboard/summary"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ym }),
  });
  return { status: res.status, json: await res.json() };
}

// CB-1.7b: /api/dashboard/summary bọc getKpis() để trang Tổng quan lấy qua client fetch (cache
// 30s, xem use-cached-fetch.ts) thay vì server component await trực tiếp — giảm delay chuyển trang.
describe("CB-1.7b: /api/dashboard/summary", () => {
  let tenant: TestTenant;
  let other: TestTenant;
  let staff: TenantMember;
  const ym = "2026-01";

  beforeAll(async () => {
    tenant = await createTestTenant({ role: "admin" });
    other = await createTestTenant({ role: "admin" });
    staff = await addTenantMember(tenant.tenantId, "staff");
    const partner = await createPartner(tenant.tenantId, "KH1");
    await sql`insert into receivables (tenant_id, kind, partner_id, amount, paid) values (${tenant.tenantId}, 'invoice', ${partner}, 1000000, 400000)`;
    await sql`insert into payables (tenant_id, partner_id, amount, paid) values (${tenant.tenantId}, ${partner}, 500000, 100000)`;
    await sql`insert into tasks (tenant_id, role, text) values (${tenant.tenantId}, 'warehouse', 'Việc treo')`;

    const otherPartner = await createPartner(other.tenantId, "KH2");
    await sql`insert into receivables (tenant_id, kind, partner_id, amount, paid) values (${other.tenantId}, 'invoice', ${otherPartner}, 999999999, 0)`;
    await sql`insert into tasks (tenant_id, role, text) values (${other.tenantId}, 'warehouse', 'Việc của công ty khác')`;
  });

  afterAll(async () => {
    await staff?.cleanup();
    await tenant?.cleanup();
    await other?.cleanup();
  });

  it("trả đúng số của tenant mình, vai staff cũng đọc được, không lẫn tenant khác", async () => {
    const { accessToken } = await staff.signIn();
    const r = await summary(accessToken, ym);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.ym).toBe(ym);
    expect(r.json.data.receivable).toBe(600000);
    expect(r.json.data.payable).toBe(400000);
    expect(r.json.data.openTasks).toBe(1);
  });

  it("chưa đăng nhập -> unauthenticated; ym sai định dạng -> invalid_argument", async () => {
    const anon = await fetch(apiUrl("/api/dashboard/summary"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ym }),
    });
    expect((await anon.json()).error.code).toBe("unauthenticated");

    const { accessToken } = await tenant.signIn();
    const bad = await summary(accessToken, "not-a-month");
    expect(bad.json.ok).toBe(false);
    expect(bad.json.error.code).toBe("invalid_argument");
  });
});
