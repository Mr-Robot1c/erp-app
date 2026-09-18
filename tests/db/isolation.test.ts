import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestTenant,
  createPartner,
  createItem,
  createWarehouse,
  createAccount,
  createPeriod,
  createAuditLog,
  createDocFixture,
  createDocLineFixture,
  createDocHistoryFixture,
  createDocSequenceFixture,
  createIdempotencyKeyFixture,
  listTenantScopedTables,
  apiUrl,
  type TestTenant,
} from "./helper";

/**
 * Bài kiểm tách biệt tenant — chạy ở MỌI commit từ lô 0.2 (00-luat-thi-cong).
 * Nâng cấp lô 0.2b (kéo từ GĐ9 xuống): tự phát hiện bảng mới qua information_schema,
 * fixture dương tính cho CẢ hai tenant, và thử ghi trái phép bằng anon client.
 * Nâng cấp lô 0.3: thêm các bảng khung chứng từ (documents, document_lines, doc_status_history
 * có SELECT policy; doc_sequences, idempotency_keys KHÔNG có policy nào — client không đọc được
 * kể cả dữ liệu của chính mình, xử lý riêng).
 */

// Bảng CÓ policy SELECT cho client — dùng phép kiểm "thấy dòng mình, không thấy dòng người khác".
const READ_TABLES = [
  "memberships",
  "partners",
  "items",
  "warehouses",
  "accounts",
  "periods",
  "audit_log",
  "documents",
  "document_lines",
  "doc_status_history",
] as const;

// Bảng RLS bật nhưng KHÔNG policy nào (kể cả SELECT) — client luôn thấy 0 dòng, dù là tenant nào.
const NO_ACCESS_TABLES = ["doc_sequences", "idempotency_keys"] as const;

// Toàn bộ bảng đã được test này phủ — thêm bảng mới (lô sau) phải thêm vào đây (đúng nhóm) VÀ
// code fixture/insert tương ứng bên dưới, không thì test "tự phát hiện bảng mới" sẽ đỏ có chủ đích.
const COVERED_TABLES = [...READ_TABLES, ...NO_ACCESS_TABLES] as const;

type Filter = { column: string; value: unknown }[];

type WriteCheck = {
  table: (typeof COVERED_TABLES)[number];
  /** null = bỏ qua test insert (payload hợp lệ đụng constraint khác không liên quan RLS, vd memberships) */
  insertPayload: ((b: TestTenant, uniq: string, fixtureIds: Record<string, string>) => Record<string, unknown>) | null;
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
  {
    table: "documents",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, doc_type: "QUOTE", doc_no: `HACK_${uniq}` }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.documentB }],
    updateColumn: "doc_no",
    updateValue: "HACKED-9999",
  },
  {
    table: "document_lines",
    insertPayload: (b, _uniq, ids) => ({
      tenant_id: b.tenantId,
      document_id: ids.documentB,
      line_no: 999,
      qty: 1,
      price: 1,
    }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.docLineB }],
    updateColumn: "qty",
    updateValue: 999,
  },
  {
    table: "doc_status_history",
    insertPayload: (b, uniq, ids) => ({
      tenant_id: b.tenantId,
      document_id: ids.documentB,
      to_status: `hack_${uniq}`,
    }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.docHistoryB }],
    updateColumn: "note",
    updateValue: "bị sửa trái phép",
  },
  {
    table: "doc_sequences",
    insertPayload: (b) => ({ tenant_id: b.tenantId, doc_type: "ADJ", last_no: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "doc_type", value: ids.docSeqTypeB }],
    updateColumn: "last_no",
    updateValue: 999,
  },
  {
    table: "idempotency_keys",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, key: `hack_${uniq}`, endpoint: "x", response: {} }),
    ownRowFilter: (_b, ids) => [{ column: "key", value: ids.idempotencyKeyB }],
    updateColumn: "endpoint",
    updateValue: "hacked",
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
    const docIdA = await createDocFixture(a.tenantId, "TESTA-0001");
    await createDocLineFixture(a.tenantId, docIdA);
    await createDocHistoryFixture(a.tenantId, docIdA);
    await createDocSequenceFixture(a.tenantId, "QUOTE");
    await createIdempotencyKeyFixture(a.tenantId, "seed-a");

    fixtureIdsB.partnerB = await createPartner(b.tenantId, "PB0");
    fixtureIdsB.itemB = await createItem(b.tenantId, "IB0");
    fixtureIdsB.warehouseB = await createWarehouse(b.tenantId, "WB0");
    fixtureIdsB.accountB = await createAccount(b.tenantId, "AB0");
    fixtureIdsB.periodB = await createPeriod(b.tenantId, "2099-03");
    fixtureIdsB.auditLogB = await createAuditLog(b.tenantId, "seed");
    fixtureIdsB.documentB = await createDocFixture(b.tenantId, "TESTB-0001");
    fixtureIdsB.docLineB = await createDocLineFixture(b.tenantId, fixtureIdsB.documentB);
    fixtureIdsB.docHistoryB = await createDocHistoryFixture(b.tenantId, fixtureIdsB.documentB);
    await createDocSequenceFixture(b.tenantId, "QUOTE");
    fixtureIdsB.docSeqTypeB = "QUOTE";
    fixtureIdsB.idempotencyKeyB = "seed-b";
    await createIdempotencyKeyFixture(b.tenantId, fixtureIdsB.idempotencyKeyB);
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

  it.each(READ_TABLES)("bảng %s: B không đọc được dòng của A qua API + RLS (fixture dương tính)", async (table) => {
    const { client } = await b.signIn();
    const { data, error } = await client.from(table).select("*");
    expect(error).toBeNull();
    // Fixture dương tính: B phải THẤY DÒNG CỦA CHÍNH MÌNH (không thì phép kiểm dưới đây vô nghĩa vì rỗng).
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.tenant_id).toBe(b.tenantId);
    expect((data ?? []).some((row) => row.tenant_id === a.tenantId)).toBe(false);
  });

  it.each(NO_ACCESS_TABLES)("bảng %s: RLS bật nhưng không policy nào -> B luôn thấy 0 dòng, kể cả của chính mình", async (table) => {
    const { client } = await b.signIn();
    const { data, error } = await client.from(table).select("*");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
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
        const { data, error } = await client.from(check.table).insert(check.insertPayload(b, uniq, fixtureIdsB)).select();
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
