import { AppError, can, receiptSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { recordReceipt } from "@/server/settle";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "rcpt")) throw new AppError("forbidden");
    const body = receiptSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "receipts.create", body, () => recordReceipt(s, m, body)));
  },
  { idempotency: "required" },
);
