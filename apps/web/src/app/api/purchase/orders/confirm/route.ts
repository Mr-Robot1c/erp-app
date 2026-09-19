import { AppError, can, poIdSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { confirmPurchaseOrder } from "@/server/purchase";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  if (!can(m.role, "cpo")) throw new AppError("forbidden");
  const body = poIdSchema.parse(await req.json());
  return tx((s) => confirmPurchaseOrder(s, m, body.poId));
});
