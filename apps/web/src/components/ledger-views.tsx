import Link from "next/link";
import { formatMoney } from "@erp/core";
import type { createClient } from "@/server/supabase";

type Sb = Awaited<ReturnType<typeof createClient>>;
type Params = { ym?: string; account?: string; partner?: string };

const th = "px-3 py-2 text-left";
const thR = "px-3 py-2 text-right";
const num = "px-3 py-2 text-right font-mono tabular-nums";
const box = "mt-3 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]";
const thead = "bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase";
const inputCls = "rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-2.5 py-1.5 text-sm";

const BUY_TYPES = new Set(["PR", "PO", "GRN", "VINV", "PAY"]);
const SALES_TYPES = new Set(["QUOTE", "SO", "DO", "INV", "RCPT"]);

/** Số chứng từ bấm được → mở chi tiết ở màn nghiệp vụ tương ứng (truy ngược từ số báo cáo về chứng từ nguồn, AC-35). Loại chưa có màn (ADJ, EXP) hiện chữ thường. */
function DocLink({ type, no }: { type: string | null; no: string | null }) {
  if (!no) return <span className="text-[var(--ink2)]">—</span>;
  const href = type && SALES_TYPES.has(type) ? `/app/sales?open=${encodeURIComponent(no)}` : type && BUY_TYPES.has(type) ? `/app/buy?open=${encodeURIComponent(no)}` : null;
  return href ? (
    <Link href={href} className="font-mono text-[var(--acc)] underline-offset-2 hover:underline">
      {no}
    </Link>
  ) : (
    <span className="font-mono">{no}</span>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Sổ cái: các dòng bút toán theo kỳ (+ lọc tài khoản), mỗi dòng có số chứng từ bấm mở. */
export async function LedgerView({ sb, params }: { sb: Sb; params: Params }) {
  const ym = params.ym || thisMonth();
  const account = params.account || "";
  let q = sb.from("v_journal").select("line_id, entry_date, memo, doc_no, doc_type, account_code, debit, credit").eq("ym", ym);
  if (account) q = q.eq("account_code", account);
  const { data: rows } = await q.order("entry_date").order("line_id").limit(500);
  const { data: accounts } = await sb.from("accounts").select("code, name").order("code");
  const totalD = (rows ?? []).reduce((a, r) => a + Number(r.debit), 0);
  const totalC = (rows ?? []).reduce((a, r) => a + Number(r.credit), 0);

  return (
    <div>
      <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value="ledger" />
        <label className="text-[12px] text-[var(--ink2)]">
          Kỳ
          <input type="month" name="ym" defaultValue={ym} className={`${inputCls} ml-2`} />
        </label>
        <label className="text-[12px] text-[var(--ink2)]">
          Tài khoản
          <select name="account" defaultValue={account} className={`${inputCls} ml-2`}>
            <option value="">Tất cả</option>
            {(accounts ?? []).map((a) => (
              <option key={a.code as string} value={a.code as string}>
                {a.code as string} — {a.name as string}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-1.5 text-sm">Xem</button>
      </form>
      <div className={box}>
        <table className="w-full text-sm" id="ledger-table">
          <thead className={thead}>
            <tr>
              <th className={th}>Ngày</th>
              <th className={th}>Chứng từ</th>
              <th className={th}>Diễn giải</th>
              <th className={th}>TK</th>
              <th className={thR}>Nợ</th>
              <th className={thR}>Có</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[var(--ink2)]">
                  Kỳ này chưa có bút toán.
                </td>
              </tr>
            )}
            {(rows ?? []).map((r) => (
              <tr key={r.line_id as number} className="border-t border-[var(--line)]" data-doc-no={(r.doc_no as string | null) ?? ""}>
                <td className="px-3 py-2">{String(r.entry_date)}</td>
                <td className="px-3 py-2">
                  <DocLink type={r.doc_type as string | null} no={r.doc_no as string | null} />
                </td>
                <td className="px-3 py-2">{r.memo as string}</td>
                <td className="px-3 py-2 font-mono">{r.account_code as string}</td>
                <td className={num}>{Number(r.debit) ? formatMoney(Number(r.debit)) : ""}</td>
                <td className={num}>{Number(r.credit) ? formatMoney(Number(r.credit)) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--line)] font-semibold">
              <td colSpan={4} className="px-3 py-2">
                Cộng
              </td>
              <td className={num}>{formatMoney(totalD)}</td>
              <td className={num}>{formatMoney(totalC)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(rows ?? []).length >= 500 && <p className="mt-2 text-[12px] text-[var(--ink2)]">Chỉ hiện 500 dòng đầu — lọc theo tài khoản để thu hẹp.</p>}
    </div>
  );
}

/** Số dư tài khoản theo kỳ: dư đầu (cộng dồn các kỳ trước) + phát sinh Nợ/Có trong kỳ = dư cuối. */
export async function BalanceView({ sb, params }: { sb: Sb; params: Params }) {
  const ym = params.ym || thisMonth();
  const { data: rows } = await sb.from("v_account_balance").select("ym, account_code, debit, credit, balance").lte("ym", ym);
  const { data: accounts } = await sb.from("accounts").select("code, name");
  const names = new Map((accounts ?? []).map((a) => [a.code as string, a.name as string]));
  const agg = new Map<string, { open: number; debit: number; credit: number }>();
  for (const r of rows ?? []) {
    const code = r.account_code as string;
    const a = agg.get(code) ?? { open: 0, debit: 0, credit: 0 };
    if ((r.ym as string) < ym) a.open += Number(r.balance);
    else {
      a.debit += Number(r.debit);
      a.credit += Number(r.credit);
    }
    agg.set(code, a);
  }
  const list = [...agg.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = list.reduce((t, [, a]) => ({ open: t.open + a.open, debit: t.debit + a.debit, credit: t.credit + a.credit }), { open: 0, debit: 0, credit: 0 });

  return (
    <div>
      <form method="get" className="mt-3 flex items-end gap-2">
        <input type="hidden" name="view" value="balance" />
        <label className="text-[12px] text-[var(--ink2)]">
          Kỳ
          <input type="month" name="ym" defaultValue={ym} className={`${inputCls} ml-2`} />
        </label>
        <button className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-1.5 text-sm">Xem</button>
      </form>
      <div className={box}>
        <table className="w-full text-sm" id="balance-table">
          <thead className={thead}>
            <tr>
              <th className={th}>Tài khoản</th>
              <th className={thR}>Dư đầu kỳ</th>
              <th className={thR}>Phát sinh Nợ</th>
              <th className={thR}>Phát sinh Có</th>
              <th className={thR}>Dư cuối kỳ</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-[var(--ink2)]">
                  Chưa có bút toán.
                </td>
              </tr>
            )}
            {list.map(([code, a]) => (
              <tr key={code} className="border-t border-[var(--line)]" data-account={code}>
                <td className="px-3 py-2">
                  <span className="font-mono">{code}</span> {names.get(code) ?? ""}
                </td>
                <td className={num}>{formatMoney(a.open)}</td>
                <td className={num}>{formatMoney(a.debit)}</td>
                <td className={num}>{formatMoney(a.credit)}</td>
                <td className={num}>{formatMoney(a.open + a.debit - a.credit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--line)] font-semibold">
              <td className="px-3 py-2">Cộng (Nợ dương, Có âm)</td>
              <td className={num}>{formatMoney(total.open)}</td>
              <td className={num}>{formatMoney(total.debit)}</td>
              <td className={num}>{formatMoney(total.credit)}</td>
              <td className={num}>{formatMoney(total.open + total.debit - total.credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Sổ chi tiết đối tác: chọn 1 đối tác → mọi dòng bút toán 131/331 của họ, số dư luỹ kế; mỗi dòng có số chứng từ bấm mở (AC-35). */
export async function PartnerLedgerView({ sb, params }: { sb: Sb; params: Params }) {
  const { data: partners } = await sb.from("partners").select("id, code, name").order("name");
  const partnerId = params.partner || "";
  const { data: rows } = partnerId
    ? await sb
        .from("v_journal")
        .select("line_id, entry_date, memo, doc_no, doc_type, account_code, debit, credit")
        .eq("partner_id", partnerId)
        .in("account_code", ["131", "331"])
        .order("entry_date")
        .order("line_id")
    : { data: [] as { line_id: number; entry_date: string; memo: string; doc_no: string | null; doc_type: string | null; account_code: string; debit: number; credit: number }[] };
  const run = new Map<string, number>();
  const lines = (rows ?? []).map((r) => {
    const acc = r.account_code as string;
    const bal = (run.get(acc) ?? 0) + Number(r.debit) - Number(r.credit);
    run.set(acc, bal);
    return { ...r, bal };
  });

  return (
    <div>
      <form method="get" className="mt-3 flex items-end gap-2">
        <input type="hidden" name="view" value="partner" />
        <label className="text-[12px] text-[var(--ink2)]">
          Đối tác
          <select name="partner" defaultValue={partnerId} className={`${inputCls} ml-2 min-w-56`}>
            <option value="">Chọn đối tác…</option>
            {(partners ?? []).map((p) => (
              <option key={p.id as string} value={p.id as string}>
                {p.name as string} ({p.code as string})
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-1.5 text-sm">Xem</button>
      </form>
      {partnerId && (
        <div className={box}>
          <table className="w-full text-sm" id="partner-ledger-table">
            <thead className={thead}>
              <tr>
                <th className={th}>Ngày</th>
                <th className={th}>Chứng từ</th>
                <th className={th}>Diễn giải</th>
                <th className={th}>TK</th>
                <th className={thR}>Nợ</th>
                <th className={thR}>Có</th>
                <th className={thR}>Dư luỹ kế</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-[var(--ink2)]">
                    Đối tác này chưa có bút toán công nợ.
                  </td>
                </tr>
              )}
              {lines.map((r) => (
                <tr key={r.line_id as number} className="border-t border-[var(--line)]" data-doc-no={(r.doc_no as string | null) ?? ""}>
                  <td className="px-3 py-2">{String(r.entry_date)}</td>
                  <td className="px-3 py-2">
                    <DocLink type={r.doc_type as string | null} no={r.doc_no as string | null} />
                  </td>
                  <td className="px-3 py-2">{r.memo as string}</td>
                  <td className="px-3 py-2 font-mono">{r.account_code as string}</td>
                  <td className={num}>{Number(r.debit) ? formatMoney(Number(r.debit)) : ""}</td>
                  <td className={num}>{Number(r.credit) ? formatMoney(Number(r.credit)) : ""}</td>
                  <td className={num}>{formatMoney(r.bal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
