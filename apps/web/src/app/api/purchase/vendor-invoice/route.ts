import { vendorInvoiceSchema, type Role } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { vendorInvoice } from "@/server/vinv";

// Ghi hoá đơn mua: mua hàng (PERMS 'vinv') và kế toán (giữ sổ phải trả) — spec gd3 ghi "accountant".
const ROLES: Role[] = ["admin", "purchasing", "accountant", "chief_accountant"];

export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(ROLES, req);
    const body = vendorInvoiceSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");
    return tx((s) => withIdempotency(s, m.tenantId, key, "purchase.vendor-invoice", body, () => vendorInvoice(s, m, body)));
  },
  { idempotency: "required" },
);
