import { redirect } from "next/navigation";
import { formatMoney } from "@erp/core";
import { createClient } from "@/server/supabase";

/** Công nợ đơn giản (lô 2.5): phải thu còn mở, tiền ứng trước, và hàng chờ khớp tay (phiếu thu không mã / dư thành ứng trước).
 * Báo cáo công nợ đầy đủ (tuổi nợ, nhắc, chặn) ở GĐ4. */
export default async function AccPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const [{ data: partners }, { data: recs }, { data: adv }, { data: unmatched }, { data: pays }] = await Promise.all([
    supabase.from("partners").select("id, name"),
    supabase.from("receivables").select("id, kind, partner_id, amount, paid, due_date, document_id").order("due_date", { nullsFirst: true }),
    supabase.from("partner_advances").select("partner_id, amount").gt("amount", 0),
    // Phiếu thu có phân bổ "Ứng trước" (không khớp khoản nợ nào) = chờ kế toán khớp tay.
    supabase.from("receipt_allocations").select("id, amount, receipt_id").is("receivable_id", null).eq("note", "Ứng trước"),
    supabase.from("payables").select("id, partner_id, amount, paid, due_date").order("due_date", { nullsFirst: true }),
  ]);
  const openPay = (pays ?? []).filter((p) => Number(p.amount) - Number(p.paid) > 0);
  const pname = new Map((partners ?? []).map((p) => [p.id as string, p.name as string]));
  const receiptIds = (unmatched ?? []).map((u) => u.receipt_id as string);
  const { data: receipts } = receiptIds.length
    ? await supabase.from("documents").select("id, doc_no, partner_id, doc_date").in("id", receiptIds)
    : { data: [] as { id: string; doc_no: string; partner_id: string; doc_date: string }[] };
  const rmap = new Map((receipts ?? []).map((r) => [r.id, r]));

  const open = (recs ?? []).filter((r) => Number(r.amount) - Number(r.paid) > 0);
  const KIND: Record<string, string> = { invoice: "Hoá đơn", deposit: "Cọc", renewal: "Gia hạn" };
  const th = "px-3 py-2 text-left";

  return (
    <div className="max-w-4xl">
      <h1 className="text-lg font-semibold">Kế toán</h1>

      <h2 className="mt-4 text-sm font-semibold">Khoản phải thu còn mở</h2>
      <div className="mt-2 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="ar-table">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className={th}>Khách hàng</th>
              <th className={th}>Loại</th>
              <th className={th}>Hạn</th>
              <th className={`${th} text-right`}>Còn phải thu</th>
            </tr>
          </thead>
          <tbody>
            {open.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-[var(--ink2)]">
                  Không có khoản nào.
                </td>
              </tr>
            )}
            {open.map((r) => (
              <tr key={r.id as string} className="border-t border-[var(--line)]">
                <td className="px-3 py-2">{pname.get(r.partner_id as string) ?? "—"}</td>
                <td className="px-3 py-2">{KIND[r.kind as string] ?? (r.kind as string)}</td>
                <td className="px-3 py-2">{(r.due_date as string | null) ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(r.amount) - Number(r.paid))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-5 text-sm font-semibold">Khoản phải trả còn mở</h2>
      <div className="mt-2 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="ap-table">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className={th}>Nhà cung cấp</th>
              <th className={th}>Hạn</th>
              <th className={`${th} text-right`}>Còn phải trả</th>
            </tr>
          </thead>
          <tbody>
            {openPay.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-[var(--ink2)]">
                  Không có khoản nào.
                </td>
              </tr>
            )}
            {openPay.map((p) => (
              <tr key={p.id as string} className="border-t border-[var(--line)]">
                <td className="px-3 py-2">{pname.get(p.partner_id as string) ?? "—"}</td>
                <td className="px-3 py-2">{(p.due_date as string | null) ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(p.amount) - Number(p.paid))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-5 text-sm font-semibold">Tiền khách ứng trước</h2>
      <div className="mt-2 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="adv-table">
          <tbody>
            {(adv ?? []).length === 0 && (
              <tr>
                <td className="px-3 py-4 text-[var(--ink2)]">Không có.</td>
              </tr>
            )}
            {(adv ?? []).map((a) => (
              <tr key={a.partner_id as string} className="border-t border-[var(--line)] first:border-t-0">
                <td className="px-3 py-2">{pname.get(a.partner_id as string) ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(a.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="cho-khop" className="mt-5 text-sm font-semibold">Chờ khớp tay</h2>
      <div className="mt-2 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="unmatched-table">
          <tbody>
            {(unmatched ?? []).length === 0 && (
              <tr>
                <td className="px-3 py-4 text-[var(--ink2)]">Không có giao dịch nào chờ khớp.</td>
              </tr>
            )}
            {(unmatched ?? []).map((u) => {
              const r = rmap.get(u.receipt_id as string);
              return (
                <tr key={u.id as string} className="border-t border-[var(--line)] first:border-t-0">
                  <td className="px-3 py-2 font-mono text-[var(--acc)]">{r?.doc_no ?? "—"}</td>
                  <td className="px-3 py-2">{pname.get((r?.partner_id as string) ?? "") ?? "—"}</td>
                  <td className="px-3 py-2">{r?.doc_date ?? ""}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(u.amount))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
