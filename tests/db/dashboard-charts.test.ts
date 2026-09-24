import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createDocFixture, createGd2Fixtures, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

async function charts(token: string | null, months?: unknown) {
  const res = await fetch(apiUrl("/api/dashboard/charts"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(months === undefined ? {} : { months }),
  });
  return { status: res.status, json: await res.json() };
}

const ymOf = (back: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
};

/** Bút toán doanh thu (Nợ 111 / Có 511) cân trong 1 transaction, ngày = mùng 1 của tháng `back` tháng trước. */
async function revenueEntry(tenantId: string, documentId: string, back: number, amount: number) {
  await sql.begin(async (t) => {
    const [e] = await t`
      insert into journal_entries (tenant_id, entry_date, document_id, memo)
      values (${tenantId}, ${ymOf(back) + "-01"}::date, ${documentId}, 'charts') returning id`;
    await t`insert into journal_lines (tenant_id, entry_id, account_code, debit, credit) values (${tenantId}, ${e.id}, '111', ${amount}, 0)`;
    await t`insert into journal_lines (tenant_id, entry_id, account_code, debit, credit) values (${tenantId}, ${e.id}, '511', 0, ${amount})`;
  });
}

describe("UI-2 I.5 — dữ liệu 2 biểu đồ Tổng quan, tách tenant CỨNG", () => {
  let a: TestTenant;
  let b: TestTenant;
  let staffA: TenantMember;
  let accA: TenantMember;

  beforeAll(async () => {
    a = await createTestTenant({ role: "admin" });
    b = await createTestTenant({ role: "admin" });
    staffA = await addTenantMember(a.tenantId, "staff");
    accA = await addTenantMember(a.tenantId, "accountant");

    // Tenant A: QUOTE nháp (từ fixture) + SO chờ duyệt + SO xác nhận (tháng này) + QUOTE hoàn tất từ 4 tháng trước.
    const docA = await createDocFixture(a.tenantId, "CH-A1"); // QUOTE draft hôm nay
    await createGd2Fixtures(a.tenantId, docA, "ca"); // bút toán Có 511 = 100 tháng này
    await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${a.tenantId}, 'SO', 'CH-A2', 'pending'), (${a.tenantId}, 'SO', 'CH-A3', 'confirmed')`;
    await sql`insert into documents (tenant_id, doc_type, doc_no, status, doc_date) values (${a.tenantId}, 'QUOTE', 'CH-A4', 'done', ${ymOf(4) + "-01"}::date)`;
    await revenueEntry(a.tenantId, docA, 2, 700);

    // Tenant B: nhiều hơn hẳn — không được lẫn vào A.
    const docB = await createDocFixture(b.tenantId, "CH-B1");
    await createGd2Fixtures(b.tenantId, docB, "cb");
    await revenueEntry(b.tenantId, docB, 0, 5000);
    for (let i = 0; i < 5; i++) await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${b.tenantId}, 'INV', ${"CH-BI" + i}, 'draft')`;
  });

  afterAll(async () => {
    await accA?.cleanup();
    await staffA?.cleanup();
    await a?.cleanup();
    await b?.cleanup();
  });

  it("chưa đăng nhập -> 401; months ngoài {1,3,6} -> invalid_argument", async () => {
    expect((await charts(null, 3)).status).toBe(401);
    const { accessToken } = await a.signIn();
    expect((await charts(accessToken, 2)).json.error.code).toBe("invalid_argument");
  });

  it("đếm chứng từ theo loại × trạng thái CHỈ của tenant mình; mặc định 3 tháng loại bản ghi 4 tháng trước, 6 tháng thì có", async () => {
    const { accessToken } = await a.signIn();
    const key = (d: { docType: string; status: string; count: number }) => `${d.docType}:${d.status}:${d.count}`;
    const def = await charts(accessToken); // mặc định 3
    expect(def.json.ok, JSON.stringify(def.json)).toBe(true);
    expect(def.json.data.months).toBe(3);
    expect(def.json.data.docs.map(key).sort()).toEqual(["QUOTE:draft:1", "SO:confirmed:1", "SO:pending:1"]);
    expect((await charts(accessToken, 1)).json.data.docs.map(key).sort()).toEqual(["QUOTE:draft:1", "SO:confirmed:1", "SO:pending:1"]);
    expect((await charts(accessToken, 6)).json.data.docs.map(key).sort()).toEqual(["QUOTE:done:1", "QUOTE:draft:1", "SO:confirmed:1", "SO:pending:1"]);
  });

  it("doanh thu 6 tháng: đúng số của tenant mình theo từng tháng, tháng không có = 0, không lẫn tenant B (5000)", async () => {
    const { accessToken } = await accA.signIn();
    const r = await charts(accessToken, 3);
    const rev: { ym: string; value: number }[] = r.json.data.revenue;
    expect(rev.map((p) => p.ym)).toEqual([5, 4, 3, 2, 1, 0].map(ymOf));
    expect(Object.fromEntries(rev.map((p) => [p.ym, p.value]))).toEqual({
      [ymOf(5)]: 0, [ymOf(4)]: 0, [ymOf(3)]: 0, [ymOf(2)]: 700, [ymOf(1)]: 0, [ymOf(0)]: 100,
    });
  });

  it("vai không xem được Kế toán (staff) vẫn thấy đếm chứng từ nhưng revenue = null (không lộ số tiền)", async () => {
    const { accessToken } = await staffA.signIn();
    const r = await charts(accessToken, 3);
    expect(r.json.ok).toBe(true);
    expect(r.json.data.revenue).toBeNull();
    expect(r.json.data.docs.length).toBeGreaterThan(0);
  });

  it("tenant B thấy số của MÌNH (5 hoá đơn nháp, doanh thu tháng này 5100)", async () => {
    const { accessToken } = await b.signIn();
    const r = await charts(accessToken, 3);
    expect(r.json.data.docs.find((d: { docType: string }) => d.docType === "INV")).toMatchObject({ status: "draft", count: 5 });
    expect(r.json.data.revenue.at(-1)).toEqual({ ym: ymOf(0), value: 5100 });
  });
});
