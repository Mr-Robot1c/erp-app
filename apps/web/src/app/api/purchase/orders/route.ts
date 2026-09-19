import { AppError, can, purchaseOrderSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { createPurchaseOrder } from "@/server/purchase";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "po")) throw new AppError("forbidden");
    const body = purchaseOrderSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "purchase.orders.create", body, () => createPurchaseOrder(s, m, body)));
  },
  { idempotency: "required" },
);
