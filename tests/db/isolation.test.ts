import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestTenant,
  createPartner,
  createItem,
  createWarehouse,
  createAccount,
  createPeriod,
  createAuditLog,
  listTenantScopedTables,
  apiUrl,
  type TestTenant,
} from "./helper";

/**
 * Bài kiểm tách biệt tenant — chạy ở MỌI commit từ lô 0.2 (00-luat-thi-cong).
 * Nâng cấp lô 0.2b (kéo từ GĐ9 xuống): tự phát hiện bảng mới qua information_schema,
 * fixture dương tính cho CẢ hai tenant, và thử ghi trái phép bằng anon client.
 */

// Bảng đã được test này phủ — thêm bảng mới (lô sau) phải thêm vào đây VÀ code fixture/insert
// tương ứng bên dưới, không thì test "tự phát hiện bảng mới" sẽ đỏ có chủ đích.
const COVERED_TABLES = [
  "memberships",
  "partners",
  "items",
  "warehouses",
  "accounts",
  "periods",
  "audit_log",
] as const;

type Filter = { column: string; value: unknown }[];

type WriteCheck = {
  table: (typeof COVERED_TABLES)[number];
  /** null = bỏ qua test insert (payload hợp lệ đụng constraint khác không liên quan RLS, vd memberships) */
  insertPayload: ((b: TestTenant, uniq: string) => Record<string, unknown>) | null;
  ownRowFilter: (b: TestTenant, fixtureIds: Record<string, string>) => Filter;
  updateColumn: string;
  updateValue: unknown;
};

const WRITE_CHECKS: WriteCheck[] = [
  {
    table: "memberships",
    insertPayload: null, // insert hợp lệ đụng FK auth.users / PK trùng — không phải phép thử RLS sạch
    ownRowFilter: (b) => [
      { column: "user_id", value: b.userId },
      { column: "tenant_id", value: b.tenantId },
    ],
    updateColumn: "role",
    updateValue: "admin", // đúng kịch bản đáng sợ nhất: tự phong quyền
  },
  {
    table: "partners",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, code: `HACK_${uniq}`, name: "x", kind: "customer" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.partnerB }],
    updateColumn: "name",
    updateValue: "bị sửa trái phép",
  },
  {
    table: "items",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, code: `HACK_${uniq}`, name: "x", kind: "goods" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.itemB }],
    updateColumn: "name",
    updateValue: "bị sửa trái phép",
  },
  {
    table: "warehouses",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, code: `HACK_${uniq}`, name: "x" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.warehouseB }],
    updateColumn: "name",
    updateValue: "bị sửa trái phép",
  },
  {
    table: "accounts",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, code: `HACK_${uniq}`, name: "x" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.accountB }],
    updateColumn: "name",
    updateValue: "bị sửa trái phép",
  },
  {
    table: "periods",
    insertPayload: (b) => ({ tenant_id: b.tenantId, ym: "2099-02" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.periodB }],
    updateColumn: "status",
    updateValue: "locked",
  },
  {
    table: "audit_log",
    insertPayload: (b) => ({ tenant_id: b.tenantId, action: "hack", ref: "", detail: "" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.auditLogB }],
    updateColumn: "detail",
    updateValue: "bị sửa trái phép",
  },
];

describe("tách biệt dữ liệu giữa doanh nghiệp", () => {
  let a: TestTenant;
  let b: TestTenant;
  let partnerIdA: string;
  let itemIdA: string;
  const fixtureIdsB: Record<string, string> = {};

  beforeAll(async () => {
    a = await createTestTenant({ role: "staff" });
    b = await createTestTenant({ role: "staff" });

    partnerIdA = await createPartner(a.tenantId, "PA1");
    itemIdA = await createItem(a.tenantId, "IA1");
    await createWarehouse(a.tenantId, "WA1");
    await createAccount(a.tenantId, "AA1");
    await createPeriod(a.tenantId, "2099-01");
    await createAuditLog(a.tenantId, "seed");

    fixtureIdsB.partnerB = await createPartner(b.tenantId, "PB0");
    fixtureIdsB.itemB = await createItem(b.tenantId, "IB0");
    fixtureIdsB.warehouseB = await createWarehouse(b.tenantId, "WB0");
    fixtureIdsB.accountB = await createAccount(b.tenantId, "AB0");
    fixtureIdsB.periodB = await createPeriod(b.tenantId, "2099-03");
    fixtureIdsB.auditLogB = await createAuditLog(b.tenantId, "seed");
  });

  afterAll(async () => {
    await a.cleanup();
    await b.cleanup();
  });

  it("tự phát hiện bảng có tenant_id chưa được test này phủ", async () => {
    const actual = await listTenantScopedTables();
    const uncovered = actual.filter((t) => !(COVERED_TABLES as readonly string[]).includes(t));
    expect(uncovered, `bảng mới có tenant_id chưa phủ isolation test: ${uncovered.join(", ")}`).toHaveLength(0);
  });

  it("bảng tenants: B chỉ đọc được dòng của chính mình", async () => {
    const { client } = await b.signIn();
    const { data, error } = await client.from("tenants").select("*");
    expect(error).toBeNull();
    for (const row of data ?? []) expect(row.id).toBe(b.tenantId);
    expect((data ?? []).some((row) => row.id === a.tenantId)).toBe(false);
  });

  it.each(COVERED_TABLES)("bảng %s: B không đọc được dòng của A qua API + RLS (fixture dương tính)", async (table) => {
    const { client } = await b.signIn();
    const { data, error } = await client.from(table).select("*");
    expect(error).toBeNull();
    // Fixture dương tính: B phải THẤY DÒNG CỦA CHÍNH MÌNH (không thì phép kiểm dưới đây vô nghĩa vì rỗng).
    expect((data ?? []).length).toBeGreaterThan(0);
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

  it.each(WRITE_CHECKS)(
    "bảng $table: anon client của B không ghi được (insert/update/delete) dù đúng tenant mình",
    async (check) => {
      const { client } = await b.signIn();
      const uniq = Math.random().toString(36).slice(2, 8);

      if (check.insertPayload) {
        const { data, error } = await client.from(check.table).insert(check.insertPayload(b, uniq)).select();
        // RLS không có policy insert -> Postgres từ chối (error) HOẶC trả rỗng, KHÔNG được thành công có dữ liệu.
        if (!error) expect(data ?? []).toHaveLength(0);
      }

      let query = client.from(check.table).update({ [check.updateColumn]: check.updateValue }).select();
      for (const f of check.ownRowFilter(b, fixtureIdsB)) query = query.eq(f.column, f.value as never);
      const upd = await query;
      // Không có policy update -> 0 dòng bị ảnh hưởng (RLS ẩn hết dòng cho lệnh UPDATE), dù filter đúng dòng của B.
      if (!upd.error) expect(upd.data ?? []).toHaveLength(0);

      let delQuery = client.from(check.table).delete().select();
      for (const f of check.ownRowFilter(b, fixtureIdsB)) delQuery = delQuery.eq(f.column, f.value as never);
      const del = await delQuery;
      if (!del.error) expect(del.data ?? []).toHaveLength(0);
    },
  );

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
