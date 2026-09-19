import { redirect } from "next/navigation";
import { KIND_LABEL_ITEM } from "@/lib/item-kinds";
import { createClient } from "@/server/supabase";

export default async function StockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const [{ data: items }, { data: avail }] = await Promise.all([
    supabase.from("items").select("id, code, name, kind, uom").neq("kind", "service").order("name"),
    supabase.from("v_available").select("item_id, on_hand, reserved, available"),
  ]);
  const byItem = new Map((avail ?? []).map((a) => [a.item_id as string, a]));

  return (
    <div>
      <h1 className="text-lg font-semibold">Kho</h1>
      <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="stock-table">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Mặt hàng</th>
              <th className="px-3 py-2 text-left">Loại</th>
              <th className="px-3 py-2 text-right">Tồn</th>
              <th className="px-3 py-2 text-right">Đang giữ</th>
              <th className="px-3 py-2 text-right">Khả dụng</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-[var(--ink2)]">
                  Chưa có mặt hàng nào.
                </td>
              </tr>
            )}
            {(items ?? []).map((it) => {
              const a = byItem.get(it.id as string);
              const avl = Number(a?.available ?? 0);
              return (
                <tr key={it.id as string} className="border-t border-[var(--line)]" data-item-code={it.code as string}>
                  <td className="px-3 py-2">
                    {it.name as string} <span className="font-mono text-[11.5px] text-[var(--ink2)]">{it.code as string}</span>
                  </td>
                  <td className="px-3 py-2">{KIND_LABEL_ITEM[it.kind as string] ?? (it.kind as string)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(a?.on_hand ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(a?.reserved ?? 0)}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${avl <= 0 ? "text-[var(--bad)]" : ""}`}>{avl}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
