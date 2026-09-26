import { handle } from "@/server/api";
import { requireMember, requireRole } from "@/server/auth";
import { getExecDashboard } from "@/server/dashboard-exec";

export const POST = handle(async (req: Request) => {
  const member = await requireMember(undefined, req);
  requireRole(["admin", "director"], member);
  return getExecDashboard(member.tenantId);
});
