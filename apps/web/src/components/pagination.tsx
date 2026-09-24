"use client";
import { useMemo, useState } from "react";

/** Phân trang phía client cho bảng danh sách (03 mục H — "chân bảng phân trang kiểu Freightek",
 * danh sách ≥10 dòng mới phân trang). Trang tự về 1 khi số dòng đổi (bộ lọc/tab đổi) — đồng bộ
 * NGAY trong render theo mẫu React khuyến nghị (không cần effect cho nhánh đồng bộ này). */
export function usePagination<T>(rows: T[], pageSize = 10) {
  const [state, setState] = useState({ rowsLength: rows.length, page: 1 });
  if (state.rowsLength !== rows.length) setState({ rowsLength: rows.length, page: 1 });

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clampedPage = Math.min(state.page, pageCount);
  const pageRows = useMemo(() => rows.slice((clampedPage - 1) * pageSize, clampedPage * pageSize), [rows, clampedPage, pageSize]);
  const setPage = (page: number) => setState((s) => ({ ...s, page }));
  return { pageRows, page: clampedPage, setPage, pageCount, total: rows.length, pageSize };
}

/** Chân bảng: trái "TỔNG: n · X dòng/trang", phải ô số trang vuông nhỏ (trang hiện tại nền --acc chữ trắng).
 * Ẩn hẳn khi tổng không vượt quá 1 trang (danh sách <10 dòng, đúng spec). */
export function PaginationFooter({
  total,
  page,
  pageCount,
  pageSize,
  onPageChange,
}: {
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-3 py-2 text-[12.5px] text-[var(--ink2)]" data-pagination>
      <span>
        TỔNG: {total} · {pageSize} dòng/trang
      </span>
      <div className="flex flex-wrap gap-1">
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            data-page={p}
            className={`flex h-6 w-6 items-center justify-center rounded text-[12px] ${
              p === page ? "bg-[var(--acc-fill)] font-medium text-white" : "border border-[var(--line)] bg-[var(--sf)] text-[var(--ink)]"
            }`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
