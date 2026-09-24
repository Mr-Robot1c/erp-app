"use client";
import { KIND_LABEL_ITEM } from "@/lib/item-kinds";
import { PaginationFooter, usePagination } from "./pagination";

export type StockRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  onHand: number;
  reserved: number;
  available: number;
  qc: number;
};

/** Bảng tồn kho — tách khỏi stock/page.tsx (server component) để dùng usePagination (client-only). */
export function StockTable({ rows }: { rows: StockRow[] }) {
  const { pageRows, page, setPage, pageCount, total, pageSize } = usePagination(rows, 10);
  return (
    <div className="mt-3 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
      <table className="w-full text-sm" id="stock-table">
        <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Mặt hàng</th>
            <th className="px-3 py-2 text-left">Loại</th>
            <th className="px-3 py-2 text-right">Tồn</th>
            <th className="px-3 py-2 text-right">Đang giữ</th>
            <th className="px-3 py-2 text-right">Khả dụng</th>
            <th className="px-3 py-2 text-right">Chờ kiểm</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-[var(--ink2)]">
                Chưa có mặt hàng nào.
              </td>
            </tr>
          )}
          {pageRows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--line)]" data-item-code={r.code}>
              <td className="px-3 py-2">
                {r.name} <span className="font-mono text-[11.5px] text-[var(--ink2)]">{r.code}</span>
              </td>
              <td className="px-3 py-2">{KIND_LABEL_ITEM[r.kind] ?? r.kind}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{r.onHand}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{r.reserved}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${r.available <= 0 ? "text-[var(--bad)]" : ""}`}>{r.available}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--ink2)]">{r.qc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PaginationFooter total={total} page={page} pageCount={pageCount} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
