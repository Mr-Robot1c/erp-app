import { AppError, can, deliverSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { deliverOrder } from "@/server/deliver";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "deliver")) throw new AppError("forbidden");
    const body = deliverSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "orders.deliver", body, () => deliverOrder(s, m, body)));
  },
  { idempotency: "required" },
);
