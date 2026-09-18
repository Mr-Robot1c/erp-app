import { registerTenantSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireUser } from "@/server/auth";
import { tx } from "@/server/db";
import { registerTenant } from "@/server/onboarding";

export const POST = handle(async (req: Request) => {
  const user = await requireUser(req);
  const body = registerTenantSchema.parse(await req.json());
  return tx((s) => registerTenant(s, user.id, user.email ?? "", body));
});
