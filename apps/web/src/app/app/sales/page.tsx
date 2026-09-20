import { redirect } from "next/navigation";
import type { Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { DocBoard } from "@/components/doc-board";
import { QueueCards } from "@/components/queue-cards";
import { getQueues } from "@/server/queues";
import type { DocRow } from "@/components/doc-detail";
import { DOC_COLUMNS } from "@/lib/doc-columns";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  const queues = await getQueues(membership.tenant_id as string);

  const [{ data: partners }, { data: items }, { data: docs }] = await Promise.all([
    supabase.from("partners").select("id, code, name, kind").order("name"),
    supabase.from("items").select("id, code, name, price, kind, tracking, uom, uom_factors").order("name"),
    supabase
      .from("documents")
      .select(DOC_COLUMNS)
      .in("doc_type", ["QUOTE", "SO", "DO", "INV", "RCPT"])
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  return (
    <div>
      <div className="mb-4">
        <QueueCards queues={queues} role={membership.role as Role} only={["sales", "warehouse"]} />
      </div>
      <DocBoard
      key={`${params.tab ?? ""}-${params.status ?? ""}`}
      initialTab={params.tab}
      initialStatus={params.status}
      module="sales"
      role={membership.role as Role}
      userId={user.id}
      partners={partners ?? []}
      items={(items ?? []).map((i) => ({ ...i, price: Number(i.price) }))}
      docs={(docs ?? []) as unknown as DocRow[]}
    />
    </div>
  );
}
