import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getStockStatusForStaff } = vi.hoisted(() => ({ getStockStatusForStaff: vi.fn() }));
vi.mock("@/server/ai-tools", () => ({ getStockStatusForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
  item_code: "MLN01",
};

describe("internal stock-status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("rejects an invalid bridge secret", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/stock-status", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getStockStatusForStaff).not.toHaveBeenCalled();
  });

  it("passes authenticated tenant and employee identity to the read service", async () => {
    getStockStatusForStaff.mockResolvedValue({
      item: { code: "MLN01", name: "Máy lọc nước" }, on_hand: 5, reserved: 0, available: 5,
      warehouses: [{ code: "K1", qty: 5 }],
    });
    const response = await POST(new Request("http://erp.test/api/ai/tools/stock-status", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(getStockStatusForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, body.item_code);
  });
});
