import { purchaseReturnSchema, type Role } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { purchaseReturn } from "@/server/returns";

const ROLES: Role[] = ["admin", "purchasing", "warehouse"];

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(ROLES, req);
    const body = purchaseReturnSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "purchase.return", body, () => purchaseReturn(s, m, body)));
  },
  { idempotency: "required" },
);
