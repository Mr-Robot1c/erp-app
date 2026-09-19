import { AppError, can, adjustSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { requestAdjust } from "@/server/stock-ops";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "adj")) throw new AppError("forbidden");
    const body = adjustSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "stock.adjust", body, () => requestAdjust(s, m, body)));
  },
  { idempotency: "required" },
);
