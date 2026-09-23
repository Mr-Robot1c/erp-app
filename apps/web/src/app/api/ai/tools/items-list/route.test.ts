import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getItemsListForStaff } = vi.hoisted(() => ({ getItemsListForStaff: vi.fn() }));
vi.mock("@/server/ai-tools", () => ({ getItemsListForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
};

describe("internal items-list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("rejects an invalid bridge secret", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/items-list", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getItemsListForStaff).not.toHaveBeenCalled();
  });

  it("passes filters through to the read service", async () => {
    getItemsListForStaff.mockResolvedValue({ items: [], total_matching: 0, truncated: false });
    const response = await POST(new Request("http://erp.test/api/ai/tools/items-list", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" },
      body: JSON.stringify({ ...body, query: "máy lọc", low_stock_threshold: 10 }),
    }));
    expect(response.status).toBe(200);
    expect(getItemsListForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, {
      query: "máy lọc", kind: undefined, lowStockThreshold: 10,
    });
  });
});
