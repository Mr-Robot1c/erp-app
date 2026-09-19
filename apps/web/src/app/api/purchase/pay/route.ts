import { AppError, can, paySchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { paySupplier } from "@/server/pay";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "pay")) throw new AppError("forbidden");
    const body = paySchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "purchase.pay", body, () => paySupplier(s, m, body)));
  },
  { idempotency: "required" },
);
