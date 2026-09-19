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

describe("yêu cầu mua → đơn mua, duyệt theo ngưỡng (lô 3.1) — AC-20", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let buyerToken: string;
  let leadToken: string;
  let chiefToken: string;
  let salesToken: string;
  let supplierId: string;
  let customerId: string;
  let itemId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const buyer = await addTenantMember(tenant.tenantId, "purchasing");
    const lead = await addTenantMember(tenant.tenantId, "dept_lead");
    const chief = await addTenantMember(tenant.tenantId, "chief_accountant");
    const sales = await addTenantMember(tenant.tenantId, "sales");
    members.push(buyer, lead, chief, sales);
    buyerToken = (await buyer.signIn()).accessToken;
    leadToken = (await lead.signIn()).accessToken;
    chiefToken = (await chief.signIn()).accessToken;
    salesToken = (await sales.signIn()).accessToken;
    supplierId = await createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    customerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    itemId = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  const newPo = (token: string, qty: number, price: number) =>
    post("/api/purchase/orders", token, { supplierId, lines: [{ itemId, qty, price }] }, idem());
  const chainOf = async (id: string) => (await sql`select meta from documents where id = ${id}`)[0].meta.chain as string[];

  it("AC-20 ca 1: tổng vượt ngưỡng 20tr -> pending, chuỗi 2 cấp [trưởng bộ phận, kế toán trưởng]; duyệt đủ -> confirmed + hạn giao", async () => {
    const po = await newPo(buyerToken, 1, 25_000_000);
    expect(po.json.ok, JSON.stringify(po.json)).toBe(true);
    expect(po.json.data.status).toBe("draft");
    const id = po.json.data.id as string;

    const c = await post("/api/purchase/orders/confirm", buyerToken, { poId: id });
    expect(c.json.ok, JSON.stringify(c.json)).toBe(true);
    expect(c.json.data.status).toBe("pending");
    expect(await chainOf(id)).toEqual(["dept_lead", "chief_accountant"]);
    const [{ n }] = await sql`select count(*)::int n from tasks where document_id = ${id} and role = 'dept_lead' and not done`;
    expect(n).toBe(1);

    const wrongTurn = await post("/api/approvals/decide", chiefToken, { docId: id, decision: "approve" });
    expect(wrongTurn.json.error.code).toBe("forbidden");
    const s1 = await post("/api/approvals/decide", leadToken, { docId: id, decision: "approve" });
    expect(s1.json.data.status).toBe("pending");
    const s2 = await post("/api/approvals/decide", chiefToken, { docId: id, decision: "approve" });
    expect(s2.json.data.status).toBe("confirmed");

    const [doc] = await sql`select meta from documents where id = ${id}`;
    const eta = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    expect(doc.meta.eta).toBe(eta);
    expect(doc.meta.sentToSupplier).toBe(true);
  });

  it("AC-20 ca 2: tổng trong ngưỡng -> vẫn có 1 cấp duyệt [trưởng bộ phận], KHÔNG confirmed thẳng", async () => {
    const po = await newPo(buyerToken, 1, 5_000_000);
    const c = await post("/api/purchase/orders/confirm", buyerToken, { poId: po.json.data.id });
    expect(c.json.data.status).toBe("pending");
    expect(await chainOf(po.json.data.id)).toEqual(["dept_lead"]);
  });

  it("chỉ vai mua hàng (và admin) lập/xác nhận đơn mua; trưởng bộ phận, bán hàng bị chặn (403)", async () => {
    const byLead = await post("/api/purchase/orders", leadToken, { supplierId, lines: [{ itemId, qty: 1, price: 1 }] }, idem());
    expect(byLead.json.error.code).toBe("forbidden");
    const bySales = await post("/api/purchase/orders", salesToken, { supplierId, lines: [{ itemId, qty: 1, price: 1 }] }, idem());
    expect(bySales.json.error.code).toBe("forbidden");
  });

  it("từ yêu cầu mua: sao chép dòng, PR -> done + tham chiếu 2 chiều, mang forSO sang đơn mua; PR đã chuyển -> state_invalid", async () => {
    // Đơn bán thiếu hàng (kho 0) -> PR tự sinh (lô 2.3).
    const q = await post("/api/quotes", salesToken, { partnerId: customerId, lines: [{ itemId, qty: 3, price: 1_000_000 }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    const [pr] = await sql`select id, doc_no from documents where tenant_id = ${tenant.tenantId} and doc_type = 'PR' and meta->>'forSO' = ${o.json.data.id}`;

    const po = await post("/api/purchase/orders", buyerToken, { supplierId, fromPrId: pr.id }, idem());
    expect(po.json.ok, JSON.stringify(po.json)).toBe(true);
    const poId = po.json.data.id as string;

    const lines = await sql`select qty, price from document_lines where document_id = ${poId}`;
    expect(lines.map((l) => [Number(l.qty), Number(l.price)])).toEqual([[3, 500_000]]); // giá vốn danh mục của PR
    const [prAfter] = await sql`select status, refs from documents where id = ${pr.id}`;
    expect(prAfter.status).toBe("done");
    expect(prAfter.refs).toHaveLength(2); // đơn bán gốc + đơn mua
    const [poDoc] = await sql`select meta, refs from documents where id = ${poId}`;
    expect(poDoc.meta.forSO).toBe(o.json.data.id);
    expect(poDoc.refs).toEqual([pr.doc_no]);
    expect(await sql`select 1 from tasks where document_id = ${pr.id} and not done`).toHaveLength(0);

    const again = await post("/api/purchase/orders", buyerToken, { supplierId, fromPrId: pr.id }, idem());
    expect(again.json.error.code).toBe("state_invalid");
  });

  it("nhà cung cấp là khách hàng / thiếu dòng và thiếu PR / xác nhận đơn không nháp -> lỗi rõ ràng", async () => {
    const bad = await post("/api/purchase/orders", buyerToken, { supplierId: customerId, lines: [{ itemId, qty: 1, price: 1 }] }, idem());
    expect(bad.json.error.code).toBe("invalid_argument");
    const empty = await post("/api/purchase/orders", buyerToken, { supplierId }, idem());
    expect(empty.json.error.code).toBe("invalid_argument");

    const po = await newPo(buyerToken, 1, 1_000_000);
    await post("/api/purchase/orders/confirm", buyerToken, { poId: po.json.data.id });
    const twice = await post("/api/purchase/orders/confirm", buyerToken, { poId: po.json.data.id });
    expect(twice.json.error.code).toBe("state_invalid");
  });
});
