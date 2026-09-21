"use client";
import { useState } from "react";
import { btnGhost } from "./doc-ui";

/** Nút "Xuất Excel" (lô 4.4): gọi POST /api/reports/export rồi tải tệp về; lỗi (JSON) hiện ngay cạnh nút. */
export function ExportButton({ report, period, label = "Xuất Excel" }: { report: "gl" | "balance" | "ar"; period?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/reports/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report, ...(period ? { period } : {}) }),
    });
    setBusy(false);
    if (!res.headers.get("content-type")?.includes("spreadsheetml")) {
      const j = await res.json().catch(() => null);
      return setErr(j?.error?.message ?? "Không xuất được tệp.");
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bao-cao-${report}${period ? `-${period}` : ""}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={btnGhost} data-export={report} disabled={busy} onClick={() => void run()}>
        {label}
      </button>
      {err && <span className="text-[12px] text-[var(--bad)]">{err}</span>}
    </span>
  );
}
