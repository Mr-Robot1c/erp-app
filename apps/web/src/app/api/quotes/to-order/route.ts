import { AppError, can, quoteToOrderSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { quoteToOrder } from "@/server/orders";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "q2o")) throw new AppError("forbidden");
    const body = quoteToOrderSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "quotes.to-order", body, () => quoteToOrder(s, m, body)));
  },
  { idempotency: "required" },
);
