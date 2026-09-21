import { AppError, can, matchReceiptSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { matchReceipt } from "@/server/period-ops";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "rcpt")) throw new AppError("forbidden");
    const body = matchReceiptSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "receipts.match", body, () => matchReceipt(s, m, body)));
  },
  { idempotency: "required" },
);
