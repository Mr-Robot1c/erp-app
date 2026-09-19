import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase";
import { OnboardingForm } from "@/components/onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (membership) redirect("/app"); // đã có doanh nghiệp — khỏi đăng ký lại

  return <OnboardingForm email={user.email ?? ""} />;
}
