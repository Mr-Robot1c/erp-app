import { timingSafeEqual } from "node:crypto";
import { AppError, type Role } from "@erp/core";
import { sql } from "./db";

export type Queryable = <T extends unknown[]>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;

/** Shared secret check for every `apps/web/src/app/api/ai/tools/*` route (CB-2.2 tools). The
 * original CB-1.1 tools (sales-order, sales-order-status) each keep their own inline copy —
 * left alone on purpose, not touched by CB-2. */
export function validBridgeSecret(req: Request): boolean {
  const expected = process.env.ERP_CHATBOT_SHARED_SECRET ?? process.env.JOB_TOKEN;
  const supplied = req.headers.get("x-erp-chat-secret") ?? "";
  if (!expected || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

/**
 * Any real, active member of the tenant may use the CB-2.2 read tools (general assistant, not
 * gated per-screen like the app's own UI nav) — the only hard boundary is tenant membership
 * (chống chatbot bịa tenant, như CB-1.1). Trả về vai để tool nào cần (vd pending-tasks mặc định
 * vai) dùng tiếp; không tự chọn view như `canView` vì tool AI phục vụ mọi vai như nhau.
 */
export async function authorizeStaffMember(
  tenantId: string,
  staffUserId: string,
  db: Queryable = sql as unknown as Queryable,
): Promise<Role> {
  if (!tenantId || !staffUserId) throw new AppError("forbidden", "Bạn không có quyền xem thông tin này.");
  const [member] = await db<{ role: Role }[]>`
    select role from memberships where tenant_id = ${tenantId} and user_id = ${staffUserId}`;
  if (!member) throw new AppError("forbidden", "Bạn không có quyền xem thông tin này.");
  return member.role;
}
