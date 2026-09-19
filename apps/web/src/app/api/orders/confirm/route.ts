import { AppError, can, orderIdSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { confirmOrder } from "@/server/orders";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  if (!can(m.role, "cso")) throw new AppError("forbidden");
  const body = orderIdSchema.parse(await req.json());
  return tx((s) => confirmOrder(s, m, body.orderId));
});
