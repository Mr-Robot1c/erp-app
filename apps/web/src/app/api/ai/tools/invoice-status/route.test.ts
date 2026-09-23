import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getInvoiceStatusForStaff } = vi.hoisted(() => ({ getInvoiceStatusForStaff: vi.fn() }));
vi.mock("@/server/ai-tools", () => ({ getInvoiceStatusForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
  record_id: "HĐ-0001",
};

describe("internal invoice-status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("rejects an invalid bridge secret", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/invoice-status", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getInvoiceStatusForStaff).not.toHaveBeenCalled();
  });

  it("passes authenticated tenant and employee identity to the read service", async () => {
    getInvoiceStatusForStaff.mockResolvedValue({
      record_id: "HĐ-0001", status_code: "done", status_label_vi: "Đã thực hiện",
      amount: 11_000_000, paid: 11_000_000, remaining: 0, due_date: "2026-10-01",
    });
    const response = await POST(new Request("http://erp.test/api/ai/tools/invoice-status", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(getInvoiceStatusForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, body.record_id);
  });
});
