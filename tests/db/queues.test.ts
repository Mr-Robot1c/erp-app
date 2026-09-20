import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createItem, createPartner, createTestTenant, createWarehouse, sql, type TenantMember, type TestTenant } from "./helper";

async function queues(token: string) {
  const res = await fetch(apiUrl("/api/dashboard/queues"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: "{}",
  });
  return { status: res.status, json: await res.json() };
}

describe("thẻ việc theo bộ phận (lô 3.6) — công thức đếm mục C2", () => {
  let tenant: TestTenant;
  let other: TestTenant;
  let staff: TenantMember;
  let seq = 0;

  const doc = async (t: TestTenant, type: string, status: string, meta: Record<string, unknown> = {}, partnerId: string | null = null) => {
    const [row] = await sql`
      insert into documents (tenant_id, doc_type, doc_no, status, partner_id, meta)
      values (${t.tenantId}, ${type}, ${`Q36-${++seq}`}, ${status}, ${partnerId}, ${sql.json(meta as never)}) returning id`;
    return row.id as string;
  };

  beforeAll(async () => {
    tenant = await createTestTenant({ role: "admin" });
    other = await createTestTenant({ role: "admin" });
    staff = await addTenantMember(tenant.tenantId, "staff");
    const partner = await createPartner(tenant.tenantId, "KH1");
    const item = await createItem(tenant.tenantId, "X");
    const item2 = await createItem(tenant.tenantId, "Y");
    const k1 = await createWarehouse(tenant.tenantId, "K1");
    const qc = await createWarehouse(tenant.tenantId, "QC");

    // Kinh doanh: 1 báo giá chờ duyệt (+1 đã gửi, không tính), 1 đơn nháp, 1 đơn chờ duyệt
    await doc(tenant, "QUOTE", "pending");
    await doc(tenant, "QUOTE", "confirmed");
    await doc(tenant, "SO", "draft");
    await doc(tenant, "SO", "pending");
    // Kho — chờ xuất: SO confirmed CÓ giữ hàng (đếm) / SO partial CÓ giữ (đếm) / SO confirmed hết giữ (không đếm)
    const so1 = await doc(tenant, "SO", "confirmed");
    const so2 = await doc(tenant, "SO", "partial");
    await doc(tenant, "SO", "confirmed");
    await sql`insert into reservations (tenant_id, document_id, line_no, item_id, qty) values (${tenant.tenantId}, ${so1}, 1, ${item}, 2), (${tenant.tenantId}, ${so2}, 1, ${item}, 1)`;
    // Kho — chờ nhận: PO confirmed chưa nhận (đếm), PO partial chưa đủ (đếm), PO đã nhận đủ / đóng thiếu (không đếm)
    await doc(tenant, "PO", "confirmed");
    await doc(tenant, "PO", "partial", { receivedAll: false });
    await doc(tenant, "PO", "partial", { receivedAll: true });
    await doc(tenant, "PO", "partial", { receivedAll: false, closedShort: true });
    // Kho — chờ QC: mặt hàng X còn 5 ở QC (đếm); Y nhập 3 rồi chuyển hết 3 (không đếm)
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty) values
      (${tenant.tenantId}, ${item}, ${qc}, 5), (${tenant.tenantId}, ${item2}, ${qc}, 3), (${tenant.tenantId}, ${item2}, ${qc}, -3), (${tenant.tenantId}, ${item2}, ${k1}, 3)`;
    // Kế toán: 2 hoá đơn nháp, 1 phiếu thu chờ khớp tay (2 dòng phân bổ cùng 1 phiếu chỉ đếm 1), 1 phiếu chi chờ duyệt
    await doc(tenant, "INV", "draft", {}, partner);
    await doc(tenant, "INV", "draft", {}, partner);
    await doc(tenant, "INV", "done", {}, partner);
    const rcpt = await doc(tenant, "RCPT", "done", {}, partner);
    await sql`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note) values
      (${tenant.tenantId}, ${rcpt}, null, 100, 'Ứng trước'), (${tenant.tenantId}, ${rcpt}, null, 50, 'Ứng trước')`;
    const rcpt2 = await doc(tenant, "RCPT", "done", {}, partner);
    await sql`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note) values (${tenant.tenantId}, ${rcpt2}, null, 10, 'Hoàn trả hàng')`; // không phải chờ khớp
    await doc(tenant, "PAY", "pending", {}, partner);
    await doc(tenant, "PAY", "done", {}, partner);

    // Tenant khác: dữ liệu KHÔNG được lẫn vào
    await doc(other, "QUOTE", "pending");
    await doc(other, "INV", "draft");
  });

  afterAll(async () => {
    await staff?.cleanup();
    await tenant?.cleanup();
    await other?.cleanup();
  });

  it("đếm đúng từng ô theo công thức C2, không lẫn tenant khác, vai staff cũng đọc được", async () => {
    const { accessToken } = await staff.signIn();
    const r = await queues(accessToken);
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data).toEqual({
      sales: { quotePending: 1, soDraft: 1, soPending: 1 },
      warehouse: { toShip: 2, toReceive: 2, qcItems: 1 },
      accounting: { invDraft: 2, unmatched: 1, payPending: 1 },
    });
  });

  it("chưa đăng nhập -> unauthenticated; tenant khác thấy số của mình", async () => {
    const anon = await fetch(apiUrl("/api/dashboard/queues"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await anon.json()).error.code).toBe("unauthenticated");
    const { accessToken } = await other.signIn();
    const r = await queues(accessToken);
    expect(r.json.data.sales.quotePending).toBe(1);
    expect(r.json.data.accounting.invDraft).toBe(1);
    expect(r.json.data.warehouse).toEqual({ toShip: 0, toReceive: 0, qcItems: 0 });
  });
});
