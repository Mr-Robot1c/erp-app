import { removeMemberSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { removeTeamMember } from "@/server/team";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  const body = removeMemberSchema.parse(await req.json());
  return tx((s) => removeTeamMember(s, m, body.userId));
});
