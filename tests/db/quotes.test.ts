import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTenantMember,
  apiUrl,
  createItem,
  createPartner,
  createTestTenant,
  sql,
  type TenantMember,
  type TestTenant,
} from "./helper";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const idem = () => ({ "idempotency-key": randomUUID() });

describe("báo giá (lô 2.1) — AC-06, AC-07", () => {
  let tenant: TestTenant;
  let sales: TenantMember;
  let salesLead: TenantMember;
  let partnerId: string;
  let itemId: string;
  let salesToken: string;
  let leadToken: string;
  let adminToken: string;

  beforeEach(async () => {
    tenant = await createTestTenant({ role: "admin" });
    sales = await addTenantMember(tenant.tenantId, "sales");
    salesLead = await addTenantMember(tenant.tenantId, "sales_lead");
    partnerId = await createPartner(tenant.tenantId, "KH1");
    itemId = await createItem(tenant.tenantId, "SP1", { price: 1_000_000 });
    salesToken = (await sales.signIn()).accessToken;
    leadToken = (await salesLead.signIn()).accessToken;
    adminToken = (await tenant.signIn()).accessToken;
  });

  afterEach(async () => {
    await sales?.cleanup();
    await salesLead?.cleanup();
    await tenant?.cleanup();
  });

  async function newQuote(price: number, token = salesToken) {
    const res = await post("/api/quotes", token, { partnerId, lines: [{ itemId, qty: 2, price }] }, idem());
    expect(res.json.ok, JSON.stringify(res.json)).toBe(true);
    return res.json.data.id as string;
  }

  it("AC-06 giá thấp hơn bảng: xác nhận -> pending (chưa gửi được), 1 việc cho trưởng KD; trưởng KD duyệt -> confirmed", async () => {
    const quoteId = await newQuote(950_000); // 95% giá bảng
    const conf = await post("/api/quotes/confirm", salesToken, { quoteId });
    expect(conf.json.ok, JSON.stringify(conf.json)).toBe(true);
    expect(conf.json.data.status).toBe("pending");

    const [{ ty }] = await sql`select jsonb_typeof(meta) as ty from documents where id = ${quoteId}`;
    expect(ty).toBe("object"); // hồi quy: meta từng bị mã hoá 2 lần thành chuỗi
    const tasks = await sql`select role, done from tasks where document_id = ${quoteId}`;
    expect(tasks.filter((t) => t.role === "sales_lead" && !t.done)).toHaveLength(1);

    // Người lập không tự duyệt được; đúng vai khác thì duyệt được.
    const self = await post("/api/approvals/decide", salesToken, { docId: quoteId, decision: "approve" });
    expect(self.json.error.code).toBe("forbidden");
    const ok = await post("/api/approvals/decide", leadToken, { docId: quoteId, decision: "approve" });
    expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    expect(ok.json.data.status).toBe("confirmed");
  });

  it("giá bằng bảng giá: xác nhận thẳng -> confirmed, không có việc treo", async () => {
    const quoteId = await newQuote(1_000_000);
    const conf = await post("/api/quotes/confirm", salesToken, { quoteId });
    expect(conf.json.data.status).toBe("confirmed");
    const tasks = await sql`select 1 from tasks where document_id = ${quoteId}`;
    expect(tasks).toHaveLength(0);
  });

  it("trưởng KD tự lập giá thấp: bỏ cấp tự duyệt, confirmed thẳng", async () => {
    const quoteId = await newQuote(900_000, leadToken);
    const conf = await post("/api/quotes/confirm", leadToken, { quoteId });
    expect(conf.json.data.status).toBe("confirmed");
  });

  it("AC-07 quá hạn: sweep -> cancelled 'Hết hạn'; admin mới gọi được sweep", async () => {
    const quoteId = await newQuote(1_000_000);
    await post("/api/quotes/confirm", salesToken, { quoteId });
    await sql`update documents set meta = meta || '{"validTo":"2020-01-01"}'::jsonb where id = ${quoteId}`;

    const denied = await post("/api/quotes/expire-sweep", salesToken, {});
    expect(denied.json.error.code).toBe("forbidden");

    const swept = await post("/api/quotes/expire-sweep", adminToken, {});
    expect(swept.json.ok, JSON.stringify(swept.json)).toBe(true);
    expect(swept.json.data.expired).toBe(1);
    const [doc] = await sql`select status from documents where id = ${quoteId}`;
    expect(doc.status).toBe("cancelled");
    const [hist] = await sql`select note from doc_status_history where document_id = ${quoteId} order by id desc limit 1`;
    expect(hist.note).toBe("Hết hạn");
  });

  it("báo giá còn hạn không bị sweep", async () => {
    const quoteId = await newQuote(1_000_000);
    await post("/api/quotes/confirm", salesToken, { quoteId });
    const swept = await post("/api/quotes/expire-sweep", adminToken, {});
    expect(swept.json.data.expired).toBe(0);
    const [doc] = await sql`select status from documents where id = ${quoteId}`;
    expect(doc.status).toBe("confirmed");
  });

  it("lập cùng Idempotency-Key 2 lần -> 1 báo giá; thiếu key -> invalid_argument; nhà cung cấp -> invalid_argument", async () => {
    const key = { "idempotency-key": randomUUID() };
    const body = { partnerId, lines: [{ itemId, qty: 1, price: 1_000_000 }] };
    const a = await post("/api/quotes", salesToken, body, key);
    const b = await post("/api/quotes", salesToken, body, key);
    expect(a.json.data.id).toBe(b.json.data.id);
    const [{ n }] = await sql`select count(*)::int n from documents where tenant_id = ${tenant.tenantId} and doc_type = 'QUOTE'`;
    expect(n).toBe(1);

    const noKey = await post("/api/quotes", salesToken, body);
    expect(noKey.json.error.code).toBe("invalid_argument");

    const supplier = await createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    const bad = await post("/api/quotes", salesToken, { ...body, partnerId: supplier }, idem());
    expect(bad.json.error.code).toBe("invalid_argument");
  });
});
