"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@erp/core";
import { btnGhost, btnPrimary, callApi, inputCls, newKey } from "./doc-ui";

type Blocker = { type: string; docNo: string; note: string };

/** Khoá kỳ (lô 4.3, AC-33): danh sách các kỳ gần đây + nút khoá. Còn mục chặn → hiện danh sách (số chứng từ + lý do), kỳ vẫn mở. Khoá xong không mở lại được. */
export function PeriodManager({ months, locked }: { months: string[]; locked: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [blockers, setBlockers] = useState<{ ym: string; list: Blocker[] } | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function lock(ym: string) {
    if (!confirm(`Khoá kỳ ${ym}? Khoá xong không ghi thêm / sửa được sổ của kỳ này và không mở lại được.`)) return;
    setBusy(ym);
    setErr("");
    setOk("");
    setBlockers(null);
    const res = await callApi("/api/acc/lock-period", { ym });
    setBusy("");
    if (res.ok) {
      setOk(`Đã khoá kỳ ${ym}.`);
      router.refresh();
      return;
    }
    const b = (res.error as unknown as { blockers?: Blocker[] }).blockers;
    if (res.error.code === "conflict" && b) setBlockers({ ym, list: b });
    else setErr(res.error.message);
  }

  return (
    <div id="period-manager" className="mt-4 max-w-2xl">
      <p className="text-sm text-[var(--ink2)]">Kỳ đã khoá là bất biến: không ghi thêm chứng từ hay bút toán vào kỳ đó (hệ đề nghị ghi vào kỳ mở kế tiếp).</p>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {months.map((ym) => {
            const isLocked = locked.includes(ym);
            return (
              <tr key={ym} className="border-t border-[var(--line)]" data-period={ym}>
                <td className="py-2 font-mono">{ym}</td>
                <td className="py-2">{isLocked ? <span className="pill done">Đã khoá</span> : <span className="pill confirmed">Đang mở</span>}</td>
                <td className="py-2 text-right">
                  {!isLocked && (
                    <button className={btnGhost} disabled={busy === ym} data-lock={ym} onClick={() => void lock(ym)}>
                      Khoá kỳ
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ok && (
        <p id="period-ok" className="mt-3 text-sm text-[var(--ok)]">
          {ok}
        </p>
      )}
      {err && <p className="mt-3 text-sm text-[var(--bad)]">{err}</p>}
      {blockers && (
        <div id="period-blockers" className="mt-3 rounded-[var(--r)] border border-[var(--warn)] bg-[var(--warns)] p-3 text-sm">
          <p className="font-semibold text-[var(--warn)]">
            Chưa khoá được kỳ {blockers.ym} — còn {blockers.list.length} mục cần xử lý:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {blockers.list.map((b) => (
              <li key={`${b.type}-${b.docNo}`}>
                <span className="font-mono">{b.docNo}</span> — {b.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Line = { acc: string; debit: string; credit: string };
const emptyLine = (): Line => ({ acc: "", debit: "", credit: "" });

/** Bút toán điều chỉnh tay (lô 4.3): ngày, diễn giải, các dòng TK Nợ/Có; báo lệch cân ngay khi gõ. Ghi vào kỳ khoá → báo kỳ mở kế tiếp. */
export function JournalAdjustForm() {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [suggested, setSuggested] = useState("");

  const num = (v: string) => Number(v.replace(/[.\s]/g, "")) || 0;
  const d = lines.reduce((a, l) => a + num(l.debit), 0);
  const c = lines.reduce((a, l) => a + num(l.credit), 0);
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function submit() {
    setErr("");
    setOk("");
    setSuggested("");
    if (!memo.trim()) return setErr("Nhập diễn giải.");
    if (d !== c || d === 0) return setErr("Bút toán chưa cân: tổng Nợ phải bằng tổng Có.");
    setBusy(true);
    const res = await callApi("/api/acc/journal-adjust", { date, memo: memo.trim(), lines: lines.filter((l) => l.acc).map((l) => [l.acc.trim(), num(l.debit), num(l.credit)]) }, key);
    setBusy(false);
    if (!res.ok) {
      const sd = (res.error as unknown as { suggestedDate?: string }).suggestedDate;
      if (res.error.code === "period_locked" && sd) setSuggested(sd);
      return setErr(res.error.message);
    }
    setOk(`Đã ghi bút toán ${String(res.data.doc_no)}.`);
    setMemo("");
    setLines([emptyLine(), emptyLine()]);
    setKey(newKey());
    router.refresh();
  }

  return (
    <div id="adjust-form" className="mt-4 max-w-3xl">
      <div className="grid grid-cols-[160px_1fr] gap-2">
        <input id="adj-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        <input id="adj-memo" className={inputCls} placeholder="Diễn giải" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <table className="mt-3 w-full text-sm">
        <thead className="text-[11px] tracking-wide text-[var(--ink2)] uppercase">
          <tr>
            <th className="w-28 py-1 text-left">Tài khoản</th>
            <th className="py-1 text-right">Nợ</th>
            <th className="py-1 text-right">Có</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <input className={`${inputCls} adj-acc font-mono`} inputMode="numeric" value={l.acc} onChange={(e) => set(i, { acc: e.target.value })} />
              </td>
              <td className="py-1 pr-2">
                <input className={`${inputCls} adj-debit text-right`} inputMode="numeric" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
              </td>
              <td className="py-1 pr-2">
                <input className={`${inputCls} adj-credit text-right`} inputMode="numeric" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
              </td>
              <td className="py-1">
                {lines.length > 2 && (
                  <button aria-label="Xoá dòng" className="text-[var(--ink2)]" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--line)] font-semibold">
            <td className="py-1">Cộng</td>
            <td className="py-1 text-right font-mono tabular-nums">{formatMoney(d)}</td>
            <td className="py-1 text-right font-mono tabular-nums">{formatMoney(c)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 flex items-center gap-2">
        <button className={btnGhost} onClick={() => setLines([...lines, emptyLine()])}>
          + Thêm dòng
        </button>
        <span className="flex-1" />
        {d !== c && <span className="text-[12.5px] text-[var(--warn)]">Lệch {formatMoney(Math.abs(d - c))}</span>}
        <button id="btn-adjust" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Ghi bút toán
        </button>
      </div>
      {err && (
        <p id="adj-err" className="mt-2 text-sm text-[var(--bad)]">
          {err}
          {suggested && (
            <button className="ml-2 underline" onClick={() => setDate(suggested)}>
              Dùng ngày {suggested}
            </button>
          )}
        </p>
      )}
      {ok && (
        <p id="adj-ok" className="mt-2 text-sm text-[var(--ok)]">
          {ok}
        </p>
      )}
    </div>
  );
}

/** Khớp tay một phiếu thu (hàng chờ khớp): chọn khoản phải thu còn mở của khách để phân bổ, hoặc giữ làm tiền ứng trước. */
export function MatchReceiptActions({ receiptId, options }: { receiptId: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setErr("");
    const res = await callApi("/api/receipts/match", { receiptId, ...(target ? { receivableId: target } : {}) }, key);
    setBusy(false);
    if (!res.ok) return setErr(res.error.message);
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <select className={`${inputCls} match-target max-w-56`} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Giữ làm tiền ứng trước</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            Khớp vào {o.label}
          </option>
        ))}
      </select>
      <button className={btnGhost} disabled={busy} data-match={receiptId} onClick={() => void run()}>
        Khớp
      </button>
      {err && <span className="text-[12px] text-[var(--bad)]">{err}</span>}
    </div>
  );
}
