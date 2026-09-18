import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestTenant, apiUrl, sql, type TestTenant } from "./helper";

/** Lô 0.2b việc 2: 2 request tạo cùng mã danh mục cùng lúc -> constraint DB chặn,
 * mapping 23505 -> duplicate (không phải internal). */
describe("race tạo danh mục trùng mã", () => {
  let t: TestTenant;

  beforeAll(async () => {
    t = await createTestTenant({ role: "admin" });
  });

  afterAll(async () => {
    await t.cleanup();
  });

  it("2 request POST /api/master/partners cùng code cùng lúc -> đúng 1 bản ghi, 1 ok + 1 duplicate", async () => {
    const { accessToken } = await t.signIn();
    const body = { code: "RACE1", name: "Đối tác race", kind: "customer", creditLimit: 0 };
    const post = () =>
      fetch(apiUrl("/api/master/partners"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    const [r1, r2] = await Promise.all([post(), post()]);
    const results = [r1, r2];

    const okCount = results.filter((r) => r.ok).length;
    const dupCount = results.filter((r) => !r.ok && r.error.code === "duplicate").length;
    const otherFail = results.filter((r) => !r.ok && r.error.code !== "duplicate");

    expect(okCount).toBe(1);
    expect(dupCount).toBe(1);
    expect(otherFail).toHaveLength(0);

    const rows = await sql`select id from partners where tenant_id = ${t.tenantId} and code = ${body.code}`;
    expect(rows).toHaveLength(1);
  });
});
