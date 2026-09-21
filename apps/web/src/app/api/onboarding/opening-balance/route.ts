import { openingBalanceSchema, type Role } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { applyOpeningBalance } from "@/server/opening";

const ROLES: Role[] = ["admin", "chief_accountant"];

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(ROLES, req);
    const body = openingBalanceSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "onboarding.opening-balance", body, () => applyOpeningBalance(s, m, body)));
  },
  { idempotency: "required" },
);
