import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getPendingTasksForStaff } = vi.hoisted(() => ({ getPendingTasksForStaff: vi.fn() }));
vi.mock("@/server/ai-tools", () => ({ getPendingTasksForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
};

describe("internal pending-tasks route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("rejects an invalid bridge secret", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/pending-tasks", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getPendingTasksForStaff).not.toHaveBeenCalled();
  });

  it("rejects an unknown role", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/pending-tasks", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify({ ...body, role: "ceo" }),
    }));
    expect((await response.json()).error.code).toBe("invalid_argument");
  });

  it("passes authenticated tenant/employee identity and optional role through", async () => {
    getPendingTasksForStaff.mockResolvedValue({ role: "warehouse", tasks: [], total: 0, truncated: false });
    const response = await POST(new Request("http://erp.test/api/ai/tools/pending-tasks", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify({ ...body, role: "warehouse" }),
    }));
    expect(response.status).toBe(200);
    expect(getPendingTasksForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, "warehouse");
  });
});
