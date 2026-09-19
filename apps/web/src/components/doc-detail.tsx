"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DOC_LABEL, STATUS_LABEL, formatMoney, type DocStatus, type DocType, type Role } from "@erp/core";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { DOC_COLUMNS } from "@/lib/doc-columns";
import { Modal, StatusPill, statusLabelOf } from "./doc-ui";

export type DocRow = {
  id: string;
  doc_no: string;
  doc_type: DocType;
  status: DocStatus;
  doc_date: string;
  partner_id: string | null;
  created_by: string | null;
  created_by_name: string;
  refs: string[];
  meta: DocMeta;
};
/** meta là trường vận hành của chứng từ (totals, chain, approvals, validTo, ...) — lô nào thêm khoá thì bổ sung ở đây. */
export type DocMeta = {
  totals?: { total?: number; tax?: number };
  validTo?: string;
  chain?: Role[];
  approvals?: unknown[];
  terms?: string;
  depositPct?: number;
  total?: number;
  note?: string;
  delivered?: number;
  deliveredAll?: boolean;
  deliverDate?: string;
  signedBy?: string;
  due?: string;
  issueDate?: string;
  amount?: number;
  method?: string;
  bankRef?: string | null;
  advApplied?: number;
  [k: string]: unknown;
};
export type LineRow = { line_no: number; item_id: string | null; qty: number; price: number; tax_pct: number; meta: DocMeta };
type Hist = { id: number; at: string; actor: string; from_status: string | null; to_status: string; note: string };

/** Chi tiết chứng từ (03-chuan-giao-dien mục E): header → khối thông tin → bảng dòng → nút hành động
 * → lịch sử. `actions(doc)` do màn gọi truyền vào (chỉ hiện nút hợp vai + hợp trạng thái). */
export function DocDetail({
  doc: initial,
  partnerName,
  itemName,
  onClose,
  onChanged,
  actions,
  extraInfo,
  openByNo,
  canOpenNo,
}: {
  doc: DocRow;
  partnerName: (id: string | null) => string;
  itemName: (id: string | null) => string;
  onClose: () => void;
  onChanged: () => void;
  actions: (doc: DocRow, reload: () => void, ctx: { lines: LineRow[]; held: Record<number, number> }) => ReactNode;
  extraInfo?: (doc: DocRow) => [string, ReactNode][];
  openByNo?: (docNo: string) => void;
  canOpenNo?: (docNo: string) => boolean;
}) {
  const [doc, setDoc] = useState(initial);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [held, setHeld] = useState<Record<number, number>>({});

  const fetchAll = useCallback(async () => {
    const sb = supabaseBrowser();
    const [d, l, h, r] = await Promise.all([
      sb.from("documents").select(DOC_COLUMNS).eq("id", initial.id).single(),
      sb.from("document_lines").select("line_no, item_id, qty, price, tax_pct, meta").eq("document_id", initial.id).order("line_no"),
      sb.from("doc_status_history").select("id, at, actor, from_status, to_status, note").eq("document_id", initial.id).order("id"),
      sb.from("reservations").select("line_no, qty").eq("document_id", initial.id),
    ]);
    return {
      doc: (d.data as unknown as DocRow | null) ?? null,
      lines: (l.data ?? []) as unknown as LineRow[],
      hist: (h.data ?? []) as unknown as Hist[],
      held: Object.fromEntries(((r.data ?? []) as { line_no: number; qty: number }[]).map((x) => [x.line_no, Number(x.qty)])),
    };
  }, [initial.id]);

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchAll>>) => {
    if (r.doc) setDoc(r.doc);
    setLines(r.lines);
    setHist(r.hist);
    setHeld(r.held);
  }, []);

  const reload = useCallback(async () => {
    apply(await fetchAll());
    onChanged();
  }, [apply, fetchAll, onChanged]);

  useEffect(() => {
    let alive = true;
    void fetchAll().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply, fetchAll]);

  const isOrder = doc.doc_type === "SO";
  const total = lines.reduce((s, l) => s + Math.round(Number(l.qty) * Number(l.price)), 0);
  const info: [string, ReactNode][] = [
    ["Ngày", doc.doc_date],
    ["Đối tác", partnerName(doc.partner_id)],
    ["Người lập", doc.created_by_name || "—"],
    ...(extraInfo?.(doc) ?? []),
    ...(doc.refs?.length
      ? ([
          [
            "Tham chiếu",
            <span key="refs" className="flex flex-wrap gap-2">
              {doc.refs.map((no) =>
                canOpenNo?.(no) ? (
                  <button key={no} type="button" className="font-mono text-[var(--acc)] underline" onClick={() => openByNo?.(no)}>
                    {no}
                  </button>
                ) : (
                  <span key={no} className="font-mono">
                    {no}
                  </span>
                ),
              )}
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ["Tổng chưa thuế", <b key="t" className="font-mono tabular-nums">{formatMoney(total)}</b>],
  ];

  return (
    <Modal
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {DOC_LABEL[doc.doc_type].name} <span className="font-mono text-[var(--acc)]">{doc.doc_no}</span>
          <StatusPill status={doc.status} label={statusLabelOf(doc)} />
        </span>
      }
    >
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12.5px]">
        {info.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--ink2)]">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className="px-2 py-2 text-left">Mặt hàng</th>
              <th className="px-2 py-2 text-right">SL</th>
              <th className="px-2 py-2 text-right">Đơn giá</th>
              <th className="px-2 py-2 text-right">Thành tiền</th>
              {isOrder && <th className="px-2 py-2 text-right">Giữ</th>}
              {isOrder && <th className="px-2 py-2 text-right">Đã giao</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_no} className="border-t border-[var(--line)]">
                <td className="px-2 py-1.5">{itemName(l.item_id)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{Number(l.qty)}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatMoney(Number(l.price))}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {formatMoney(Math.round(Number(l.qty) * Number(l.price)))}
                </td>
                {isOrder && <td className="px-2 py-1.5 text-right font-mono tabular-nums">{held[l.line_no] ?? 0}</td>}
                {isOrder && <td className="px-2 py-1.5 text-right font-mono tabular-nums">{Number(l.meta?.delivered ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2">{actions(doc, () => void reload(), { lines, held })}</div>

      <h3 className="mt-4 text-sm font-semibold">Lịch sử</h3>
      <ul className="mt-1 text-[12.5px]">
        {hist.map((h) => (
          <li key={h.id} className="border-t border-[var(--line)] py-1">
            <span className="font-mono text-[var(--ink2)]">{new Date(h.at).toLocaleString("vi-VN")}</span> · {h.actor} →{" "}
            {STATUS_LABEL[h.to_status as DocStatus] ?? h.to_status}
            {h.note && <span className="text-[var(--ink2)]"> — {h.note}</span>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
