import { lockPeriodSchema, type Role } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { lockPeriod } from "@/server/period-ops";

const ROLES: Role[] = ["admin", "chief_accountant"];

export const POST = handle(async (req: Request) => {
  const m = await requireMember(ROLES, req);
  const body = lockPeriodSchema.parse(await req.json());
  return tx((s) => lockPeriod(s, m, body.ym));
});
