import { AppError } from "@erp/core";
import { z } from "zod";
import { handle } from "@/server/api";
import { validBridgeSecret } from "@/server/ai-bridge";
import { getPartnerDebtForStaff } from "@/server/ai-tools";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  staff_user_id: z.string().uuid(),
  // CB-2.6: bỏ trống -> chế độ liệt kê top khách/NCC còn nợ nhiều nhất.
  partner_code: z.string().min(1).max(40).optional(),
  kind: z.enum(["receivable", "payable"]),
});

export const POST = handle(async (req) => {
  if (!validBridgeSecret(req)) throw new AppError("unauthenticated", "Unauthenticated");
  const input = bodySchema.parse(await req.json());
  return getPartnerDebtForStaff(input.tenant_id, input.staff_user_id, input.partner_code, input.kind);
});
