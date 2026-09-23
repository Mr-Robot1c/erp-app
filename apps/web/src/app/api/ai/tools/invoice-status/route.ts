import { AppError } from "@erp/core";
import { z } from "zod";
import { handle } from "@/server/api";
import { validBridgeSecret } from "@/server/ai-bridge";
import { getInvoiceStatusForStaff } from "@/server/ai-tools";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  staff_user_id: z.string().uuid(),
  record_id: z.string().regex(/^[A-Za-zÀ-ỹĐđ0-9_-]{1,40}$/),
});

export const POST = handle(async (req) => {
  if (!validBridgeSecret(req)) throw new AppError("unauthenticated", "Unauthenticated");
  const input = bodySchema.parse(await req.json());
  return getInvoiceStatusForStaff(input.tenant_id, input.staff_user_id, input.record_id);
});
