import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTenantMember, apiUrl, createDocFixture, createItem, createPartner, createTestTenant, createWarehouse, sql,
  type TenantMember, type TestTenant,
} from "./helper";

const SECRET = process.env.ERP_CHATBOT_SHARED_SECRET ?? "test-erp-chatbot-secret";

async function callBridge(path: string, body: unknown, secret = SECRET) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", "x-erp-chat-secret": secret },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("Bộ tool AI CB-2.2 — tách tenant CỨNG", () => {
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let staffA: TenantMember;

  beforeAll(async () => {
    tenantA = await createTestTenant({ role: "admin" });
    tenantB = await createTestTenant({ role: "admin" });
    staffA = await addTenantMember(tenantA.tenantId, "sales");
  });

  afterAll(async () => {
    await staffA?.cleanup();
    await tenantA?.cleanup();
    await tenantB?.cleanup();
  });

  describe("stock-status", () => {
    const sameCode = "AITEST-01";
    let itemA: string;
    let itemBOnly: string;

    beforeAll(async () => {
      itemA = await createItem(tenantA.tenantId, sameCode, { price: 1000 });
      const whA = await createWarehouse(tenantA.tenantId, "AIWH-A");
      await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenantA.tenantId}, ${itemA}, ${whA}, 5, 100)`;

      // Cùng MÃ hàng ở tenant B, số lượng khác — bắt lỗi nếu truy vấn quên lọc tenant_id.
      const itemB = await createItem(tenantB.tenantId, sameCode, { price: 1000 });
      const whB = await createWarehouse(tenantB.tenantId, "AIWH-B");
      await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenantB.tenantId}, ${itemB}, ${whB}, 999, 100)`;

      // Mã hàng CHỈ tồn tại ở tenant B.
      itemBOnly = await createItem(tenantB.tenantId, "AITEST-B-ONLY", { price: 1000 });
      await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenantB.tenantId}, ${itemBOnly}, ${whB}, 3, 100)`;
    });

    it("thiếu/sai secret → unauthenticated", async () => {
      const res = await callBridge("/api/ai/tools/stock-status", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, item_code: sameCode,
      }, "not-the-real-secret");
      expect(res.status).toBe(401);
    });

    it("nhân viên tenant A đọc đúng tồn CỦA TENANT A, không lẫn dù trùng MÃ HÀNG với tenant B", async () => {
      const res = await callBridge("/api/ai/tools/stock-status", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, item_code: sameCode,
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: true, data: { on_hand: 5, available: 5, warehouses: [{ code: "AIWH-A", qty: 5 }] } });
    });

    it("chatbot bịa tenant_id (nhân viên tenant A cho tenant_id của tenant B) → forbidden", async () => {
      const res = await callBridge("/api/ai/tools/stock-status", {
        tenant_id: tenantB.tenantId, staff_user_id: staffA.userId, item_code: sameCode,
      });
      expect(res.status).toBe(403);
      expect(res.json).toMatchObject({ ok: false, error: { code: "forbidden" } });
    });

    it("mã hàng CHỈ tồn tại ở tenant B → nhân viên tenant A tra bằng tenant_id của MÌNH nhận not_found", async () => {
      const res = await callBridge("/api/ai/tools/stock-status", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, item_code: "AITEST-B-ONLY",
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  describe("items-list", () => {
    beforeAll(async () => {
      await createItem(tenantA.tenantId, "AILIST-A1", { price: 1 });
      const itemA2 = await createItem(tenantA.tenantId, "AILIST-A2", { price: 1 });
      const whA2 = await createWarehouse(tenantA.tenantId, "AIWH-LIST-A");
      await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost)
        values (${tenantA.tenantId}, ${itemA2}, ${whA2}, 3, 10)`;
      // Cùng MÃ với A1 ở tenant B — không được lẫn vào kết quả của A.
      await createItem(tenantB.tenantId, "AILIST-A1", { price: 1 });
    });

    it("chatbot bịa tenant_id → forbidden, KHÔNG trả danh sách của tenant khác", async () => {
      const res = await callBridge("/api/ai/tools/items-list", {
        tenant_id: tenantB.tenantId, staff_user_id: staffA.userId, query: "AILIST",
      });
      expect(res.status).toBe(403);
    });

    it("nhân viên tenant A chỉ thấy mặt hàng CỦA TENANT A dù trùng mã với tenant B", async () => {
      const res = await callBridge("/api/ai/tools/items-list", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, query: "AILIST",
      });
      expect(res.status).toBe(200);
      expect(res.json.data.total_matching).toBe(2);
      expect(res.json.data.items.map((i: { code: string }) => i.code).sort()).toEqual(["AILIST-A1", "AILIST-A2"]);
    });

    it("lọc tồn dưới ngưỡng chỉ trả mặt hàng của đúng tenant đang hỏi (cả 2 đều dưới 10: A1 chưa nhập=0, A2=3)", async () => {
      const res = await callBridge("/api/ai/tools/items-list", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, query: "AILIST", low_stock_threshold: 10,
      });
      expect(res.status).toBe(200);
      expect(res.json.data.items.map((i: { code: string }) => i.code).sort()).toEqual(["AILIST-A1", "AILIST-A2"]);
    });
  });

  describe("partner-debt", () => {
    const sameCode = "AIDEBT-01";

    beforeAll(async () => {
      const partnerA = await createPartner(tenantA.tenantId, sameCode, { kind: "customer" });
      const docOverdue = await createDocFixture(tenantA.tenantId, "AIDEBT-INV-1");
      const docNotDue = await createDocFixture(tenantA.tenantId, "AIDEBT-INV-2");
      await sql`insert into receivables (tenant_id, kind, document_id, partner_id, amount, paid, due_date)
        values (${tenantA.tenantId}, 'invoice', ${docOverdue}, ${partnerA}, 3000000, 0, current_date - interval '45 days')`;
      await sql`insert into receivables (tenant_id, kind, document_id, partner_id, amount, paid, due_date)
        values (${tenantA.tenantId}, 'invoice', ${docNotDue}, ${partnerA}, 2000000, 0, current_date + interval '10 days')`;

      // Cùng MÃ đối tác ở tenant B, công nợ khổng lồ — bắt lỗi nếu truy vấn quên lọc tenant_id.
      const partnerB = await createPartner(tenantB.tenantId, sameCode, { kind: "customer" });
      const docB = await createDocFixture(tenantB.tenantId, "AIDEBT-INV-B");
      await sql`insert into receivables (tenant_id, kind, document_id, partner_id, amount, paid, due_date)
        values (${tenantB.tenantId}, 'invoice', ${docB}, ${partnerB}, 999000000, 0, current_date)`;

      // Mã đối tác CHỈ tồn tại ở tenant B.
      await createPartner(tenantB.tenantId, "AIDEBT-B-ONLY", { kind: "customer" });
    });

    it("chatbot bịa tenant_id → forbidden", async () => {
      const res = await callBridge("/api/ai/tools/partner-debt", {
        tenant_id: tenantB.tenantId, staff_user_id: staffA.userId, partner_code: sameCode, kind: "receivable",
      });
      expect(res.status).toBe(403);
    });

    it("nhân viên tenant A đọc đúng công nợ CỦA TENANT A, không lẫn dù trùng MÃ đối tác với tenant B", async () => {
      const res = await callBridge("/api/ai/tools/partner-debt", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, partner_code: sameCode, kind: "receivable",
      });
      expect(res.status).toBe(200);
      expect(res.json.data.total_open).toBe(5000000);
      expect(res.json.data.aging).toMatchObject({ not_due: 2000000, d31_60: 3000000 });
      expect(res.json.data.recent).toHaveLength(2);
    });

    it("mã đối tác CHỈ tồn tại ở tenant B → nhân viên tenant A tra bằng tenant_id của MÌNH nhận not_found", async () => {
      const res = await callBridge("/api/ai/tools/partner-debt", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, partner_code: "AIDEBT-B-ONLY", kind: "receivable",
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });

  describe("invoice-status", () => {
    const sameDocNo = "AIINV-0001";

    beforeAll(async () => {
      await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${tenantA.tenantId}, 'INV', ${sameDocNo}, 'done')`;
      // Cùng SỐ hoá đơn ở tenant B, trạng thái khác — bắt lỗi nếu truy vấn quên lọc tenant_id.
      await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${tenantB.tenantId}, 'INV', ${sameDocNo}, 'draft')`;
    });

    it("chatbot bịa tenant_id → forbidden", async () => {
      const res = await callBridge("/api/ai/tools/invoice-status", {
        tenant_id: tenantB.tenantId, staff_user_id: staffA.userId, record_id: sameDocNo,
      });
      expect(res.status).toBe(403);
    });

    it("nhân viên tenant A đọc đúng hoá đơn CỦA TENANT A, không lẫn dù trùng SỐ với tenant B", async () => {
      const res = await callBridge("/api/ai/tools/invoice-status", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, record_id: sameDocNo,
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ record_id: sameDocNo, status_code: "done" });
    });

    it("hoá đơn CHỈ tồn tại ở tenant B → not_found", async () => {
      await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${tenantB.tenantId}, 'INV', 'AIINV-B-ONLY', 'draft')`;
      const res = await callBridge("/api/ai/tools/invoice-status", {
        tenant_id: tenantA.tenantId, staff_user_id: staffA.userId, record_id: "AIINV-B-ONLY",
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  });
});
