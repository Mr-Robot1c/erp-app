import { redirect } from "next/navigation";
import { can, type Role } from "@erp/core";
import { StockActions } from "@/components/stock-actions";
import { StockTable } from "@/components/stock-table";
import { createClient } from "@/server/supabase";

export default async function StockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const [{ data: items }, { data: avail }, { data: whs }, { data: moves }] = await Promise.all([
    supabase.from("items").select("id, code, name, kind, uom, tracking").neq("kind", "service").order("name"),
    supabase.from("v_available").select("item_id, on_hand, reserved, available"),
    supabase.from("warehouses").select("id, code").order("code"),
    supabase.from("v_on_hand").select("item_id, warehouse_id, qty"),
  ]);
  const qcIds = new Set((whs ?? []).filter((w) => w.code === "QC").map((w) => w.id as string));
  const qcQty = new Map<string, number>();
  for (const mv of moves ?? []) {
    if (qcIds.has(mv.warehouse_id as string)) qcQty.set(mv.item_id as string, (qcQty.get(mv.item_id as string) ?? 0) + Number(mv.qty));
  }
  const book: Record<string, number> = {};
  for (const mv of moves ?? []) book[`${mv.item_id}|${mv.warehouse_id}`] = Number(mv.qty);
  const canAdjust = can(membership.role as Role, "adj");
  const byItem = new Map((avail ?? []).map((a) => [a.item_id as string, a]));

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Kho</h1>
        {canAdjust && (
          <StockActions
            items={(items ?? []).map((i) => ({ id: i.id as string, code: i.code as string, name: i.name as string, tracking: i.tracking as string }))}
            warehouses={(whs ?? []).map((w) => ({ id: w.id as string, code: w.code as string }))}
            book={book}
          />
        )}
      </div>
      <StockTable
        rows={(items ?? []).map((it) => {
          const a = byItem.get(it.id as string);
          return {
            id: it.id as string,
            code: it.code as string,
            name: it.name as string,
            kind: it.kind as string,
            onHand: Number(a?.on_hand ?? 0),
            reserved: Number(a?.reserved ?? 0),
            available: Number(a?.available ?? 0),
            qc: qcQty.get(it.id as string) ?? 0,
          };
        })}
      />
    </div>
  );
}
