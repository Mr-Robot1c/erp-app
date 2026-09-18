"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "./sign-out-button";

const INDUSTRIES = [
  { code: "default", name: "Thương mại – dịch vụ (mặc định)" },
  { code: "trade", name: "Thương mại – phân phối" },
  { code: "construction", name: "Xây dựng – nhà thầu" },
  { code: "manufacturing", name: "Sản xuất – chế biến" },
] as const;

const VI_ERR: Record<string, string> = {
  duplicate: "Mã số thuế này đã đăng ký. Kiểm tra lại hoặc liên hệ quản trị viên doanh nghiệp đó.",
  conflict: "Tài khoản này đã thuộc một doanh nghiệp rồi.",
  invalid_argument: "Thông tin chưa hợp lệ, kiểm tra lại các trường.",
};

export function OnboardingForm({ email }: { email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [industry, setIndustry] = useState<(typeof INDUSTRIES)[number]["code"]>("default");
  const [withSample, setWithSample] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/tenant/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, taxCode, industry, withSample }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMsg(VI_ERR[json.error.code] ?? json.error.message);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">Đăng ký doanh nghiệp</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Bước 1/1 — tạo không gian riêng cho doanh nghiệp của bạn. Tài khoản: <b id="user-email">{email}</b>
      </p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="text-sm">
          Tên doanh nghiệp
          <input
            id="tenant-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Mã số thuế
          <input
            id="tenant-tax-code"
            required
            value={taxCode}
            onChange={(e) => setTaxCode(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Mẫu ngành
          <select
            id="tenant-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value as typeof industry)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
          >
            {INDUSTRIES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id="tenant-with-sample"
            type="checkbox"
            checked={withSample}
            onChange={(e) => setWithSample(e.target.checked)}
          />
          Nạp dữ liệu mẫu để thử ngay (khách hàng, tồn đầu — xoá được sau)
        </label>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <button
          id="btn-register"
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-50"
        >
          Hoàn tất đăng ký
        </button>
      </form>
      <div className="mt-4">
        <SignOutButton />
      </div>
    </main>
  );
}
