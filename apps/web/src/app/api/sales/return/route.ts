import { salesReturnSchema, type Role } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { salesReturn } from "@/server/returns";

const ROLES: Role[] = ["admin", "sales_lead", "sales"];

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(ROLES, req);
    const body = salesReturnSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "sales.return", body, () => salesReturn(s, m, body)));
  },
  { idempotency: "required" },
);
