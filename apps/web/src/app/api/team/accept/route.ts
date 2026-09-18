import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { tx } from "@/server/db";
import { acceptInvite } from "@/server/team";

export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  return tx((s) => acceptInvite(s, user.id, user.email ?? ""));
});
