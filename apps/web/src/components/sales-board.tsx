"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { STATUSES, STATUS_LABEL, can, formatMoney, type DocStatus, type Role } from "@erp/core";
import { DocDetail, type DocRow } from "./doc-detail";
import { Modal, StatusPill, btnGhost, btnPrimary, callApi, inputCls, newKey } from "./doc-ui";
import { LinesEditor, emptyLine, linesTotal, type EditorLine, type LineItemOption } from "./lines-editor";
import { PartnerPicker, type PartnerOption } from "./partner-picker";

type PartnerRow = PartnerOption & { kind: string };
type Tab = { key: string; label: string };

const TABS: Tab[] = [{ key: "QUOTE", label: "Báo giá" }];

const VI_ERR: Record<string, string> = {
  forbidden: "Bạn không có quyền làm việc này (hoặc chưa tới lượt của bạn).",
  state_invalid: "Chứng từ không còn ở trạng thái phù hợp — tải lại trang.",
  not_found: "Không tìm thấy dữ liệu.",
  invalid_argument: "Thông tin chưa hợp lệ.",
};

export function SalesBoard({
  role,
  userId,
  partners,
  items,
  docs,
}: {
  role: Role;
  userId: string;
  partners: PartnerRow[];
  items: LineItemOption[];
  docs: DocRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState(TABS[0].key);
  const [status, setStatus] = useState<DocStatus | "all">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const partnerName = (id: string | null) => partners.find((p) => p.id === id)?.name ?? "—";
  const itemName = (id: string | null) => items.find((i) => i.id === id)?.name ?? "—";

  const ofTab = docs.filter((d) => d.doc_type === tab);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ofTab.length };
    for (const d of ofTab) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [ofTab]);
  const term = q.trim().toLowerCase();
  const rows = ofTab
    .filter((d) => status === "all" || d.status === status)
    .filter((d) => !term || d.doc_no.toLowerCase().includes(term) || partnerName(d.partner_id).toLowerCase().includes(term));

  const open = docs.find((d) => d.id === openId) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Bán hàng</h1>
        {can(role, "quote") && (
          <button id="btn-new-quote" className={btnPrimary} onClick={() => setCreating(true)}>
            + Lập báo giá
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const n = docs.filter((d) => d.doc_type === t.key).length;
          return (
            <button
              key={t.key}
              className={`rounded-full border px-3 py-1 text-sm ${
                tab === t.key ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line)] bg-[var(--sf)]"
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label} ({n})
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-xs`}
          placeholder="Tìm số chứng từ, khách hàng…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(["all", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            className={`rounded-full border px-2.5 py-0.5 text-[12.5px] ${
              status === s ? "border-[var(--acc)] bg-[var(--accs)] text-[var(--acc)]" : "border-[var(--line)] bg-[var(--sf)]"
            }`}
            onClick={() => setStatus(s)}
          >
            {s === "all" ? "Tất cả" : STATUS_LABEL[s]} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="doc-table">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Số</th>
              <th className="px-3 py-2 text-left">Khách hàng</th>
              <th className="px-3 py-2 text-right">Giá trị</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
              <th className="px-3 py-2 text-left">Người lập</th>
              <th className="px-3 py-2 text-left">Ngày</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[var(--ink2)]">
                  Chưa có chứng từ nào.
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr
                key={d.id}
                className="cursor-pointer border-t border-[var(--line)] hover:bg-[var(--lane)]"
                onClick={() => setOpenId(d.id)}
                data-doc-no={d.doc_no}
              >
                <td className="px-3 py-2 font-mono text-[var(--acc)]">{d.doc_no}</td>
                <td className="px-3 py-2">{partnerName(d.partner_id)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(d.meta.totals?.total ?? 0))}</td>
                <td className="px-3 py-2">
                  <StatusPill status={d.status} />
                </td>
                <td className="px-3 py-2">{d.created_by_name}</td>
                <td className="px-3 py-2">{d.doc_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <QuoteForm
          partners={partners.filter((p) => p.kind !== "supplier")}
          items={items}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.refresh();
            setOpenId(id);
          }}
        />
      )}

      {open && (
        <DocDetail
          key={open.id}
          doc={open}
          partnerName={partnerName}
          itemName={itemName}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
          extraInfo={(d) => (d.meta.validTo ? [["Hiệu lực đến", d.meta.validTo]] : [])}
          actions={(d, reload) => <QuoteActions doc={d} role={role} userId={userId} reload={reload} />}
        />
      )}
    </div>
  );
}

function QuoteForm({
  partners,
  items,
  onClose,
  onCreated,
}: {
  partners: PartnerOption[];
  items: LineItemOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [partnerId, setPartnerId] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([emptyLine()]);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!partnerId) return setErr("Chọn khách hàng.");
    if (lines.some((l) => !l.itemId)) return setErr("Mỗi dòng phải chọn mặt hàng.");
    if (lines.some((l) => !(Number(l.qty) > 0))) return setErr("Số lượng phải lớn hơn 0.");
    setBusy(true);
    setErr("");
    const res = await callApi(
      "/api/quotes",
      { partnerId, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), price: Number(l.price) || 0 })) },
      key,
    );
    setBusy(false);
    if (!res.ok) return setErr(VI_ERR[res.error.code] ?? res.error.message);
    onCreated(res.data.id as string);
  }

  return (
    <Modal title="Lập báo giá" onClose={onClose}>
      <div className="mt-3 max-w-sm">
        <PartnerPicker partners={partners} value={partnerId} onChange={setPartnerId} label="Khách hàng" />
      </div>
      <LinesEditor items={items} lines={lines} onChange={setLines} />
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>
          Huỷ
        </button>
        <button id="btn-save-quote" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Lập báo giá ({formatMoney(linesTotal(lines))})
        </button>
      </div>
    </Modal>
  );
}

/** Nút hành động trên chi tiết báo giá — chỉ hiện nút hợp vai + hợp trạng thái (03 mục E). */
function QuoteActions({ doc, role, userId, reload }: { doc: DocRow; role: Role; userId: string; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function run(url: string, body: unknown) {
    setBusy(true);
    setErr("");
    const res = await callApi(url, body);
    setBusy(false);
    if (!res.ok) return setErr(VI_ERR[res.error.code] ?? res.error.message);
    setRejecting(false);
    setReason("");
    reload();
  }

  const chain = doc.meta.chain ?? [];
  const done = doc.meta.approvals?.length ?? 0;
  const myTurn = doc.status === "pending" && (role === "admin" || role === chain[done]) && userId !== doc.created_by;

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2">
        {doc.status === "draft" && can(role, "cq") && (
          <button id="btn-confirm-quote" className={btnPrimary} disabled={busy} onClick={() => void run("/api/quotes/confirm", { quoteId: doc.id })}>
            Gửi khách
          </button>
        )}
        {myTurn && (
          <>
            <button
              id="btn-approve"
              className={btnPrimary}
              disabled={busy}
              onClick={() => void run("/api/approvals/decide", { docId: doc.id, decision: "approve" })}
            >
              Duyệt giá
            </button>
            <button id="btn-reject" className={btnGhost} disabled={busy} onClick={() => setRejecting(!rejecting)}>
              Từ chối
            </button>
          </>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex gap-2">
          <input className={inputCls} placeholder="Lý do từ chối" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className={btnPrimary}
            disabled={busy || !reason.trim()}
            onClick={() => void run("/api/approvals/decide", { docId: doc.id, decision: "reject", reason: reason.trim() })}
          >
            Xác nhận từ chối
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
    </div>
  );
}
