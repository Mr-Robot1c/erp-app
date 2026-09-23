import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { getPartnerDebtForStaff } = vi.hoisted(() => ({ getPartnerDebtForStaff: vi.fn() }));
vi.mock("@/server/ai-tools", () => ({ getPartnerDebtForStaff }));

const body = {
  tenant_id: "22222222-2222-4222-8222-222222222222",
  staff_user_id: "11111111-1111-4111-8111-111111111111",
  partner_code: "KH001",
  kind: "receivable",
};

describe("internal partner-debt route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ERP_CHATBOT_SHARED_SECRET = "bridge-secret";
  });

  it("rejects an invalid bridge secret", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/partner-debt", {
      method: "POST", headers: { "x-erp-chat-secret": "wrong-secret!" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(401);
    expect(getPartnerDebtForStaff).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind", async () => {
    const response = await POST(new Request("http://erp.test/api/ai/tools/partner-debt", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify({ ...body, kind: "other" }),
    }));
    expect((await response.json()).error.code).toBe("invalid_argument");
  });

  it("passes authenticated tenant and employee identity to the read service", async () => {
    getPartnerDebtForStaff.mockResolvedValue({
      partner: { code: "KH001", name: "Công ty Khách A" }, kind: "receivable", total_open: 5_000_000,
      aging: { not_due: 5_000_000, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, recent: [],
    });
    const response = await POST(new Request("http://erp.test/api/ai/tools/partner-debt", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    expect(getPartnerDebtForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, body.partner_code, "receivable");
  });

  it("CB-2.6: omitting partner_code requests the top-debtors listing mode", async () => {
    getPartnerDebtForStaff.mockResolvedValue({
      kind: "receivable", truncated: false,
      partners: [{ code: "KH001", name: "Công ty Khách A", total_open: 5_000_000, overdue_amount: 0 }],
    });
    const response = await POST(new Request("http://erp.test/api/ai/tools/partner-debt", {
      method: "POST", headers: { "x-erp-chat-secret": "bridge-secret" },
      body: JSON.stringify({ tenant_id: body.tenant_id, staff_user_id: body.staff_user_id, kind: "receivable" }),
    }));
    expect(response.status).toBe(200);
    expect(getPartnerDebtForStaff).toHaveBeenCalledWith(body.tenant_id, body.staff_user_id, undefined, "receivable");
  });
});
