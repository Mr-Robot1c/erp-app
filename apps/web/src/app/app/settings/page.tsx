import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/app"); // chỉ admin thấy màn này

  const { data: tenant } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  return <SettingsForm settings={tenant?.settings ?? {}} />;
}
