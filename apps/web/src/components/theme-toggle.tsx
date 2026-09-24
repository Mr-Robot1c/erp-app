"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "erp-theme";

// data-theme trên <html> là nguồn sự thật (script trong layout đặt sẵn từ localStorage TRƯỚC khi vẽ, tránh nháy sáng→tối).
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const isDark = () => document.documentElement.dataset.theme === "dark";

/** Nút bật/tắt giao diện tối (03 mục H2): sáng mặc định, lưu `erp-theme` ở localStorage, KHÔNG theo prefers-color-scheme. */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return (
    <button
      id="btn-theme"
      type="button"
      aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      title={dark ? "Giao diện sáng" : "Giao diện tối"}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink2)]"
      onClick={() => {
        const next = dark ? "light" : "dark";
        if (next === "dark") document.documentElement.dataset.theme = "dark";
        else delete document.documentElement.dataset.theme;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // localStorage bị chặn (chế độ riêng tư…) — vẫn đổi được trong phiên này
        }
      }}
    >
      {dark ? <Sun size={16} strokeWidth={1.75} aria-hidden /> : <Moon size={16} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
