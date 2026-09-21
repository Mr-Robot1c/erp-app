import { redirect } from "next/navigation";
import { formatMoney } from "@erp/core";
import Link from "next/link";
import { createClient } from "@/server/supabase";
import { BalanceView, LedgerView, PartnerLedgerView } from "@/components/ledger-views";
import { OpeningBalanceForm } from "@/components/opening-balance-form";
import { JournalAdjustForm, MatchReceiptActions, PeriodManager } from "@/components/period-tools";

/** Công nợ đơn giản (lô 2.5): phải thu còn mở, tiền ứng trước, và hàng chờ khớp tay (phiếu thu không mã / dư thành ứng trước).
 * Báo cáo công nợ đầy đủ (tuổi nợ, nhắc, chặn) ở GĐ4. */
export default async function AccPage({ searchParams }: { searchParams: Promise<{ view?: string; ym?: string; account?: string; partner?: string }> }) {
  const params = await searchParams;
  const view = ("debt ledger balance partner opening period adjust".split(" ").includes(params.view ?? "") ? params.view : "debt") as "debt" | "ledger" | "balance" | "partner" | "opening" | "period" | "adjust";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const [{ data: partners }, { data: recs }, { data: adv }, { data: unmatched }, { data: pays }] = await Promise.all([
    supabase.from("partners").select("id, name, blocked"),
    supabase.from("receivables").select("id, kind, partner_id, amount, paid, due_date, document_id, overdue").order("due_date", { nullsFirst: true }),
    supabase.from("partner_advances").select("partner_id, amount").gt("amount", 0),
    // Phiếu thu có phân bổ "Ứng trước" (không khớp khoản nợ nào) = chờ kế toán khớp tay.
    supabase.from("receipt_allocations").select("id, amount, receipt_id").is("receivable_id", null).eq("note", "Ứng trước"),
    supabase.from("payables").select("id, partner_id, amount, paid, due_date").order("due_date", { nullsFirst: true }),
  ]);
  const openPay = (pays ?? []).filter((p) => Number(p.amount) - Number(p.paid) > 0);
  const canOpening = membership.role === "admin" || membership.role === "chief_accountant";
  const canMatch = canOpening || membership.role === "accountant";
  const { data: periods } = await supabase.from("periods").select("ym, status");
  const lockedPeriods = (periods ?? []).filter((p) => p.status === "locked").map((p) => p.ym as string);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  const { count: docCount } = await supabase.from("documents").select("*", { count: "exact", head: true });
  const blockedPartners = new Set((partners ?? []).filter((p) => p.blocked).map((p) => p.id as string));
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
      <div className="mt-3 flex flex-wrap gap-1" id="acc-tabs">
        {(
          [
            ["debt", "Công nợ"],
            ["ledger", "Sổ cái"],
            ["balance", "Số dư tài khoản"],
            ["partner", "Sổ chi tiết đối tác"],
            ...(canOpening ? ([["opening", "Số dư đầu kỳ"], ["adjust", "Bút toán điều chỉnh"], ["period", "Khoá kỳ"]] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/app/acc?view=${key}`}
            data-view={key}
            className={`rounded-full border px-3 py-1 text-sm ${
              view === key ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line)] bg-[var(--sf)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {view === "ledger" && <LedgerView sb={supabase} params={params} />}
      {view === "balance" && <BalanceView sb={supabase} params={params} />}
      {view === "partner" && <PartnerLedgerView sb={supabase} params={params} />}
      {view === "adjust" && canOpening && <JournalAdjustForm />}
      {view === "period" && canOpening && <PeriodManager months={months} locked={lockedPeriods} />}
      {view === "opening" && canOpening && <OpeningBalanceForm locked={(docCount ?? 0) > 0} />}
      {view === "debt" && (
        <>
          <h2 className="mt-4 text-sm font-semibold">Tuổi nợ phải thu</h2>
          <AgingTable open={open} pname={pname} blocked={blockedPartners} today={new Date().toISOString().slice(0, 10)} />


      <h2 className="mt-5 text-sm font-semibold">Khoản phải thu còn mở</h2>
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
                <td className="px-3 py-2">
                  {(r.due_date as string | null) ?? "—"}
                  {r.overdue && <span className="pill cancelled ml-2">Quá hạn</span>}
                </td>
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
                  {canMatch && (
                    <td className="px-3 py-2">
                      <MatchReceiptActions
                        receiptId={u.receipt_id as string}
                        options={open
                          .filter((o) => o.partner_id === r?.partner_id && (o.kind === "invoice" || o.kind === "deposit"))
                          .map((o) => ({ id: o.id as string, label: `${KIND[o.kind as string] ?? ""} còn ${formatMoney(Number(o.amount) - Number(o.paid))}` }))}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
}

const BUCKETS = ["Chưa đến hạn", "1–30 ngày", "31–60 ngày", "61–90 ngày", "Trên 90 ngày"] as const;

/** Tuổi nợ phải thu theo khách (lô 4.2): khoản hoá đơn còn mở chia theo số ngày quá hạn; khách bị chặn bán công nợ có nhãn. */
function AgingTable({
  open,
  pname,
  blocked,
  today,
}: {
  today: string;
  open: { partner_id: unknown; kind: unknown; amount: unknown; paid: unknown; due_date: unknown }[];
  pname: Map<string, string>;
  blocked: Set<string>;
}) {
  const now = new Date(`${today}T00:00:00Z`).getTime();
  const rows = new Map<string, number[]>();
  for (const r of open.filter((x) => x.kind === "invoice")) {
    const due = r.due_date ? new Date(`${r.due_date as string}T00:00:00Z`).getTime() : null;
    const days = due === null ? 0 : Math.floor((now - due) / 86_400_000);
    const b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    const arr = rows.get(r.partner_id as string) ?? [0, 0, 0, 0, 0];
    arr[b] += Number(r.amount) - Number(r.paid);
    rows.set(r.partner_id as string, arr);
  }
  const th = "px-3 py-2 text-right";
  return (
    <div className="mt-2 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
      <table className="w-full text-sm" id="aging-table">
        <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Khách hàng</th>
            {BUCKETS.map((b) => (
              <th key={b} className={th}>
                {b}
              </th>
            ))}
            <th className={th}>Tổng</th>
          </tr>
        </thead>
        <tbody>
          {rows.size === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-[var(--ink2)]">
                Không có khoản phải thu nào còn mở.
              </td>
            </tr>
          )}
          {[...rows.entries()].map(([pid, arr]) => (
            <tr key={pid} className="border-t border-[var(--line)]" data-partner={pname.get(pid) ?? ""}>
              <td className="px-3 py-2">
                {pname.get(pid) ?? "—"}
                {blocked.has(pid) && <span className="pill cancelled ml-2">Chặn bán công nợ</span>}
              </td>
              {arr.map((v, i) => (
                <td key={i} className="px-3 py-2 text-right font-mono tabular-nums">
                  {v ? formatMoney(v) : ""}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(arr.reduce((a, b) => a + b, 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
