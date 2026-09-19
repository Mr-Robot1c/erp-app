import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { expireQuotes } from "@/server/quotes";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  return tx((s) => expireQuotes(s, m));
});
