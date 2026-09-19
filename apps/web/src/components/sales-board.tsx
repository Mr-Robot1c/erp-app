"use client";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { STATUSES, STATUS_LABEL, can, formatMoney, type DocStatus, type Role } from "@erp/core";
import { DocDetail, type DocRow, type LineRow } from "./doc-detail";
import { Modal, StatusPill, btnGhost, btnPrimary, callApi, inputCls, newKey, statusLabelOf } from "./doc-ui";
import { LinesEditor, emptyLine, linesTotal, type EditorLine, type LineItemOption } from "./lines-editor";
import { PartnerPicker, type PartnerOption } from "./partner-picker";

type PartnerRow = PartnerOption & { kind: string };
type Tab = { key: string; label: string };

const TABS: Tab[] = [
  { key: "QUOTE", label: "Báo giá" },
  { key: "SO", label: "Đơn bán" },
  { key: "DO", label: "Phiếu xuất" },
  { key: "INV", label: "Hoá đơn" },
  { key: "RCPT", label: "Phiếu thu" },
];

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
  const [receiving, setReceiving] = useState(false);
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
        <div className="flex gap-2">
          {can(role, "rcpt") && (
            <button id="btn-new-receipt" className={btnPrimary} onClick={() => setReceiving(true)}>
              + Thu tiền
            </button>
          )}
          {can(role, "quote") && (
            <button id="btn-new-quote" className={btnPrimary} onClick={() => setCreating(true)}>
              + Lập báo giá
            </button>
          )}
        </div>
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
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(d.doc_type === "RCPT" ? d.meta.amount ?? 0 : d.meta.totals?.total ?? 0))}</td>
                <td className="px-3 py-2">
                  <StatusPill status={d.status} label={statusLabelOf(d)} />
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

      {receiving && (
        <ReceiptForm
          partners={partners.filter((p) => p.kind !== "supplier")}
          onClose={() => setReceiving(false)}
          onCreated={(id) => {
            setReceiving(false);
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
          openByNo={(no) => setOpenId(docs.find((x) => x.doc_no === no)?.id ?? openId)}
          canOpenNo={(no) => docs.some((x) => x.doc_no === no)}
          extraInfo={extraInfo}
          actions={(d, reload, ctx) => (
            <DocActions
              ctx={ctx}
              items={items}
              doc={d}
              role={role}
              userId={userId}
              reload={reload}
              openDoc={(id) => {
                router.refresh();
                setOpenId(id);
              }}
            />
          )}
        />
      )}
    </div>
  );
}

