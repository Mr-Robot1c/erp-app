import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { AppError, type Role } from "@erp/core";
import { createClient } from "./supabase";
import { sql } from "./db";

export type Member = {
  userId: string;
  tenantId: string;
  role: Role;
  displayName: string;
};

/**
 * Người dùng đã đăng nhập. Ưu tiên header `Authorization: Bearer <access_token>` (server-to-server,
 * test tích hợp gọi API trực tiếp không qua cookie trình duyệt); không có thì đọc session theo cookie
 * (@supabase/ssr, dùng cho trang web thật). Chưa đăng nhập -> unauthenticated.
 */
export async function requireUser(req?: Request) {
  const authHeader = req?.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const anon = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) throw new AppError("unauthenticated");
    return data.user;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("unauthenticated");
  return user;
}

/** Người dùng + membership (tenant, vai). roles nếu truyền -> chặn vai ngoài danh sách. */
export async function requireMember(roles?: Role[], req?: Request): Promise<Member> {
  const user = await requireUser(req);
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

/** Cổng vai tách riêng cho route cần xác thực membership trước rồi mới chặn quyền. */
export function requireRole(roles: Role[], member: Member): Member {
  if (!roles.includes(member.role)) throw new AppError("forbidden");
  return member;
}
