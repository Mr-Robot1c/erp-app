"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  expThreshold?: number;
  poThreshold?: number;
  tolerancePct?: number;
  terms?: number;
  accounting?: { regime: string; version: string };
};

const VI_ERR: Record<string, string> = {
  invalid_argument: "Thông tin chưa hợp lệ, kiểm tra lại các trường.",
};

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [expThreshold, setExpThreshold] = useState(String(settings.expThreshold ?? 10_000_000));
  const [poThreshold, setPoThreshold] = useState(String(settings.poThreshold ?? 20_000_000));
  const [tolerancePct, setTolerancePct] = useState(String(settings.tolerancePct ?? 2));
  const [terms, setTerms] = useState(String(settings.terms ?? 30));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg("");
    setSaved(false);
    const res = await fetch("/api/tenant/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expThreshold: Number(expThreshold),
        poThreshold: Number(poThreshold),
        tolerancePct: Number(tolerancePct),
        terms: Number(terms),
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMsg(VI_ERR[json.error.code] ?? json.error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold">Cài đặt doanh nghiệp</h1>

      <form
        className="mt-4 flex flex-col gap-3 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="text-sm">
          Ngưỡng duyệt đề xuất chi (đồng)
          <input
            id="set-exp-threshold"
            type="number"
            min={1}
            required
            value={expThreshold}
            onChange={(e) => setExpThreshold(e.target.value)}
            className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Ngưỡng duyệt đơn mua (đồng)
          <input
            id="set-po-threshold"
            type="number"
            min={1}
            required
            value={poThreshold}
            onChange={(e) => setPoThreshold(e.target.value)}
            className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Dung sai đối chiếu (%)
          <input
            id="set-tolerance-pct"
            type="number"
            min={0}
            max={10}
            step={0.1}
            required
            value={tolerancePct}
            onChange={(e) => setTolerancePct(e.target.value)}
            className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Hạn công nợ mặc định (ngày)
          <input
            id="set-terms"
            type="number"
            min={1}
            required
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-2"
          />
        </label>

        {msg && <p className="text-sm text-[var(--bad)]">{msg}</p>}
        {saved && !msg && <p className="text-sm text-[var(--ok)]">Đã lưu.</p>}

        <button
          id="btn-save-settings"
          type="submit"
          disabled={busy}
          className="self-start rounded-[var(--r)] bg-[var(--acc)] px-3 py-2 font-medium text-white disabled:opacity-50"
        >
          Lưu
        </button>
      </form>

      <div className="mt-4 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4 text-sm">
        <div className="text-[11.5px] font-semibold tracking-wide text-[var(--ink2)] uppercase">
          Chế độ kế toán
        </div>
        <p className="mt-1 text-[var(--ink2)]">
          {settings.accounting?.regime ?? "TT133"} · phiên bản {settings.accounting?.version ?? "2016"} — đọc
          hiển thị, chỗ đổi để sau.
        </p>
      </div>
    </div>
  );
}
