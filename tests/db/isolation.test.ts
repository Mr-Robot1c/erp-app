import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestTenant, createPartner, createItem, apiUrl, sql, type TestTenant } from "./helper";

// Đóng pool Postgres sau khi hết mọi test trong file — không đóng thì tiến trình vitest
// treo vô thời hạn (socket còn mở giữ event loop sống), toàn bộ log bị kẹt trong buffer.
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

/** Bài kiểm tách biệt tenant — chạy ở MỌI commit từ lô 0.2 (00-luat-thi-cong). */
describe("tách biệt dữ liệu giữa doanh nghiệp", () => {
  let a: TestTenant;
  let b: TestTenant;
  let partnerIdA: string;
  let itemIdA: string;

  const TABLES_WITH_TENANT_ID = [
    "memberships",
    "partners",
    "items",
    "warehouses",
    "accounts",
    "periods",
    "audit_log",
  ] as const;

  beforeAll(async () => {
    a = await createTestTenant({ role: "staff" });
    b = await createTestTenant({ role: "staff" });
    partnerIdA = await createPartner(a.tenantId, "PA1");
    itemIdA = await createItem(a.tenantId, "IA1");
  });

  afterAll(async () => {
    await a.cleanup();
    await b.cleanup();
  });

  it("bảng tenants: B chỉ đọc được dòng của chính mình", async () => {
    const { client } = await b.signIn();
    const { data, error } = await client.from("tenants").select("*");
    expect(error).toBeNull();
    for (const row of data ?? []) expect(row.id).toBe(b.tenantId);
    expect((data ?? []).some((row) => row.id === a.tenantId)).toBe(false);
  });

  it.each(TABLES_WITH_TENANT_ID)("bảng %s: B không đọc được dòng của A qua API + RLS", async (table) => {
    const { client } = await b.signIn();
    const { data, error } = await client.from(table).select("*");
    expect(error).toBeNull();
    for (const row of data ?? []) expect(row.tenant_id).toBe(b.tenantId);
    expect((data ?? []).some((row) => row.tenant_id === a.tenantId)).toBe(false);
  });

  it("B lấy theo id bản ghi của A (partner, item) -> 0 dòng", async () => {
    const { client } = await b.signIn();
    const p = await client.from("partners").select("*").eq("id", partnerIdA);
    expect(p.data ?? []).toHaveLength(0);
    const i = await client.from("items").select("*").eq("id", itemIdA);
    expect(i.data ?? []).toHaveLength(0);
  });

  it("B gọi API tạo đối tác: chưa có quyền admin -> forbidden; lên admin -> tạo được, mang tenant B", async () => {
    const { accessToken } = await b.signIn();
    const body = { code: "PB1", name: "Đối tác B1", kind: "customer", creditLimit: 0 };

    const res1 = await fetch(apiUrl("/api/master/partners"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const json1 = await res1.json();
    expect(json1.ok).toBe(false);
    expect(json1.error.code).toBe("forbidden");
    expect(res1.status).toBe(403);

    await b.setRole("admin");

    const res2 = await fetch(apiUrl("/api/master/partners"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const json2 = await res2.json();
    expect(json2.ok).toBe(true);
    expect(json2.data.tenant_id).toBe(b.tenantId);
  });
});
