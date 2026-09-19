import { AppError, can, quoteSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { createQuote } from "@/server/quotes";

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(undefined, req);
    if (!can(m.role, "quote")) throw new AppError("forbidden");
    const body = quoteSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "quotes.create", body, () => createQuote(s, m, body)));
  },
  { idempotency: "required" },
);
