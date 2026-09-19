import { redirect } from "next/navigation";
import { canView, type Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { MasterBoard } from "@/components/master-board";

export default async function MasterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  const role = membership.role as Role;
  if (!canView(role, "master")) redirect("/app");

  const [{ data: partners }, { data: items }, { data: warehouses }] = await Promise.all([
    supabase.from("partners").select("id, code, name, kind, credit_limit, is_sample").order("name"),
    supabase.from("items").select("id, code, name, kind, uom, price, cost, tracking, is_sample").order("name"),
    supabase.from("warehouses").select("id, code, name").order("code"),
  ]);

  return (
    <MasterBoard
      role={role}
      partners={(partners ?? []).map((p) => ({ ...p, credit_limit: Number(p.credit_limit) })) as never}
      items={(items ?? []).map((i) => ({ ...i, price: Number(i.price), cost: Number(i.cost) })) as never}
      warehouses={(warehouses ?? []) as never}
    />
  );
}
