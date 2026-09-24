import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createPartner, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

async function search(token: string | null, q: unknown) {
  const res = await fetch(apiUrl("/api/search/documents"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ q }),
  });
  return { status: res.status, json: await res.json() };
}

describe("UI-2 I.3 — ô tìm chứng từ toàn cục, tách tenant CỨNG", () => {
  let a: TestTenant;
  let b: TestTenant;
  let staffA: TenantMember;
  const sameNo = "TIM-0001";

  beforeAll(async () => {
    a = await createTestTenant({ role: "admin" });
    b = await createTestTenant({ role: "admin" });
    staffA = await addTenantMember(a.tenantId, "staff");
    const pa = await createPartner(a.tenantId, "KHA"); // tên "Đối tác KHA"
    const pb = await createPartner(b.tenantId, "KHSECRET");
    // Cùng SỐ ở cả 2 tenant; tenant B có thêm đối tác + chứng từ riêng để bắt lỗi quên lọc tenant_id.
    await sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${a.tenantId}, 'SO', ${sameNo}, 'confirmed', ${pa})`;
    await sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${b.tenantId}, 'SO', ${sameNo}, 'draft', ${pb})`;
    await sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${b.tenantId}, 'QUOTE', 'TIM-CHIB', 'draft', ${pb})`;
    for (let i = 1; i <= 10; i++) await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${a.tenantId}, 'QUOTE', ${"NHIEU-" + i}, 'draft')`;
  });

  afterAll(async () => {
    await staffA?.cleanup();
    await a?.cleanup();
    await b?.cleanup();
  });

  it("chưa đăng nhập -> unauthenticated (401); q rỗng/quá dài -> invalid_argument", async () => {
    expect((await search(null, "TIM")).status).toBe(401);
    const { accessToken } = await staffA.signIn();
    expect((await search(accessToken, "")).json.error.code).toBe("invalid_argument");
    expect((await search(accessToken, "x".repeat(61))).json.error.code).toBe("invalid_argument");
  });

  it("tìm theo số: chỉ thấy chứng từ CỦA TENANT A dù tenant B trùng số; vai staff cũng tìm được", async () => {
    const { accessToken } = await staffA.signIn();
    const r = await search(accessToken, "tim-0001");
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.hits).toHaveLength(1);
    expect(r.json.data.hits[0]).toMatchObject({ docNo: sameNo, docType: "SO", status: "confirmed", partnerName: "Đối tác KHA" });
  });

  it("chứng từ + đối tác CHỈ có ở tenant B: tenant A không tìm thấy (theo số lẫn theo tên đối tác)", async () => {
    const { accessToken } = await staffA.signIn();
    expect((await search(accessToken, "TIM-CHIB")).json.data.hits).toEqual([]);
    expect((await search(accessToken, "KHSECRET")).json.data.hits).toEqual([]);
    const own = await b.signIn();
    expect((await search(own.accessToken, "KHSECRET")).json.data.hits.map((h: { docNo: string }) => h.docNo).sort()).toEqual([sameNo, "TIM-CHIB"].sort());
  });

  it("giới hạn 8 kết quả; ký tự % _ được coi là chữ thường, không thành ký tự đại diện", async () => {
    const { accessToken } = await staffA.signIn();
    expect((await search(accessToken, "NHIEU")).json.data.hits).toHaveLength(8);
    expect((await search(accessToken, "%")).json.data.hits).toEqual([]);
    expect((await search(accessToken, "_")).json.data.hits).toEqual([]);
  });
});
