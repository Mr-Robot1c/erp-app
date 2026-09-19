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
  createInviteFixture,
  createTaskFixture,
  createGd2Fixtures,
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
 * Lô 1.1: `industry_templates` KHÔNG có cột tenant_id (bảng dùng chung mọi tenant, policy select
 * using(true) cố ý public để trang đăng ký đọc được trước khi có membership) — không bị auto-detect
 * bên dưới quét tới (chỉ quét cột tenant_id) nên không cần thêm vào COVERED_TABLES.
 * Lô 1.2: thêm `invites` (có SELECT policy theo tenant_id, như các bảng thường).
 * Lô 1.3: thêm `tasks` (có SELECT policy theo tenant_id, như các bảng thường).
 * Lô 2.2 (migration 0009): thêm 8 bảng GĐ2 (stock_moves, reservations, receivables, receipt_allocations,
 * partner_advances, bank_txns, journal_entries, journal_lines) + 2 VIEW (v_on_hand, v_available —
 * security_invoker, quét y như bảng: B đọc qua view chỉ thấy dòng của B).
 * Lô 3.3 (migration 0012): thêm payables, payment_allocations.
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
  "invites",
  "tasks",
  "stock_moves",
  "reservations",
  "receivables",
  "receipt_allocations",
  "partner_advances",
  "bank_txns",
  "journal_entries",
  "journal_lines",
  "payables",
  "payment_allocations",
  "v_on_hand",
  "v_available",
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
  {
    table: "invites",
    insertPayload: (b, uniq) => ({ tenant_id: b.tenantId, email: `hack_${uniq}@test.local`, role: "staff" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.inviteB }],
    updateColumn: "role",
    updateValue: "admin",
  },
  {
    table: "tasks",
    insertPayload: (b, _uniq, ids) => ({ tenant_id: b.tenantId, role: "admin", text: "hack", document_id: ids.documentB }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.taskB }],
    updateColumn: "done",
    updateValue: true,
  },
  {
    table: "stock_moves",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, item_id: ids.g2ItemB, warehouse_id: ids.g2WarehouseB, qty: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.stockMoveB }],
    updateColumn: "qty",
    updateValue: 999,
  },
  {
    table: "reservations",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, document_id: ids.documentB, line_no: 77, item_id: ids.g2ItemB, qty: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.reservationB }],
    updateColumn: "qty",
    updateValue: 999,
  },
  {
    table: "receivables",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, kind: "invoice", partner_id: ids.g2PartnerB, amount: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.receivableB }],
    updateColumn: "paid",
    updateValue: 999,
  },
  {
    table: "receipt_allocations",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, receipt_id: ids.documentB, amount: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.allocB }],
    updateColumn: "amount",
    updateValue: 999,
  },
  {
    table: "partner_advances",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, partner_id: ids.g2PartnerB, amount: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "partner_id", value: ids.g2PartnerB }],
    updateColumn: "amount",
    updateValue: 999,
  },
  {
    table: "bank_txns",
    insertPayload: (b, u, ids) => ({ tenant_id: b.tenantId, bank_ref: `hack_${u}`, receipt_id: ids.documentB }),
    ownRowFilter: (_b, ids) => [{ column: "bank_ref", value: ids.bankRefB }],
    updateColumn: "bank_ref",
    updateValue: "hacked",
  },
  {
    table: "payables",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, partner_id: ids.g2PartnerB, amount: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.payableB }],
    updateColumn: "paid",
    updateValue: 999,
  },
  {
    table: "payment_allocations",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, payment_id: ids.documentB, payable_id: ids.payableB, amount: 1 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.payAllocB }],
    updateColumn: "amount",
    updateValue: 999,
  },
  {
    table: "journal_entries",
    insertPayload: (b) => ({ tenant_id: b.tenantId, entry_date: "2099-01-01" }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.entryB }],
    updateColumn: "memo",
    updateValue: "bị sửa trái phép",
  },
  {
    table: "journal_lines",
    insertPayload: (b, _u, ids) => ({ tenant_id: b.tenantId, entry_id: ids.entryB, account_code: "111", debit: 1, credit: 0 }),
    ownRowFilter: (_b, ids) => [{ column: "id", value: ids.journalLineB }],
    updateColumn: "account_code",
    updateValue: "999",
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
    await createInviteFixture(a.tenantId, "seed-a@test.local", "staff");
    await createTaskFixture(a.tenantId, docIdA, "admin");
    await createGd2Fixtures(a.tenantId, docIdA, "A");

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
    fixtureIdsB.inviteB = await createInviteFixture(b.tenantId, "seed-b@test.local", "staff");
    fixtureIdsB.taskB = await createTaskFixture(b.tenantId, fixtureIdsB.documentB, "admin");
    const g2 = await createGd2Fixtures(b.tenantId, fixtureIdsB.documentB, "B");
    fixtureIdsB.g2ItemB = g2.itemId;
    fixtureIdsB.g2WarehouseB = g2.warehouseId;
    fixtureIdsB.g2PartnerB = g2.partnerId;
    fixtureIdsB.stockMoveB = g2.stockMoveId;
    fixtureIdsB.reservationB = g2.reservationId;
    fixtureIdsB.receivableB = g2.receivableId;
    fixtureIdsB.allocB = g2.allocId;
    fixtureIdsB.payableB = g2.payableId;
    fixtureIdsB.payAllocB = g2.payAllocId;
    fixtureIdsB.bankRefB = g2.bankRef;
    fixtureIdsB.entryB = g2.entryId;
    fixtureIdsB.journalLineB = g2.journalLineId;
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
