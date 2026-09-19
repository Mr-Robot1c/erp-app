import { AppError, can, orderIdSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { refulfilOrder } from "@/server/orders";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  if (!can(m.role, "deliver")) throw new AppError("forbidden");
  const body = orderIdSchema.parse(await req.json());
  return tx((s) => refulfilOrder(s, m, body.orderId));
});
