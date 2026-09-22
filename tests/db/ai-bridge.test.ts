import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

const SECRET = process.env.ERP_CHATBOT_SHARED_SECRET ?? "test-erp-chatbot-secret";

async function callBridge(path: string, body: unknown, secret = SECRET) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", "x-erp-chat-secret": secret },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("Cầu nối AI (CB-1.1) — tách tenant CỨNG", () => {
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let staffA: TenantMember;
  const sameDocNo = "ĐB-BRIDGE-1";
  const onlyInB = "ĐB-BRIDGE-2";

  beforeAll(async () => {
    tenantA = await createTestTenant({ role: "admin" });
    tenantB = await createTestTenant({ role: "admin" });
    staffA = await addTenantMember(tenantA.tenantId, "sales");

    // Cùng SỐ chứng từ ở CẢ HAI tenant, trạng thái khác nhau — bắt lỗi nếu truy vấn quên lọc theo tenant_id.
    await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${tenantA.tenantId}, 'SO', ${sameDocNo}, 'confirmed')`;
    await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${tenantB.tenantId}, 'SO', ${sameDocNo}, 'draft')`;
    // Chứng từ CHỈ tồn tại ở tenant B — dùng để chứng minh nhân viên tenant A không đọc lén được dù biết đúng số.
    await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${tenantB.tenantId}, 'SO', ${onlyInB}, 'confirmed')`;
  });

  afterAll(async () => {
    await staffA?.cleanup();
    await tenantA?.cleanup();
    await tenantB?.cleanup();
  });

  it("thiếu/sai secret cầu nối → unauthenticated, không lộ dữ liệu", async () => {
    const noSecret = await callBridge("/api/ai/tools/sales-order-status", {
      tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, record_id: sameDocNo,
    }, "");
    expect(noSecret.status).toBe(401);

    const wrongSecret = await callBridge("/api/ai/tools/sales-order-status", {
      tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, record_id: sameDocNo,
    }, "not-the-real-secret");
    expect(wrongSecret.status).toBe(401);
  });

  it("nhân viên tenant A đọc đúng chứng từ CỦA TENANT A, không lẫn dữ liệu tenant B dù trùng SỐ chứng từ", async () => {
    const res = await callBridge("/api/ai/tools/sales-order-status", {
      tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, record_id: sameDocNo,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, data: { record_id: sameDocNo, status_code: "confirmed" } });
  });

  it("chatbot bịa tenant_id (dùng nhân viên tenant A cho tenant_id của tenant B) → forbidden, KHÔNG trả dữ liệu tenant B", async () => {
    const res = await callBridge("/api/ai/tools/sales-order-status", {
      tenant_id: tenantB.tenantId, staff_user_id: staffA.userId, record_id: sameDocNo,
    });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("đơn CHỈ tồn tại ở tenant B → nhân viên tenant A tra bằng tenant_id của MÌNH nhận not_found dù biết đúng số, không phân biệt được với đơn không tồn tại (chống dò tên chứng từ xuyên tenant)", async () => {
    const res = await callBridge("/api/ai/tools/sales-order-status", {
      tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, record_id: onlyInB,
    });
    // 02-quyet-dinh mục F: mọi lỗi ngoài 401/403 trả HTTP 200, phân biệt bằng ok:false + error.code.
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
