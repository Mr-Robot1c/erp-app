import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

async function activity(token: string | null) {
  const res = await fetch(apiUrl("/api/dashboard/activity"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: "{}",
  });
  return { status: res.status, json: await res.json() };
}

// UI-3 3.1 + 3.2: feed hoạt động + "chứng từ tôi lập" — khuôn ai-tools.test.ts: 2 tenant, cùng SỐ chứng từ, dữ liệu tenant kia lớn hơn hẳn.
describe("UI-3 /api/dashboard/activity — tách tenant CỨNG", () => {
  let a: TestTenant;
  let b: TestTenant;
  let staffA: TenantMember;
  const sameNo = "HD-UI3-1";

  beforeAll(async () => {
    a = await createTestTenant({ role: "admin" });
    b = await createTestTenant({ role: "admin" });
    staffA = await addTenantMember(a.tenantId, "sales");

    // Tenant A: 1 chứng từ do staffA lập (đang xử lý) + 1 do admin A lập + 1 của staffA nhưng đã xong (không được hiện ở "mine").
    await sql`insert into documents (tenant_id, doc_type, doc_no, status, created_by, created_by_name) values
      (${a.tenantId}, 'QUOTE', ${sameNo}, 'draft', ${staffA.userId}, 'Nhân viên A'),
      (${a.tenantId}, 'QUOTE', 'UI3-ADMIN', 'draft', ${a.userId}, 'Admin A'),
      (${a.tenantId}, 'QUOTE', 'UI3-XONG', 'done', ${staffA.userId}, 'Nhân viên A')`;
    await sql`insert into audit_log (tenant_id, actor, action, ref) values
      (${a.tenantId}, 'Nhân viên A', 'doc.create', ${sameNo}), (${a.tenantId}, 'Admin A', 'doc.create', 'UI3-ADMIN')`;

    // Tenant B: CÙNG số chứng từ + cùng user id staffA ghi ở created_by (bắt lỗi quên lọc tenant_id) + nhiều audit hơn hẳn.
    await sql`insert into documents (tenant_id, doc_type, doc_no, status, created_by, created_by_name) values
      (${b.tenantId}, 'QUOTE', ${sameNo}, 'pending', ${staffA.userId}, 'Người của B'),
      (${b.tenantId}, 'QUOTE', 'UI3-CHIB', 'draft', ${staffA.userId}, 'Người của B')`;
    for (let i = 0; i < 12; i++) await sql`insert into audit_log (tenant_id, actor, action, ref) values (${b.tenantId}, 'BÍ MẬT B', 'doc.create', ${i === 0 ? sameNo : "UI3-B-" + i})`;
  });

  afterAll(async () => {
    await staffA?.cleanup();
    await a?.cleanup();
    await b?.cleanup();
  });

  it("chưa đăng nhập -> 401", async () => {
    expect((await activity(null)).status).toBe(401);
  });

  it("feed CHỈ có hoạt động của tenant mình (không lẫn 12 dòng của B, nhãn tiếng Việt không lộ mã); số trùng gắn đúng chứng từ tenant A", async () => {
    const { accessToken } = await staffA.signIn();
    const r = await activity(accessToken);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const feed = r.json.data.activity as { actor: string; label: string; ref: string; doc: { status: string } | null }[];
    expect(feed.map((f) => f.ref).sort()).toEqual([sameNo, "UI3-ADMIN"].sort());
    expect(JSON.stringify(feed)).not.toContain("BÍ MẬT B");
    expect(feed.every((f) => f.label === "lập")).toBe(true); // "doc.create" -> "lập"
    expect(feed.find((f) => f.ref === sameNo)?.doc?.status).toBe("draft"); // bản của A (draft), không phải bản của B (pending)
  });

  it("\"mine\": chỉ chứng từ do CHÍNH người gọi lập, chưa kết thúc, đúng tenant — không thấy của admin A, của B, hay cái đã xong", async () => {
    const { accessToken } = await staffA.signIn();
    const mine = (await activity(accessToken)).json.data.mine as { docNo: string; status: string }[];
    expect(mine).toEqual([expect.objectContaining({ docNo: sameNo, status: "draft" })]);

    const adminA = await a.signIn();
    expect((await activity(adminA.accessToken)).json.data.mine.map((d: { docNo: string }) => d.docNo)).toEqual(["UI3-ADMIN"]);
  });

  it("tenant B thấy feed của MÌNH (10 dòng mới nhất), không thấy A", async () => {
    const { accessToken } = await b.signIn();
    const data = (await activity(accessToken)).json.data;
    expect(data.activity).toHaveLength(10);
    expect(data.activity.every((x: { actor: string }) => x.actor === "BÍ MẬT B")).toBe(true);
    expect(data.mine).toEqual([]); // người tạo là staffA (khác user đăng nhập của B)
  });
});
