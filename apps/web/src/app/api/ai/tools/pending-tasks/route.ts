import { AppError, ROLES } from "@erp/core";
import { z } from "zod";
import { handle } from "@/server/api";
import { validBridgeSecret } from "@/server/ai-bridge";
import { getPendingTasksForStaff } from "@/server/ai-tools";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  staff_user_id: z.string().uuid(),
  role: z.enum(ROLES).optional(),
});

export const POST = handle(async (req) => {
  if (!validBridgeSecret(req)) throw new AppError("unauthenticated", "Unauthenticated");
  const input = bodySchema.parse(await req.json());
  return getPendingTasksForStaff(input.tenant_id, input.staff_user_id, input.role);
});
