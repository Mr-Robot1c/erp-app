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

/** jsonb qua NextResponse.json có thể tới dạng chuỗi chưa parse (gặp thật ở idempotency_keys.response,
 * server/api.ts) — phòng hờ tương tự khi đọc meta từ response API. */
function asObject(v: unknown): Record<string, unknown> {
  return (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;
}

async function metaOf(docId: string) {
  const [row] = await sql`select meta from documents where id = ${docId}`;
  return asObject(row.meta);
}

describe("chuỗi duyệt đề xuất chi (lô 1.3)", () => {
  let tenant: TestTenant;
  let staff: TenantMember;
  let deptLead: TenantMember;
  let accountant: TenantMember;

  afterEach(async () => {
    await staff?.cleanup();
    await deptLead?.cleanup();
    await accountant?.cleanup();
    await tenant?.cleanup();
  });

  async function setup() {
    tenant = await createTestTenant({ role: "admin" });
    staff = await addTenantMember(tenant.tenantId, "staff");
    deptLead = await addTenantMember(tenant.tenantId, "dept_lead");
    accountant = await addTenantMember(tenant.tenantId, "accountant");
  }

  it("tạo đề xuất dưới ngưỡng -> pending, chuỗi 2 cấp, task cho trưởng bộ phận", async () => {
    await setup();
    const { accessToken } = await staff.signIn();
    const res = await post("/api/expenses", accessToken, { amount: 800_000, purpose: "Tiếp khách" });

    expect(res.json.ok, JSON.stringify(res.json)).toBe(true);
    expect(res.json.data.status).toBe("pending");
    const meta = asObject(res.json.data.meta);
    expect(meta.chain).toEqual(["dept_lead", "accountant"]);

    const [task] = await sql`select role, done from tasks where document_id = ${res.json.data.id}`;
    expect(task.role).toBe("dept_lead");
    expect(task.done).toBe(false);
  });

  it("duyệt đúng vai từng cấp -> đóng/mở task đúng, đủ chuỗi thì confirmed", async () => {
    await setup();
    const { accessToken: staffToken } = await staff.signIn();
    const created = await post("/api/expenses", staffToken, { amount: 800_000, purpose: "Văn phòng phẩm" });
    const docId = created.json.data.id as string;

    const { accessToken: deptToken } = await deptLead.signIn();
    const step1 = await post("/api/approvals/decide", deptToken, { docId, decision: "approve" });
    expect(step1.json.ok, JSON.stringify(step1.json)).toBe(true);
    expect(step1.json.data.status).toBe("pending"); // còn cấp kế toán

    const [deptTask] = await sql`select done from tasks where document_id = ${docId} and role = 'dept_lead'`;
    expect(deptTask.done).toBe(true);
    const [accTask] = await sql`select done from tasks where document_id = ${docId} and role = 'accountant'`;
    expect(accTask.done).toBe(false);

    const { accessToken: accToken } = await accountant.signIn();
    const step2 = await post("/api/approvals/decide", accToken, { docId, decision: "approve" });
    expect(step2.json.ok, JSON.stringify(step2.json)).toBe(true);
    expect(step2.json.data.status).toBe("confirmed");

    const meta = await metaOf(docId);
    expect((meta.approvals as unknown[]).length).toBe(2);
  });

  it("tự duyệt (chính người lập) -> forbidden, kể cả khi vai đang đúng lượt", async () => {
    await setup();
    // dept_lead tự lập đề xuất -> AC-29 bỏ cấp mình, chain chỉ còn accountant. Cho dept_lead tự
    // "duyệt" đề xuất của chính mình phải bị chặn vì LÝ DO NGƯỜI LẬP (kiểm trước cả vòng vai/lượt).
    const { accessToken: deptToken } = await deptLead.signIn();
    const created = await post("/api/expenses", deptToken, { amount: 800_000, purpose: "Test" });
    const docId = created.json.data.id as string;
    const meta = await metaOf(docId);
    expect(meta.chain).toEqual(["accountant"]); // AC-29: bỏ cấp tự duyệt

    const selfDecide = await post("/api/approvals/decide", deptToken, { docId, decision: "approve" });
    expect(selfDecide.json.ok).toBe(false);
    expect(selfDecide.json.error.code).toBe("forbidden");
  });

  it("sai vai / chưa tới lượt -> forbidden", async () => {
    await setup();
    const { accessToken: staffToken } = await staff.signIn();
    const created = await post("/api/expenses", staffToken, { amount: 800_000, purpose: "Test" });
    const docId = created.json.data.id as string;

    // Lượt đầu là dept_lead; accountant duyệt trước là sai vai.
    const { accessToken: accToken } = await accountant.signIn();
    const res = await post("/api/approvals/decide", accToken, { docId, decision: "approve" });
    expect(res.json.ok).toBe(false);
    expect(res.json.error.code).toBe("forbidden");
  });

  it("từ chối không có lý do -> invalid_argument; có lý do -> cancelled", async () => {
    await setup();
    const { accessToken: staffToken } = await staff.signIn();
    const created = await post("/api/expenses", staffToken, { amount: 800_000, purpose: "Test" });
    const docId = created.json.data.id as string;

    const { accessToken: deptToken } = await deptLead.signIn();
    const noReason = await post("/api/approvals/decide", deptToken, { docId, decision: "reject" });
    expect(noReason.json.ok).toBe(false);
    expect(noReason.json.error.code).toBe("invalid_argument");

    const withReason = await post("/api/approvals/decide", deptToken, {
      docId,
      decision: "reject",
      reason: "Không đủ chứng từ",
    });
    expect(withReason.json.ok, JSON.stringify(withReason.json)).toBe(true);
    expect(withReason.json.data.status).toBe("cancelled");

    const [task] = await sql`select done from tasks where document_id = ${docId} and role = 'dept_lead'`;
    expect(task.done).toBe(true);
  });
});
