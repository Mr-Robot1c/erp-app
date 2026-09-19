"use client";
import { useEffect, type ReactNode } from "react";
import { STATUS_LABEL, type DocStatus } from "@erp/core";

/** Pill trạng thái theo bộ màu chuẩn (03-chuan-giao-dien mục D) — class `.pill.<status>` ở globals.css. */
export function StatusPill({ status }: { status: DocStatus }) {
  return <span className={`pill ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Khung modal dùng chung cho form + chi tiết chứng từ. Esc / bấm nền để đóng. */
export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-3xl rounded-[10px] border border-[var(--line)] bg-[var(--sf)] p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="rounded-md border border-[var(--line)] px-2.5 py-1 text-sm" onClick={onClose}>
            Đóng
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Idempotency-Key mới cho mỗi lần người dùng mở form (giữ nguyên khi bấm lại/retry). */
export const newKey = () => crypto.randomUUID();

export type ApiResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } };

export async function callApi(url: string, body: unknown, idempotencyKey?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ApiResult;
}

export const btnPrimary =
  "rounded-md bg-[var(--acc)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
export const btnGhost = "rounded-md border border-[var(--line)] bg-[var(--sf)] px-3 py-1.5 text-sm disabled:opacity-50";
export const inputCls = "w-full rounded-md border border-[var(--line)] bg-[var(--sf)] px-2.5 py-1.5 text-sm";
