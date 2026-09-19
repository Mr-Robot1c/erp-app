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

export type BoardModule = "sales" | "buy";

const TABS_BY_MODULE: Record<BoardModule, Tab[]> = {
  sales: [
    { key: "QUOTE", label: "Báo giá" },
    { key: "SO", label: "Đơn bán" },
    { key: "DO", label: "Phiếu xuất" },
    { key: "INV", label: "Hoá đơn" },
    { key: "RCPT", label: "Phiếu thu" },
  ],
  buy: [
    { key: "PR", label: "Yêu cầu mua" },
    { key: "PO", label: "Đơn mua" },
    { key: "GRN", label: "Phiếu nhập" },
    { key: "VINV", label: "Hoá đơn mua" },
    { key: "PAY", label: "Phiếu chi" },
  ],
};

/** Vai ghi hoá đơn nhà cung cấp: mua hàng (PERMS 'vinv') + kế toán giữ sổ phải trả. */
const VINV_ROLES: Role[] = ["admin", "purchasing", "accountant", "chief_accountant"];

const VI_ERR: Record<string, string> = {
  forbidden: "Bạn không có quyền làm việc này (hoặc chưa tới lượt của bạn).",
  state_invalid: "Chứng từ không còn ở trạng thái phù hợp — tải lại trang.",
  not_found: "Không tìm thấy dữ liệu.",
  invalid_argument: "Thông tin chưa hợp lệ.",
};

