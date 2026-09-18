import { afterEach, describe, expect, it } from "vitest";
import { createTestTenant, addTenantMember, apiUrl, sql, type TestTenant, type TenantMember } from "./helper";

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function asObject(v: unknown): Record<string, unknown> {
  return (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;
}

async function chainOf(docId: string) {
  const [row] = await sql`select meta from documents where id = ${docId}`;
  return asObject(row.meta).chain as string[];
}

describe("AC-05 — đổi ngưỡng duyệt không đổi chuỗi đang đi", () => {
  let tenant: TestTenant;
  let staff: TenantMember;

  afterEach(async () => {
    await staff?.cleanup();
    await tenant?.cleanup();
  });

  it("EXP cũ giữ nguyên chain 3 cấp sau khi nâng ngưỡng; EXP mới cùng số tiền chỉ còn 2 cấp", async () => {
    tenant = await createTestTenant({ role: "admin" });
    staff = await addTenantMember(tenant.tenantId, "staff");
    const { accessToken: adminToken } = await tenant.signIn();
    const { accessToken: staffToken } = await staff.signIn();

    // Ngưỡng mặc định lúc tạo tenant: expThreshold = 10.000.000 (0001_core.sql).
    const oldExp = await post("/api/expenses", staffToken, { amount: 15_000_000, purpose: "Trên ngưỡng cũ" });
    expect(oldExp.json.ok, JSON.stringify(oldExp.json)).toBe(true);
    const oldDocId = oldExp.json.data.id as string;
    expect(await chainOf(oldDocId)).toEqual(["dept_lead", "accountant", "director"]);

    const changed = await post("/api/tenant/settings", adminToken, {
      expThreshold: 20_000_000,
      poThreshold: 20_000_000,
      tolerancePct: 2,
      terms: 30,
    });
    expect(changed.json.ok, JSON.stringify(changed.json)).toBe(true);

    // EXP cũ: chain KHÔNG đổi (đã snapshot vào meta lúc tạo).
    expect(await chainOf(oldDocId)).toEqual(["dept_lead", "accountant", "director"]);

    // EXP mới cùng số tiền 15tr, nay DƯỚI ngưỡng mới 20tr -> chỉ còn 2 cấp.
    const newExp = await post("/api/expenses", staffToken, { amount: 15_000_000, purpose: "Dưới ngưỡng mới" });
    expect(newExp.json.ok, JSON.stringify(newExp.json)).toBe(true);
    expect(await chainOf(newExp.json.data.id as string)).toEqual(["dept_lead", "accountant"]);
  });

  it("không phải admin -> forbidden; sai kiểu dữ liệu -> invalid_argument", async () => {
    tenant = await createTestTenant({ role: "admin" });
    staff = await addTenantMember(tenant.tenantId, "staff");
    const { accessToken: adminToken } = await tenant.signIn();
    const { accessToken: staffToken } = await staff.signIn();

    const byStaff = await post("/api/tenant/settings", staffToken, {
      expThreshold: 1,
      poThreshold: 1,
      tolerancePct: 1,
      terms: 1,
    });
    expect(byStaff.json.ok).toBe(false);
    expect(byStaff.json.error.code).toBe("forbidden");

    const badShape = await post("/api/tenant/settings", adminToken, { expThreshold: -1 });
    expect(badShape.json.ok).toBe(false);
    expect(badShape.json.error.code).toBe("invalid_argument");
  });
});
