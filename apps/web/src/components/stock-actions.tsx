"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, btnGhost, btnPrimary, callApi, inputCls, newKey } from "./doc-ui";

type Item = { id: string; code: string; name: string; tracking: string };
type Wh = { id: string; code: string };
/** Tồn sổ sách theo (mặt hàng, kho) — khoá "itemId|whId". */
type Book = Record<string, number>;

const VI_ERR: Record<string, string> = {
  forbidden: "Bạn không có quyền làm việc này.",
  invalid_argument: "Thông tin chưa hợp lệ.",
  state_invalid: "Không thực hiện được ở trạng thái hiện tại.",
};

/** Nút "Chuyển kho" + "Kiểm kê" trên màn Kho (lô 3.5, AC-25/26). Kiểm kê nhập SỐ ĐẾM THỰC TẾ; hệ tính chênh lệch so với sổ và lập phiếu chờ kế toán duyệt. */
export function StockActions({ items, warehouses, book }: { items: Item[]; warehouses: Wh[]; book: Book }) {
  const router = useRouter();
  const [mode, setMode] = useState<"transfer" | "count" | null>(null);
  return (
    <div className="flex gap-2">
      <button id="btn-transfer" className={btnGhost} onClick={() => setMode("transfer")}>
        Chuyển kho
      </button>
      <button id="btn-count" className={btnPrimary} onClick={() => setMode("count")}>
        Kiểm kê
      </button>
      {mode && (
        <StockForm
          mode={mode}
          items={items}
          warehouses={warehouses}
          book={book}
          onClose={() => setMode(null)}
          onDone={() => {
            setMode(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function StockForm({
  mode,
  items,
  warehouses,
  book,
  onClose,
  onDone,
}: {
  mode: "transfer" | "count";
  items: Item[];
  warehouses: Wh[];
  book: Book;
  onClose: () => void;
  onDone: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [fromWh, setFromWh] = useState(warehouses[0]?.id ?? "");
  const [toWh, setToWh] = useState(warehouses[1]?.id ?? "");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const bookQty = itemId && fromWh ? (book[`${itemId}|${fromWh}`] ?? 0) : 0;

  async function submit() {
    setErr("");
    if (!itemId) return setErr("Chọn mặt hàng.");
    const n = Number(qty);
    if (mode === "transfer") {
      if (!(n > 0)) return setErr("Nhập số lượng chuyển lớn hơn 0.");
      if (fromWh === toWh) return setErr("Kho nguồn và kho đích phải khác nhau.");
    } else {
      if (qty === "" || !(n >= 0)) return setErr("Nhập số đếm thực tế.");
      if (n === bookQty) return setErr("Số đếm bằng số sổ — không có chênh lệch.");
      if (!reason.trim()) return setErr("Nhập lý do chênh lệch.");
    }
    setBusy(true);
    const res =
      mode === "transfer"
        ? await callApi("/api/stock/transfer", { itemId, fromWh, toWh, qty: n }, key)
        : await callApi("/api/stock/adjust", { itemId, warehouseId: fromWh, delta: n - bookQty, reason: reason.trim() }, key);
    setBusy(false);
    if (!res.ok) return setErr(res.error.code === "state_invalid" ? res.error.message : (VI_ERR[res.error.code] ?? res.error.message));
    if (mode === "count") {
      setNote("Đã lập phiếu điều chỉnh — chờ kế toán duyệt, tồn chưa đổi.");
      setTimeout(onDone, 1200);
    } else onDone();
  }

  const label = "mt-3 block text-[12px] text-[var(--ink2)]";
  return (
    <Modal title={mode === "transfer" ? "Chuyển kho" : "Kiểm kê"} onClose={onClose}>
      <div id="stock-form">
        <label className={label}>Mặt hàng</label>
        <select id="sf-item" className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Chọn mặt hàng…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id} disabled={mode === "transfer" && i.tracking !== "none"}>
              {i.name} ({i.code})
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{mode === "transfer" ? "Từ kho" : "Kho"}</label>
            <select id="sf-from" className={inputCls} value={fromWh} onChange={(e) => setFromWh(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}
                </option>
              ))}
            </select>
          </div>
          {mode === "transfer" && (
            <div>
              <label className={label}>Đến kho</label>
              <select id="sf-to" className={inputCls} value={toWh} onChange={(e) => setToWh(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {mode === "count" && itemId && <p className="mt-2 text-[12.5px] text-[var(--ink2)]">Số theo sổ: {bookQty}</p>}
        <label className={label}>{mode === "transfer" ? "Số lượng chuyển" : "Số đếm thực tế"}</label>
        <input id="sf-qty" className={inputCls} type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        {mode === "count" && (
          <>
            <label className={label}>Lý do chênh lệch</label>
            <input id="sf-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
          </>
        )}
        {err && <p className="mt-3 text-sm text-[var(--bad)]">{err}</p>}
        {note && <p id="sf-note" className="mt-3 text-sm text-[var(--ok)]">{note}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>
            Huỷ
          </button>
          <button id="btn-stock-save" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
            {mode === "transfer" ? "Xác nhận chuyển kho" : "Lập phiếu điều chỉnh"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
