import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLE_LABEL, type Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { sql, tx } from "@/server/db";
import { acceptInvite } from "@/server/team";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role, display_name")
    .maybeSingle();

  if (!membership && user.email) {
    // RLS chặn user tự đọc invites khi CHƯA có membership (policy theo my_tenant_id()) — phải
    // dùng kết nối server quyền cao để kiểm, rồi tự nhận vai nếu có lời mời đang chờ (lô 1.2).
    const [pendingInvite] = await sql`
      select 1 from invites where email = ${user.email} and status = 'sent' limit 1`;
    if (pendingInvite) {
      await tx((s) => acceptInvite(s, user.id, user.email!));
      ({ data: membership } = await supabase
        .from("memberships")
        .select("tenant_id, role, display_name")
        .maybeSingle());
    }
  }

  if (!membership) redirect("/onboarding");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, industry")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  return (
    <main className="mx-auto mt-16 w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold" id="tenant-title">
        {tenant?.name ?? "ERP"}
      </h1>
      <p className="mt-2 text-sm">
        Đã đăng nhập: <b id="user-email">{user.email}</b> — vai:{" "}
        <b id="user-role">{ROLE_LABEL[membership.role as Role] ?? membership.role}</b>
      </p>
      {membership.role === "admin" && (
        <p className="mt-2 text-sm">
          <Link href="/app/team" id="link-team" className="text-blue-700 underline">
            Quản lý thành viên & vai
          </Link>
        </p>
      )}
      <div className="mt-4">
        <SignOutButton />
      </div>
    </main>
  );
}
