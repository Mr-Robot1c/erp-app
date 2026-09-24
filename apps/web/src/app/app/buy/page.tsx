import { redirect } from "next/navigation";
import type { Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { DocBoard } from "@/components/doc-board";
import { QueueCardsClient } from "@/components/queue-cards-client";
import type { DocRow } from "@/components/doc-detail";
import { DOC_COLUMNS } from "@/lib/doc-columns";

export default async function BuyPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; open?: string; new?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const [{ data: partners }, { data: items }, { data: docs }] = await Promise.all([
    supabase.from("partners").select("id, code, name, kind").order("name"),
    supabase.from("items").select("id, code, name, cost, kind, tracking, uom, uom_factors").order("name"),
    supabase
      .from("documents")
      .select(DOC_COLUMNS)
      .in("doc_type", ["PR", "PO", "GRN", "VINV", "PAY"])
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  return (
    <div>
      <div className="mb-4">
        <QueueCardsClient role={membership.role as Role} only={["warehouse", "accounting"]} />
      </div>
      <DocBoard
      key={`${params.tab ?? ""}-${params.status ?? ""}-${params.open ?? ""}-${params.new ?? ""}`}
      initialOpen={params.open}
      initialTab={params.tab}
      initialStatus={params.status}
      initialNew={params.new === "po" || params.new === "pay" ? params.new : undefined}
      module="buy"
      role={membership.role as Role}
      userId={user.id}
      partners={partners ?? []}
      items={(items ?? []).map((i) => ({ ...i, price: Number(i.cost) }))}
      docs={(docs ?? []) as unknown as DocRow[]}
    />
    </div>
  );
}
