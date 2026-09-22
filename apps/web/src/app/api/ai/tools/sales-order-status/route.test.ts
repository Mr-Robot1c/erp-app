import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getSalesOrderStatusForStaff } = vi.hoisted(() => ({ getSalesOrderStatusForStaff: vi.fn() }));
vi.mock("@/server/ai-read", () => ({ getSalesOrderStatusForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
  record_id: "ĐB-0003",
};

describe("internal sales-order status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("rejects an invalid bridge secret", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/sales-order-status", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getSalesOrderStatusForStaff).not.toHaveBeenCalled();
  });

  it("passes authenticated tenant and employee identity to the read service", async () => {
    getSalesOrderStatusForStaff.mockResolvedValue({ record_id: "ĐB-0003", status_code: "confirmed", status_label_vi: "Đã xác nhận" });
    const response = await POST(new Request("http://erp.test/api/ai/tools/sales-order-status", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(getSalesOrderStatusForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, body.record_id);
  });
});
