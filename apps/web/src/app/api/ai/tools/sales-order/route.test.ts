import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getSalesOrderForStaff } = vi.hoisted(() => ({ getSalesOrderForStaff: vi.fn() }));
vi.mock("@/server/ai-read", () => ({ getSalesOrderForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
  record_id: "ĐB-0003",
};

describe("internal normalized sales-order route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("requires the server bridge token", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/sales-order", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getSalesOrderForStaff).not.toHaveBeenCalled();
  });

  it("passes only authenticated bridge identity to the tenant-scoped service", async () => {
    getSalesOrderForStaff.mockResolvedValue({ record_id: "ĐB-0003", status_code: "confirmed", status_label_vi: "Đã xác nhận", customer: {}, totals: {}, items: [] });
    const response = await POST(new Request("http://erp.test/api/ai/tools/sales-order", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(getSalesOrderForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, body.record_id);
  });
});
