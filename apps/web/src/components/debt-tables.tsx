"use client";
import { formatMoney } from "@erp/core";
import { PaginationFooter, usePagination } from "./pagination";

const KIND: Record<string, string> = { invoice: "Hoá đơn", deposit: "Cọc", renewal: "Gia hạn" };
const th = "px-3 py-2 text-left";

export type OpenReceivable = { id: string; kind: string; partner_id: string; amount: number; paid: number; due_date: string | null; overdue: boolean };
export type OpenPayable = { id: string; partner_id: string; amount: number; paid: number; due_date: string | null };

/** Bảng phải thu/phải trả còn mở — tách khỏi acc/page.tsx (server component) để dùng được
 * usePagination (client-only). Danh sách tăng dần theo số chứng từ nên cần phân trang (03 mục H). */
export function ReceivableTable({ open, pname }: { open: OpenReceivable[]; pname: Map<string, string> }) {
  const { pageRows, page, setPage, pageCount, total, pageSize } = usePagination(open, 10);
  return (
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
          {pageRows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--line)]">
              <td className="px-3 py-2">{pname.get(r.partner_id) ?? "—"}</td>
              <td className="px-3 py-2">{KIND[r.kind] ?? r.kind}</td>
              <td className="px-3 py-2">
                {r.due_date ?? "—"}
                {r.overdue && <span className="pill cancelled ml-2">Quá hạn</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(r.amount - r.paid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PaginationFooter total={total} page={page} pageCount={pageCount} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}

export function PayableTable({ openPay, pname }: { openPay: OpenPayable[]; pname: Map<string, string> }) {
  const { pageRows, page, setPage, pageCount, total, pageSize } = usePagination(openPay, 10);
  return (
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
          {pageRows.map((p) => (
            <tr key={p.id} className="border-t border-[var(--line)]">
              <td className="px-3 py-2">{pname.get(p.partner_id) ?? "—"}</td>
              <td className="px-3 py-2">{p.due_date ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(p.amount - p.paid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PaginationFooter total={total} page={page} pageCount={pageCount} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
