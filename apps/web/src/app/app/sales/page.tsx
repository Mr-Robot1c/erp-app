import { redirect } from "next/navigation";
import type { Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { SalesBoard } from "@/components/sales-board";
import type { DocRow } from "@/components/doc-detail";
import { DOC_COLUMNS } from "@/lib/doc-columns";

export default async function SalesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const [{ data: partners }, { data: items }, { data: docs }] = await Promise.all([
    supabase.from("partners").select("id, code, name, kind").order("name"),
    supabase.from("items").select("id, code, name, price, kind, tracking, uom, uom_factors").order("name"),
    supabase
      .from("documents")
      .select(DOC_COLUMNS)
      .in("doc_type", ["QUOTE", "SO", "DO", "INV"])
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  return (
    <SalesBoard
      role={membership.role as Role}
      userId={user.id}
      partners={partners ?? []}
      items={(items ?? []).map((i) => ({ ...i, price: Number(i.price) }))}
      docs={(docs ?? []) as unknown as DocRow[]}
    />
  );
}
