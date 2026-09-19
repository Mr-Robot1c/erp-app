"use client";
import { formatMoney } from "@erp/core";
import { btnGhost, inputCls } from "./doc-ui";

export type LineItemOption = {
  id: string;
  code: string;
  name: string;
  price: number;
  kind?: string;
  tracking?: string;
  uom?: string;
  uom_factors?: Record<string, number>;
};
export type EditorLine = { itemId: string; qty: string; price: string };

export const emptyLine = (): EditorLine => ({ itemId: "", qty: "1", price: "" });

export const linesTotal = (lines: EditorLine[]) =>
  lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)), 0);

/** Chuẩn form dòng hàng (03-chuan-giao-dien mục F, chốt 18/09): mở đúng 1 dòng; "+ Thêm dòng" góc phải;
 * mỗi dòng có nút xoá (dòng cuối thì reset chứ không xoá); chọn mặt hàng tự điền đơn giá;
 * thành tiền từng dòng + tổng chưa thuế cập nhật ngay khi gõ. */
export function LinesEditor({
  items,
  lines,
  onChange,
}: {
  items: LineItemOption[];
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
}) {
  const set = (i: number, patch: Partial<EditorLine>) =>
    onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  function pick(i: number, itemId: string) {
    const it = items.find((x) => x.id === itemId);
    set(i, { itemId, price: it ? String(it.price) : "" });
  }

  function remove(i: number) {
    if (lines.length === 1) onChange([emptyLine()]);
    else onChange(lines.filter((_, k) => k !== i));
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Dòng hàng</h3>
        <button type="button" className={btnGhost} onClick={() => onChange([...lines, emptyLine()])}>
          + Thêm dòng
        </button>
      </div>
      <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            <tr>
              <th className="px-2 py-2 text-left">Mặt hàng</th>
              <th className="w-20 px-2 py-2 text-left">SL</th>
              <th className="w-32 px-2 py-2 text-left">Đơn giá</th>
              <th className="w-32 px-2 py-2 text-right">Thành tiền</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const amount = Math.round((Number(l.qty) || 0) * (Number(l.price) || 0));
              return (
                <tr key={i} className="border-t border-[var(--line)]" data-line={i}>
                  <td className="px-2 py-1.5">
                    <select className={`${inputCls} li`} value={l.itemId} onChange={(e) => pick(i, e.target.value)}>
                      <option value="">Chọn mặt hàng…</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} — {formatMoney(it.price)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={`${inputCls} lq`}
                      type="number"
                      min={0}
                      step="any"
                      value={l.qty}
                      onChange={(e) => set(i, { qty: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={`${inputCls} lp`}
                      type="number"
                      min={0}
                      value={l.price}
                      placeholder="0"
                      onChange={(e) => set(i, { price: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[12.5px] tabular-nums text-[var(--ink2)]">
                    {amount ? formatMoney(amount) : ""}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      aria-label="Xoá dòng"
                      className="rounded-md px-2 py-1 text-[var(--bad)] hover:bg-[var(--bads)]"
                      onClick={() => remove(i)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end gap-2 text-sm">
        <span className="text-[var(--ink2)]">Tổng chưa thuế:</span>
        <b className="font-mono tabular-nums" id="lines-total">
          {formatMoney(linesTotal(lines))}
        </b>
      </div>
    </div>
  );
}
