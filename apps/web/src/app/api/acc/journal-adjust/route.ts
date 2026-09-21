import { journalAdjustSchema, type Role } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { journalAdjust } from "@/server/period-ops";

const ROLES: Role[] = ["admin", "chief_accountant"];

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(ROLES, req);
    const body = journalAdjustSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "acc.journal-adjust", body, () => journalAdjust(s, m, body)));
  },
  { idempotency: "required" },
);
