import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("tenant_id, role, display_name")
    .maybeSingle();
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
        Đã đăng nhập: <b id="user-email">{user.email}</b> — vai: <b id="user-role">{membership.role}</b>
      </p>
      <p className="mt-1 text-sm text-zinc-500">Lô 1.1 — đăng ký doanh nghiệp. Mời người và vai vào từ lô 1.2.</p>
      <div className="mt-4">
        <SignOutButton />
      </div>
    </main>
  );
}