function extraInfo(d: DocRow): [string, ReactNode][] {
  const out: [string, ReactNode][] = [];
  if (d.meta.validTo) out.push(["Hiệu lực đến", d.meta.validTo]);
  if (d.doc_type === "SO") {
    out.push(["Điều khoản", d.meta.terms === "credit" ? "Công nợ" : "Trả khi giao"]);
    if (Number(d.meta.depositPct) > 0) out.push(["Cọc", `${d.meta.depositPct}%`]);
    if (d.meta.total) out.push(["Tổng gồm thuế", formatMoney(Number(d.meta.total))]);
    if (d.meta.note) out.push(["Ghi chú", String(d.meta.note)]);
  }
  if (d.doc_type === "INV") {
    if (d.meta.deliverDate) out.push(["Ngày giao (ghi doanh thu)", d.meta.deliverDate]);
    if (d.meta.due) out.push(["Hạn thanh toán", d.meta.due]);
    if (d.meta.total) out.push(["Tổng gồm thuế", formatMoney(Number(d.meta.total))]);
    if (Number(d.meta.advApplied) > 0) out.push(["Đã cấn trừ (cọc/ứng trước)", formatMoney(Number(d.meta.advApplied))]);
  }
  if (d.doc_type === "RCPT") {
    out.push(["Số tiền", formatMoney(Number(d.meta.amount ?? 0))]);
    out.push(["Hình thức", d.meta.method === "cash" ? "Tiền mặt" : "Chuyển khoản"]);
    if (d.meta.bankRef) out.push(["Mã giao dịch", String(d.meta.bankRef)]);
  }
  return out;
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

/** Nút hành động trên chi tiết chứng từ — chỉ hiện nút hợp vai + hợp trạng thái (03 mục E). */
function DocActions({
  doc,
  role,
  userId,
  reload,
  openDoc,
  ctx,
  items,
}: {
  ctx: { lines: LineRow[]; held: Record<number, number> };
  items: LineItemOption[];
  doc: DocRow;
  role: Role;
  userId: string;
  reload: () => void;
  openDoc: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [toOrder, setToOrder] = useState(false);
  const [terms, setTerms] = useState<"cash" | "credit">("cash");
  const [depositPct, setDepositPct] = useState("0");
  const [orderKey] = useState(newKey);
  const [invoiceKey] = useState(newKey);
  const [delivering, setDelivering] = useState(false);

  async function run(url: string, body: unknown, key?: string) {
    setBusy(true);
    setErr("");
    const res = await callApi(url, body, key);
    setBusy(false);
    if (!res.ok) {
      setErr(VI_ERR[res.error.code] ?? res.error.message);
      return null;
    }
    setRejecting(false);
    setReason("");
    reload();
    return res.data;
  }

  const chain = doc.meta.chain ?? [];
  const done = doc.meta.approvals?.length ?? 0;
  const myTurn = doc.status === "pending" && (role === "admin" || role === chain[done]) && userId !== doc.created_by;
  const isQuote = doc.doc_type === "QUOTE";
  const isOrder = doc.doc_type === "SO";
  const notExpired = !doc.meta.validTo || doc.meta.validTo >= new Date().toISOString().slice(0, 10);

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2">
        {isQuote && doc.status === "draft" && can(role, "cq") && (
          <button id="btn-confirm-quote" className={btnPrimary} disabled={busy} onClick={() => void run("/api/quotes/confirm", { quoteId: doc.id })}>
            Gửi khách
          </button>
        )}
        {isQuote && doc.status === "confirmed" && notExpired && can(role, "q2o") && (
          <button id="btn-to-order" className={btnPrimary} disabled={busy} onClick={() => setToOrder(!toOrder)}>
            Chuyển thành đơn
          </button>
        )}
        {doc.doc_type === "INV" && doc.status === "draft" && can(role, "issue") && (
          <button id="btn-issue" className={btnPrimary} disabled={busy} onClick={() => void run("/api/invoices/issue", { invoiceId: doc.id }, invoiceKey)}>
            Phát hành hoá đơn
          </button>
        )}
        {isOrder && doc.status === "draft" && can(role, "cso") && (
          <button id="btn-confirm-order" className={btnPrimary} disabled={busy} onClick={() => void run("/api/orders/confirm", { orderId: doc.id })}>
            Xác nhận đơn
          </button>
        )}
        {isOrder && (doc.status === "confirmed" || doc.status === "partial") && can(role, "deliver") && (
          <button id="btn-deliver" className={btnPrimary} disabled={busy} onClick={() => setDelivering(!delivering)}>
            Xuất kho
          </button>
        )}
        {isOrder && (doc.status === "confirmed" || doc.status === "partial") && can(role, "deliver") && (
          <button id="btn-refulfil" className={btnGhost} disabled={busy} onClick={() => void run("/api/orders/refulfil", { orderId: doc.id })}>
            Đáp ứng lại
          </button>
        )}
        {myTurn && (
          <>
            <button id="btn-approve" className={btnPrimary} disabled={busy} onClick={() => void run("/api/approvals/decide", { docId: doc.id, decision: "approve" })}>
              {isOrder ? "Duyệt công nợ" : "Duyệt giá"}
            </button>
            <button id="btn-reject" className={btnGhost} disabled={busy} onClick={() => setRejecting(!rejecting)}>
              Từ chối
            </button>
          </>
        )}
      </div>

      {toOrder && (
        <div className="mt-2 grid max-w-md grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Điều khoản</label>
            <select id="order-terms" className={inputCls} value={terms} onChange={(e) => setTerms(e.target.value as "cash" | "credit")}>
              <option value="cash">Trả khi giao</option>
              <option value="credit">Công nợ</option>
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Cọc (%)</label>
            <input id="order-deposit" className={inputCls} type="number" min={0} max={100} value={depositPct} onChange={(e) => setDepositPct(e.target.value)} />
          </div>
          <div className="col-span-2">
            <button
              id="btn-create-order"
              className={btnPrimary}
              disabled={busy}
              onClick={async () => {
                const d = await run("/api/quotes/to-order", { quoteId: doc.id, terms, depositPct: Number(depositPct) || 0 }, orderKey);
                if (d) openDoc(d.id as string);
              }}
            >
              Tạo đơn
            </button>
          </div>
        </div>
      )}

      {delivering && (
        <DeliverForm
          doc={doc}
          ctx={ctx}
          items={items}
          onDone={(id) => {
            setDelivering(false);
            reload();
            if (id) openDoc(id);
          }}
        />
      )}

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

/** Form xuất kho (lô 2.4): mỗi dòng còn giữ hàng nhập số xuất (mặc định = số đang giữ); hàng serial khai danh sách
 * số serial, hàng theo lô khai số lô; có quy đổi đơn vị thì chọn đơn vị. Nút chốt đặt tên theo việc (03 mục E). */
function DeliverForm({
  doc,
  ctx,
  items,
  onDone,
}: {
  doc: DocRow;
  ctx: { lines: LineRow[]; held: Record<number, number> };
  items: LineItemOption[];
  onDone: (invId: string | null) => void;
}) {
  type Row = { qty: string; uom: string; serials: string; lot: string };
  const rows = ctx.lines.filter((l) => (items.find((i) => i.id === l.item_id)?.kind ?? "goods") === "service" || (ctx.held[l.line_no] ?? 0) > 0);
  const [vals, setVals] = useState<Record<number, Row>>({});
  // Dòng chi tiết có thể tải xong SAU khi form mở -> giá trị mặc định tính lúc đọc, không ở lúc khởi tạo state.
  const rowOf = (l: LineRow): Row =>
    vals[l.line_no] ?? { qty: String(ctx.held[l.line_no] ?? Number(l.qty) - Number(l.meta?.delivered ?? 0)), uom: "", serials: "", lot: "" };
  const [signedBy, setSignedBy] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (l: LineRow, p: Partial<Row>) => setVals({ ...vals, [l.line_no]: { ...rowOf(l), ...p } });

  async function submit() {
    const lines = rows
      .map((l) => {
        const v = rowOf(l);
        const it = items.find((i) => i.id === l.item_id);
        const qty = Number(v.qty);
        if (!(qty > 0)) return null;
        const line: Record<string, unknown> = { lineNo: l.line_no, qty };
        if (v.uom) line.uom = v.uom;
        if (it?.tracking === "serial") line.serials = v.serials.split(/[\s,;]+/).filter(Boolean);
        if (it?.tracking === "lot") line.lots = [{ lotNo: v.lot.trim(), qty: v.uom && it.uom_factors?.[v.uom] ? qty * it.uom_factors[v.uom] : qty }];
        return line;
      })
      .filter(Boolean);
    if (!lines.length) return setErr("Chưa nhập số lượng xuất.");
    setBusy(true);
    setErr("");
    const res = await callApi("/api/orders/deliver", { orderId: doc.id, lines, signedBy: signedBy.trim() || undefined }, key);
    setBusy(false);
    if (!res.ok) return setErr(VI_ERR[res.error.code] ?? res.error.message);
    onDone((res.data.invId as string) ?? null);
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--line)] p-3" id="deliver-form">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((l) => {
            const it = items.find((i) => i.id === l.item_id);
            const v = rowOf(l);
            const factors = Object.keys(it?.uom_factors ?? {});
            return (
              <tr key={l.line_no} className="align-top">
                <td className="py-1 pr-2">{it?.name ?? "—"}</td>
                <td className="w-24 py-1 pr-2">
                  <input className={`${inputCls} dq`} type="number" min={0} step="any" value={v.qty} onChange={(e) => set(l, { qty: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  {factors.length > 0 && (
                    <select className={inputCls} value={v.uom} onChange={(e) => set(l, { uom: e.target.value })}>
                      <option value="">{it?.uom}</option>
                      {factors.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  )}
                  {it?.tracking === "serial" && (
                    <input className={`${inputCls} mt-1`} placeholder="Số serial, cách nhau dấu phẩy" value={v.serials} onChange={(e) => set(l, { serials: e.target.value })} />
                  )}
                  {it?.tracking === "lot" && (
                    <input className={`${inputCls} mt-1`} placeholder="Số lô" value={v.lot} onChange={(e) => set(l, { lot: e.target.value })} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex gap-2">
        <input className={inputCls} placeholder="Người ký nhận (khách)" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />
        <button id="btn-confirm-deliver" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Xác nhận xuất kho
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
    </div>
  );
}

/** Form thu tiền (lô 2.5): khách gõ-để-tìm, số tiền, hình thức, mã giao dịch ngân hàng (chống ghi trùng). */
function ReceiptForm({
  partners,
  onClose,
  onCreated,
}: {
  partners: PartnerOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"bank" | "cash">("bank");
  const [bankRef, setBankRef] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!partnerId) return setErr("Chọn khách hàng.");
    if (!(Number(amount) > 0)) return setErr("Nhập số tiền lớn hơn 0.");
    setBusy(true);
    setErr("");
    const res = await callApi(
      "/api/receipts",
      { partnerId, amount: Math.round(Number(amount)), method, bankRef: bankRef.trim() || undefined },
      key,
    );
    setBusy(false);
    if (!res.ok) return setErr(res.error.code === "duplicate" ? res.error.message : (VI_ERR[res.error.code] ?? res.error.message));
    onCreated(res.data.id as string);
  }

  return (
    <Modal title="Thu tiền" onClose={onClose}>
      <div className="mt-3 grid max-w-md gap-3">
        <PartnerPicker partners={partners} value={partnerId} onChange={setPartnerId} label="Khách hàng" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Số tiền (đồng)</label>
            <input id="receipt-amount" className={inputCls} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Hình thức</label>
            <select id="receipt-method" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as "bank" | "cash")}>
              <option value="bank">Chuyển khoản</option>
              <option value="cash">Tiền mặt</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Mã giao dịch ngân hàng (nếu có)</label>
          <input id="receipt-ref" className={inputCls} value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>
          Huỷ
        </button>
        <button id="btn-save-receipt" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Ghi thu tiền
        </button>
      </div>
    </Modal>
  );
}
