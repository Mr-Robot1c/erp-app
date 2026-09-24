import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestTenant, sql, type TestTenant } from "./helper";
import { MIN_AGE_MS, findGarbage } from "./cleanup-e2e-lib";

// VS-1.1: job cleanup từng xoá fixture ĐANG sống của shard DB cùng run (đua) — lớp phòng thủ: chỉ xoá rác già hơn 2 giờ.
describe("cleanup-e2e — lọc tuổi 2 giờ (VS-1.1)", () => {
  let fresh: TestTenant;

  beforeAll(async () => {
    fresh = await createTestTenant({ role: "admin" }); // tên "Test <rand>", email t_test_<rand>@test.local — KHỚP mẫu rác
  });

  afterAll(async () => {
    await fresh?.cleanup();
  });

  it("tenant + user vừa tạo khớp mẫu nhưng KHÔNG bị liệt vào danh sách xoá (mặc định)", async () => {
    const { tenants, users } = await findGarbage(sql, admin);
    expect(tenants.map((t) => t.id)).not.toContain(fresh.tenantId);
    expect(users.map((u) => u.email)).not.toContain(fresh.email);
  });

  it("qua ngưỡng 2 giờ thì bị liệt vào (cả tenant lẫn user); chưa tới ngưỡng (1 giờ 59) thì chưa", async () => {
    const at = (ms: number) => new Date(Date.now() + ms);
    const early = await findGarbage(sql, admin, { now: at(MIN_AGE_MS - 60_000) });
    expect(early.tenants.map((t) => t.id)).not.toContain(fresh.tenantId);
    expect(early.users.map((u) => u.email)).not.toContain(fresh.email);

    const late = await findGarbage(sql, admin, { now: at(MIN_AGE_MS + 60_000) });
    expect(late.tenants.map((t) => t.id)).toContain(fresh.tenantId);
    expect(late.users.map((u) => u.email)).toContain(fresh.email);
  });

  it("--all (all: true) bỏ lọc tuổi: fixture vừa tạo bị liệt vào — nhưng tenant/user được bảo vệ KHÔNG BAO GIỜ bị liệt", async () => {
    const { tenants, users } = await findGarbage(sql, admin, { all: true });
    expect(tenants.map((t) => t.id)).toContain(fresh.tenantId);
    expect(users.map((u) => u.email)).toContain(fresh.email);

    const protectedTenants = await sql`select id from tenants where tax_code = '0109990001' or name in ('Công ty Demo', 'Công ty TNHH ABC')`;
    for (const p of protectedTenants) expect(tenants.map((t) => t.id)).not.toContain(p.id as string);
    expect(users.filter((u) => u.email.endsWith("@demo.vn"))).toEqual([]);
  });
});
