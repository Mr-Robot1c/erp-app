import { setRoleSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { setTeamRole } from "@/server/team";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  const body = setRoleSchema.parse(await req.json());
  return tx((s) => setTeamRole(s, m, body.userId, body.role));
});
