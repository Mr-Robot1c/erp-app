import { AppError, type Role } from "@erp/core";
import { createClient } from "./supabase";
import { sql } from "./db";

export type Member = {
  userId: string;
  tenantId: string;
  role: Role;
  displayName: string;
};

/** Người dùng đã đăng nhập (theo cookie phiên). Chưa đăng nhập -> unauthenticated. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("unauthenticated");
  return user;
}

/** Người dùng + membership (tenant, vai). roles nếu truyền -> chặn vai ngoài danh sách. */
export async function requireMember(roles?: Role[]): Promise<Member> {
  const user = await requireUser();
  const rows = await sql<
    { tenant_id: string; role: Role; display_name: string }[]
  >`select tenant_id, role, display_name from memberships where user_id = ${user.id}`;
  const row = rows[0];
  if (!row) throw new AppError("no_tenant");
  if (roles && !roles.includes(row.role)) throw new AppError("forbidden");
  return {
    userId: user.id,
    tenantId: row.tenant_id,
    role: row.role,
    displayName: row.display_name,
  };
}
