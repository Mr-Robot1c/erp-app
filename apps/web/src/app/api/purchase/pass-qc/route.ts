import { AppError, can, passQcSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { passQc } from "@/server/receive";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "grn")) throw new AppError("forbidden");
    const body = passQcSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "purchase.pass-qc", body, () => passQc(s, m, body.grnId)));
  },
  { idempotency: "required" },
);
