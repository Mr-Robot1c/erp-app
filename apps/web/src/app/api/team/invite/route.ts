import { inviteSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { inviteTeamMember } from "@/server/team";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  const body = inviteSchema.parse(await req.json());
  return tx((s) => inviteTeamMember(s, m, body));
});
