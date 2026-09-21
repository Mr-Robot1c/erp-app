import type { Role } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { removeSampleForOnboarding } from "@/server/opening";

const ROLES: Role[] = ["admin", "chief_accountant"];

export const POST = handle(async (req: Request) => {
  const m = await requireMember(ROLES, req);
  return tx((s) => removeSampleForOnboarding(s, m));
});
