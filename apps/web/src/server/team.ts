import type { TransactionSql } from "postgres";
import { AppError, type InviteInput, type Role } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { supabaseAdmin } from "./supabase-admin";

export async function inviteTeamMember(s: TransactionSql, m: Member, input: InviteInput) {
  const dup = await s`select 1 from invites where tenant_id = ${m.tenantId} and email = ${input.email}`;
  if (dup.length) throw new AppError("duplicate", "Email này đã được mời rồi");

  const [invite] = await s`
    insert into invites (tenant_id, email, role)
    values (${m.tenantId}, ${input.email}, ${input.role})
    returning *`;

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(input.email);
  if (error) throw new AppError("internal", `Không gửi được email mời: ${error.message}`);

  await audit(s, m.tenantId, m.displayName || m.userId, "team.invite", input.email, input.role);
  return invite;
}

/** User đăng nhập, có invite 'sent' khớp email, CHƯA có membership -> tạo membership theo invite.role. */
export async function acceptInvite(s: TransactionSql, userId: string, email: string) {
  const [existing] = await s`select 1 from memberships where user_id = ${userId}`;
  if (existing) throw new AppError("conflict", "Tài khoản đã thuộc một doanh nghiệp");

  const [invite] = await s`
    select * from invites where email = ${email} and status = 'sent' limit 1`;
  if (!invite) throw new AppError("not_found", "Không có lời mời nào đang chờ cho email này");

  const displayName = email.split("@")[0] || email;
  await s`
    insert into memberships (user_id, tenant_id, role, display_name)
    values (${userId}, ${invite.tenant_id}, ${invite.role}, ${displayName})`;
  await s`update invites set status = 'accepted' where id = ${invite.id}`;

  await audit(s, invite.tenant_id as string, displayName, "team.accept", email, invite.role as string);
  return { tenantId: invite.tenant_id as string };
}

async function assertNotLastAdmin(s: TransactionSql, tenantId: string, targetRole: string, newRole?: string) {
  if (targetRole !== "admin" || newRole === "admin") return;
  const [{ n }] = await s<{ n: number }[]>`
    select count(*)::int as n from memberships where tenant_id = ${tenantId} and role = 'admin'`;
  if (n <= 1) throw new AppError("state_invalid", "Không thể bỏ quản trị viên cuối cùng của doanh nghiệp");
}

export async function setTeamRole(s: TransactionSql, m: Member, targetUserId: string, role: Role) {
  const [target] = await s`
    select role from memberships where user_id = ${targetUserId} and tenant_id = ${m.tenantId}`;
  if (!target) throw new AppError("not_found", "Không tìm thấy thành viên");

  await assertNotLastAdmin(s, m.tenantId, target.role as string, role);

  await s`
    update memberships set role = ${role} where user_id = ${targetUserId} and tenant_id = ${m.tenantId}`;
  await audit(s, m.tenantId, m.displayName || m.userId, "team.set_role", targetUserId, role);
}

export async function removeTeamMember(s: TransactionSql, m: Member, targetUserId: string) {
  const [target] = await s`
    select role from memberships where user_id = ${targetUserId} and tenant_id = ${m.tenantId}`;
  if (!target) throw new AppError("not_found", "Không tìm thấy thành viên");

  await assertNotLastAdmin(s, m.tenantId, target.role as string);

  await s`delete from memberships where user_id = ${targetUserId} and tenant_id = ${m.tenantId}`;
  await audit(s, m.tenantId, m.displayName || m.userId, "team.remove", targetUserId, target.role as string);
}
