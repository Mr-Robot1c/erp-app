import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase";
import { TeamManager } from "@/components/team-manager";

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("tenant_id, role").maybeSingle();
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/app"); // chỉ admin thấy màn này

  const { data: members } = await supabase
    .from("memberships")
    .select("user_id, role, display_name")
    .order("display_name");

  const { data: invites } = await supabase
    .from("invites")
    .select("id, email, role, status")
    .eq("status", "sent")
    .order("created_at");

  return <TeamManager members={members ?? []} invites={invites ?? []} currentUserId={user.id} />;
}
