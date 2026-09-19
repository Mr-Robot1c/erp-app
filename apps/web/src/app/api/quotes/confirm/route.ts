import { AppError, can, quoteIdSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { confirmQuote } from "@/server/quotes";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  if (!can(m.role, "cq")) throw new AppError("forbidden");
  const body = quoteIdSchema.parse(await req.json());
  return tx((s) => confirmQuote(s, m, body.quoteId));
});
