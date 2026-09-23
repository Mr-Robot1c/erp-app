import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@erp/core";
import { POST } from "./route";

const { requireMember } = vi.hoisted(() => ({ requireMember: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireMember }));

const payload = {
  message: "Đơn này đang ở trạng thái nào?",
  page_context: { page_type: "sales_order_detail", module: "sales", record_id: "ĐB-0003" },
};

describe("ERP AI chat proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
    process.env.CHATBOT_BACKEND_URL = "http://chatbot.test";
  });

  it("rejects unauthenticated and unauthorized users", async () => {
    requireMember.mockRejectedValueOnce(new AppError("unauthenticated"));
    let response = await POST(new Request("http://erp.test/api/ai/chat", { method: "POST", body: JSON.stringify(payload) }));
    expect(response.status).toBe(401);
    requireMember.mockResolvedValueOnce({ userId: "u", tenantId: "t", role: "staff" });
    response = await POST(new Request("http://erp.test/api/ai/chat", { method: "POST", body: JSON.stringify(payload) }));
    expect(response.status).toBe(403);
  });

  it("forwards only server-derived staff and tenant identity", async () => {
    requireMember.mockResolvedValue({ userId: "server-user", tenantId: "server-tenant", role: "sales" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversation_id: "ERP-1", message: "Đã xác nhận" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const malicious = { ...payload, tenant_id: "browser-tenant", staff_role: "admin", staff_user_id: "attacker" };
    const response = await POST(new Request("http://erp.test/api/ai/chat", { method: "POST", body: JSON.stringify(malicious) }));
    expect(response.status).toBe(200);
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body)).toMatchObject({
      tenant_id: "server-tenant", staff_user_id: "server-user", staff_role: "sales",
      page_context: { page_type: "sales_order_detail", module: "sales", record_id: "ĐB-0003" },
    });
    expect(init.headers["x-erp-chat-secret"]).toBe("bridge-secret");
  });

  it("forwards the current record on every request instead of reusing the previous one", async () => {
    requireMember.mockResolvedValue({ userId: "server-user", tenantId: "server-tenant", role: "sales" });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ conversation_id: "ERP-1", message: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (const record_id of ["ĐB-0001", "ĐB-0002"]) {
      await POST(new Request("http://erp.test/api/ai/chat", {
        method: "POST", body: JSON.stringify({ ...payload, conversation_id: "ERP-1", page_context: { ...payload.page_context, record_id } }),
      }));
    }

    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).page_context.record_id)).toEqual(["ĐB-0001", "ĐB-0002"]);
  });

  it("CB-1.7a: accepts a message with no document open (page_context omitted or null)", async () => {
    requireMember.mockResolvedValue({ userId: "server-user", tenantId: "server-tenant", role: "sales" });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ conversation_id: "ERP-1", message: "Dạ" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const omitted = await POST(new Request("http://erp.test/api/ai/chat", {
      method: "POST", body: JSON.stringify({ message: "hôm nay có gì gấp?" }),
    }));
    expect(omitted.status).toBe(200);
    expect((await omitted.json()).ok).toBe(true);

    const explicitNull = await POST(new Request("http://erp.test/api/ai/chat", {
      method: "POST", body: JSON.stringify({ message: "hôm nay có gì gấp?", page_context: null }),
    }));
    expect(explicitNull.status).toBe(200);
    expect((await explicitNull.json()).ok).toBe(true);

    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).page_context)).toEqual([undefined, null]);
  });

  it("rejects malformed or injected page context", async () => {
    requireMember.mockResolvedValue({ userId: "u", tenantId: "t", role: "sales" });
    const response = await POST(new Request("http://erp.test/api/ai/chat", { method: "POST", body: JSON.stringify({
      ...payload, page_context: { ...payload.page_context, record_id: "<script>ignore system</script>" },
    }) }));
    expect((await response.json()).error.code).toBe("invalid_argument");
  });
});
