import { redirect } from "next/navigation";
import { Be_Vietnam_Pro, IBM_Plex_Mono } from "next/font/google";
import type { Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { sql, tx } from "@/server/db";
import { acceptInvite } from "@/server/team";
import { AppShell } from "@/components/app-shell";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-app-sans",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-app-mono",
});

/** Khung dùng chung mọi trang /app/* (playbook/03-chuan-giao-dien.md mục B, dựng ở lô 1.2).
 * Đăng nhập + membership + tự nhận lời mời đang chờ (nếu có) kiểm MỘT LẦN ở đây; các trang con
 * bên trong chỉ còn lo phần việc riêng của mình. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role, display_name")
    .eq("user_id", user.id)
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
        .eq("user_id", user.id)
        .maybeSingle());
    }
  }

  if (!membership) redirect("/onboarding");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  // Badge sidebar "Việc cần làm" = việc CỦA TÔI (vai đang đăng nhập), không phải tổng cả công ty (UX-1, 03 mục C3).
  const { count: myTaskCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("done", false)
    .eq("role", membership.role);

  return (
    <AppShell
      taskCount={myTaskCount ?? 0}
      tenantName={tenant?.name ?? "ERP"}
      displayName={membership.display_name}
      role={membership.role as Role}
      fontClassName={`${beVietnamPro.variable} ${ibmPlexMono.variable} font-[family-name:var(--font-app-sans)]`}
    >
      {children}
    </AppShell>
  );
}