export function DocBoard({
  module,
  role,
  userId,
  partners,
  items,
  docs,
}: {
  module: BoardModule;
  role: Role;
  userId: string;
  partners: PartnerRow[];
  items: LineItemOption[];
  docs: DocRow[];
}) {
  const router = useRouter();
  const TABS = TABS_BY_MODULE[module];
  const [tab, setTab] = useState(TABS[0].key);
  const [status, setStatus] = useState<DocStatus | "all">("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [buying, setBuying] = useState(false);
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
        <h1 className="text-lg font-semibold">{module === "buy" ? "Mua hàng" : "Bán hàng"}</h1>
        <div className="flex gap-2">
          {module === "buy" && can(role, "pay") && (
            <button id="btn-new-pay" className={btnPrimary} onClick={() => setPaying(true)}>
              + Trả tiền
            </button>
          )}
          {module === "buy" && can(role, "po") && (
            <button id="btn-new-po" className={btnPrimary} onClick={() => setBuying(true)}>
              + Lập đơn mua
            </button>
          )}
          {module === "sales" && can(role, "rcpt") && (
            <button id="btn-new-receipt" className={btnPrimary} onClick={() => setReceiving(true)}>
              + Thu tiền
            </button>
          )}
          {module === "sales" && can(role, "quote") && (
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
          placeholder={module === "buy" ? "Tìm số chứng từ, nhà cung cấp…" : "Tìm số chứng từ, khách hàng…"}
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

      <div className="mt-3 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm" id="doc-table">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Số</th>
              <th className="px-3 py-2 text-left">{module === "buy" ? "Nhà cung cấp" : "Khách hàng"}</th>
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
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(Number(d.doc_type === "RCPT" || d.doc_type === "PAY" ? d.meta.amount ?? 0 : d.meta.totals?.total ?? 0))}</td>
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

      {buying && (
        <PurchaseOrderForm
          suppliers={partners.filter((p) => p.kind !== "customer")}
          items={items}
          onClose={() => setBuying(false)}
          onCreated={(id) => {
            setBuying(false);
            router.refresh();
            setOpenId(id);
          }}
        />
      )}

      {paying && (
        <PayForm
          partners={partners.filter((p) => p.kind !== "customer")}
          onClose={() => setPaying(false)}
          onCreated={(id) => {
            setPaying(false);
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
              suppliers={partners.filter((p) => p.kind !== "customer")}
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
  if (d.doc_type === "PR" || d.doc_type === "PO") {
    if (d.meta.forSONo) out.push(["Cho đơn bán", String(d.meta.forSONo)]);
  }
  if (d.doc_type === "PO") {
    if (d.meta.eta) out.push(["Hạn giao dự kiến", String(d.meta.eta)]);
    if (d.meta.sentToSupplier) out.push(["Trạng thái gửi", "Đã gửi nhà cung cấp"]);
  }
  if (d.doc_type === "GRN") {
    if (d.meta.poNo) out.push(["Theo đơn mua", String(d.meta.poNo)]);
    if (d.meta.qc) out.push(["Kiểm hàng", d.meta.qcPassed ? "Đã đạt — ở kho chính" : "Chờ kiểm (kho QC)"]);
    if (d.meta.variance?.length) out.push(["Lệch so với đơn", d.meta.variance.map((v) => (v.diff > 0 ? "+" : "") + v.diff).join(", ")]);
  }
  if (d.doc_type === "VINV") {
    if (d.meta.poNo) out.push(["Theo đơn mua", String(d.meta.poNo)]);
    if (d.meta.invoiceNo) out.push(["Số hoá đơn NCC", String(d.meta.invoiceNo)]);
    if (d.meta.total) out.push(["Phải trả (gồm thuế)", formatMoney(Number(d.meta.total))]);
    if (d.meta.due) out.push(["Hạn thanh toán", String(d.meta.due)]);
    if (d.meta.cogsAdjustment) out.push(["Chênh giá vốn", formatMoney(Number(d.meta.cogsAdjustment))]);
    if (d.meta.matchNote) out.push(["Lệch khi đối chiếu", String(d.meta.matchNote)]);
  }
  if (d.doc_type === "PAY") {
    out.push(["Số tiền", formatMoney(Number(d.meta.amount ?? 0))]);
    out.push(["Hình thức", d.meta.method === "cash" ? "Tiền mặt" : "Chuyển khoản"]);
    if (d.meta.bankRef) out.push(["Mã giao dịch", String(d.meta.bankRef)]);
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
  suppliers,
}: {
  suppliers: PartnerOption[];
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
  const [poKey] = useState(newKey);
  const [receiving, setReceiving] = useState(false);
  const [passKey] = useState(newKey);
  const [poFromPr, setPoFromPr] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [delivering, setDelivering] = useState(false);
  const [invoicing, setInvoicing] = useState(false);

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
  const isPr = doc.doc_type === "PR";
  const isPo = doc.doc_type === "PO";
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
        {isPr && doc.status === "confirmed" && can(role, "po") && (
          <button id="btn-pr-to-po" className={btnPrimary} disabled={busy} onClick={() => setPoFromPr(!poFromPr)}>
            Tạo đơn mua
          </button>
        )}
        {isPo && (doc.status === "confirmed" || doc.status === "partial") && can(role, "grn") && (
          <button id="btn-receive" className={btnPrimary} disabled={busy} onClick={() => setReceiving(!receiving)}>
            Nhận hàng
          </button>
        )}
        {isPo && (doc.status === "confirmed" || doc.status === "partial" || doc.status === "done") && VINV_ROLES.includes(role) && (
          <button id="btn-vinv" className={btnGhost} disabled={busy} onClick={() => setInvoicing(!invoicing)}>
            Ghi hoá đơn mua
          </button>
        )}
        {doc.doc_type === "GRN" && doc.meta.qc && !doc.meta.qcPassed && can(role, "grn") && (
          <button id="btn-pass-qc" className={btnPrimary} disabled={busy} onClick={() => void run("/api/purchase/pass-qc", { grnId: doc.id }, passKey)}>
            Đạt kiểm — chuyển kho chính
          </button>
        )}
        {isPo && doc.status === "draft" && can(role, "cpo") && (
          <button id="btn-confirm-po" className={btnPrimary} disabled={busy} onClick={() => void run("/api/purchase/orders/confirm", { poId: doc.id })}>
            Xác nhận đơn mua
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
              {isOrder ? "Duyệt công nợ" : isPo ? "Duyệt đơn mua" : doc.doc_type === "VINV" ? "Duyệt hoá đơn lệch" : doc.doc_type === "PAY" ? "Duyệt chi" : "Duyệt giá"}
            </button>
            <button id="btn-reject" className={btnGhost} disabled={busy} onClick={() => setRejecting(!rejecting)}>
              Từ chối
            </button>
          </>
        )}
      </div>

      {poFromPr && (
        <div className="mt-2 grid max-w-md gap-2">
          <PartnerPicker partners={suppliers} value={supplierId} onChange={setSupplierId} label="Nhà cung cấp" />
          <div>
            <button
              id="btn-create-po"
              className={btnPrimary}
              disabled={busy || !supplierId}
              onClick={async () => {
                const d = await run("/api/purchase/orders", { supplierId, fromPrId: doc.id }, poKey);
                if (d) openDoc(d.id as string);
              }}
            >
              Tạo đơn mua
            </button>
          </div>
        </div>
      )}

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

      {receiving && (
        <ReceiveForm
          doc={doc}
          ctx={ctx}
          items={items}
          onDone={(id) => {
            setReceiving(false);
            reload();
            if (id) openDoc(id);
          }}
        />
      )}

      {invoicing && (
        <VendorInvoiceForm
          doc={doc}
          ctx={ctx}
          items={items}
          onDone={(id) => {
            setInvoicing(false);
            reload();
            if (id) openDoc(id);
          }}
        />
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
    <div className="mt-2 rounded-[var(--r)] border border-[var(--line)] p-3" id="deliver-form">
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

/** Form trả tiền nhà cung cấp (lô 3.4): nhà cung cấp gõ-để-tìm, số tiền, hình thức, mã giao dịch ngân hàng (chống ghi trùng). */
function PayForm({
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
    if (!partnerId) return setErr("Chọn nhà cung cấp.");
    if (!(Number(amount) > 0)) return setErr("Nhập số tiền lớn hơn 0.");
    setBusy(true);
    setErr("");
    const res = await callApi(
      "/api/purchase/pay",
      { supplierId: partnerId, amount: Math.round(Number(amount)), method, bankRef: bankRef.trim() || undefined },
      key,
    );
    setBusy(false);
    if (!res.ok) return setErr(res.error.code === "duplicate" ? res.error.message : (VI_ERR[res.error.code] ?? res.error.message));
    onCreated(res.data.id as string);
  }

  return (
    <Modal title="Trả tiền nhà cung cấp" onClose={onClose}>
      <div className="mt-3 grid max-w-md gap-3">
        <PartnerPicker partners={partners} value={partnerId} onChange={setPartnerId} label="Nhà cung cấp" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Số tiền (đồng)</label>
            <input id="pay-amount" className={inputCls} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Hình thức</label>
            <select id="pay-method" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as "bank" | "cash")}>
              <option value="bank">Chuyển khoản</option>
              <option value="cash">Tiền mặt</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">Mã giao dịch ngân hàng (nếu có)</label>
          <input id="pay-ref" className={inputCls} value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>
          Huỷ
        </button>
        <button id="btn-save-pay" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Lập phiếu chi
        </button>
      </div>
    </Modal>
  );
}

/** Form lập đơn mua tự do (không từ yêu cầu mua): nhà cung cấp gõ-để-tìm + chuẩn form dòng hàng, đơn giá mặc định = giá vốn. */
function PurchaseOrderForm({
  suppliers,
  items,
  onClose,
  onCreated,
}: {
  suppliers: PartnerOption[];
  items: LineItemOption[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([emptyLine()]);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const buyable = items.filter((i) => i.kind !== "service" && i.kind !== "finished");

  async function submit() {
    if (!supplierId) return setErr("Chọn nhà cung cấp.");
    if (lines.some((l) => !l.itemId)) return setErr("Mỗi dòng phải chọn mặt hàng.");
    if (lines.some((l) => !(Number(l.qty) > 0))) return setErr("Số lượng phải lớn hơn 0.");
    setBusy(true);
    setErr("");
    const res = await callApi(
      "/api/purchase/orders",
      { supplierId, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), price: Number(l.price) || 0 })) },
      key,
    );
    setBusy(false);
    if (!res.ok) return setErr(VI_ERR[res.error.code] ?? res.error.message);
    onCreated(res.data.id as string);
  }

  return (
    <Modal title="Lập đơn mua" onClose={onClose}>
      <div className="mt-3 max-w-sm">
        <PartnerPicker partners={suppliers} value={supplierId} onChange={setSupplierId} label="Nhà cung cấp" />
      </div>
      <LinesEditor items={buyable} lines={lines} onChange={setLines} />
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>
          Huỷ
        </button>
        <button id="btn-save-po" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Lập đơn mua ({formatMoney(linesTotal(lines))})
        </button>
      </div>
    </Modal>
  );
}

/** Form nhận hàng (lô 3.2): mỗi dòng còn thiếu nhập số nhận (mặc định = phần còn lại); hàng serial/lô khai đủ; đánh dấu đợt cuối
 * khi nhà cung cấp không giao thêm (để kiểm lệch quá dung sai, AC-21). */
function ReceiveForm({
  doc,
  ctx,
  items,
  onDone,
}: {
  doc: DocRow;
  ctx: { lines: LineRow[]; held: Record<number, number> };
  items: LineItemOption[];
  onDone: (grnId: string | null) => void;
}) {
  type Row = { qty: string; serials: string; lot: string };
  const rows = ctx.lines.filter((l) => Number(l.qty) - Number(l.meta?.received ?? 0) > 0);
  const [vals, setVals] = useState<Record<number, Row>>({});
  const [final, setFinal] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rowOf = (l: LineRow): Row => vals[l.line_no] ?? { qty: String(Number(l.qty) - Number(l.meta?.received ?? 0)), serials: "", lot: "" };
  const set = (l: LineRow, p: Partial<Row>) => setVals({ ...vals, [l.line_no]: { ...rowOf(l), ...p } });

  async function submit() {
    const lines = rows
      .map((l) => {
        const v = rowOf(l);
        const it = items.find((i) => i.id === l.item_id);
        const qty = Number(v.qty);
        if (!(qty > 0)) return null;
        const line: Record<string, unknown> = { lineNo: l.line_no, qty };
        if (it?.tracking === "serial") line.serials = v.serials.split(/[\s,;]+/).filter(Boolean);
        if (it?.tracking === "lot") line.lots = [{ lotNo: v.lot.trim(), qty }];
        return line;
      })
      .filter(Boolean);
    if (!lines.length) return setErr("Chưa nhập số lượng nhận.");
    setBusy(true);
    setErr("");
    const res = await callApi("/api/purchase/receive", { poId: doc.id, lines, final: final || undefined }, key);
    setBusy(false);
    if (!res.ok) return setErr(VI_ERR[res.error.code] ?? res.error.message);
    onDone((res.data.id as string) ?? null);
  }

  return (
    <div className="mt-2 rounded-[var(--r)] border border-[var(--line)] p-3" id="receive-form">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((l) => {
            const it = items.find((i) => i.id === l.item_id);
            const v = rowOf(l);
            return (
              <tr key={l.line_no} className="align-top">
                <td className="py-1 pr-2">{it?.name ?? "—"}</td>
                <td className="w-24 py-1 pr-2">
                  <input className={`${inputCls} rq`} type="number" min={0} step="any" value={v.qty} onChange={(e) => set(l, { qty: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  {it?.tracking === "serial" && (
                    <input className={inputCls} placeholder="Số serial, cách nhau dấu phẩy" value={v.serials} onChange={(e) => set(l, { serials: e.target.value })} />
                  )}
                  {it?.tracking === "lot" && <input className={inputCls} placeholder="Số lô" value={v.lot} onChange={(e) => set(l, { lot: e.target.value })} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input id="receive-final" type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} />
        Đợt nhận cuối (nhà cung cấp không giao thêm)
      </label>
      <div className="mt-2 flex justify-end">
        <button id="btn-confirm-receive" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          Xác nhận nhận hàng
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
    </div>
  );
}

/** Form ghi hoá đơn nhà cung cấp (lô 3.3): số hoá đơn + mỗi dòng còn chưa ghi (mặc định = đã nhận − đã ghi hoá đơn; dịch vụ = đặt − đã ghi)
 * với giá theo hoá đơn (mặc định = giá đơn mua). Lệch quá dung sai → hoá đơn chờ kế toán trưởng duyệt. */
function VendorInvoiceForm({
  doc,
  ctx,
  items,
  onDone,
}: {
  doc: DocRow;
  ctx: { lines: LineRow[]; held: Record<number, number> };
  items: LineItemOption[];
  onDone: (id: string | null) => void;
}) {
  type Row = { qty: string; price: string };
  const kindOf = (l: LineRow) => items.find((i) => i.id === l.item_id)?.kind ?? "goods";
  const openQty = (l: LineRow) =>
    (kindOf(l) === "service" ? Number(l.qty) : Number(l.meta?.received ?? 0)) - Number(l.meta?.invoiced ?? 0);
  const rows = ctx.lines.filter((l) => openQty(l) > 0);
  const [vals, setVals] = useState<Record<number, Row>>({});
  const [invoiceNo, setInvoiceNo] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rowOf = (l: LineRow): Row => vals[l.line_no] ?? { qty: String(openQty(l)), price: String(Number(l.price)) };
  const set = (l: LineRow, p: Partial<Row>) => setVals({ ...vals, [l.line_no]: { ...rowOf(l), ...p } });

  async function submit() {
    if (!invoiceNo.trim()) return setErr("Nhập số hoá đơn của nhà cung cấp.");
    const lines = rows
      .map((l) => ({ lineNo: l.line_no, qty: Number(rowOf(l).qty), price: Math.round(Number(rowOf(l).price)) }))
      .filter((l) => l.qty > 0);
    if (!lines.length) return setErr("Chưa nhập số lượng trên hoá đơn.");
    setBusy(true);
    setErr("");
    const res = await callApi("/api/purchase/vendor-invoice", { poId: doc.id, invoiceNo: invoiceNo.trim(), lines }, key);
    setBusy(false);
    if (!res.ok) return setErr(res.error.code === "duplicate" || res.error.code === "state_invalid" ? res.error.message : (VI_ERR[res.error.code] ?? res.error.message));
    onDone((res.data.id as string) ?? null);
  }

  return (
    <div className="mt-2 rounded-[var(--r)] border border-[var(--line)] p-3" id="vinv-form">
      {rows.length === 0 && <p className="text-sm text-[var(--ink2)]">Không còn dòng nào chờ hoá đơn (hàng chưa nhận thì chưa ghi được hoá đơn).</p>}
      <table className="w-full text-sm">
        <tbody>
          {rows.map((l) => {
            const v = rowOf(l);
            return (
              <tr key={l.line_no}>
                <td className="py-1 pr-2">{items.find((i) => i.id === l.item_id)?.name ?? "—"}</td>
                <td className="w-24 py-1 pr-2">
                  <input className={`${inputCls} vq`} type="number" min={0} step="any" value={v.qty} onChange={(e) => set(l, { qty: e.target.value })} />
                </td>
                <td className="w-36 py-1 pr-2">
                  <input className={`${inputCls} vp`} type="number" min={0} value={v.price} onChange={(e) => set(l, { price: e.target.value })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex gap-2">
        <input id="vinv-no" className={inputCls} placeholder="Số hoá đơn của nhà cung cấp" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        <button id="btn-confirm-vinv" className={btnPrimary} disabled={busy || rows.length === 0} onClick={() => void submit()}>
          Ghi hoá đơn mua
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
    </div>
  );
}
