import { AppError } from "@erp/core";
import { z } from "zod";
import { handle } from "@/server/api";
import { validBridgeSecret } from "@/server/ai-bridge";
import { getItemsListForStaff } from "@/server/ai-tools";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  staff_user_id: z.string().uuid(),
  query: z.string().max(80).optional(),
  kind: z.enum(["goods", "service", "material", "finished"]).optional(),
  low_stock_threshold: z.number().int().min(0).max(1_000_000).optional(),
});

export const POST = handle(async (req) => {
  if (!validBridgeSecret(req)) throw new AppError("unauthenticated", "Unauthenticated");
  const input = bodySchema.parse(await req.json());
  return getItemsListForStaff(input.tenant_id, input.staff_user_id, {
    query: input.query, kind: input.kind, lowStockThreshold: input.low_stock_threshold,
  });
});
