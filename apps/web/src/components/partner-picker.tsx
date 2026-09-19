"use client";
import { useState } from "react";
import { inputCls } from "./doc-ui";

export type PartnerOption = { id: string; code: string; name: string };

/** Ô chọn đối tác gõ-để-tìm theo tên/mã (03-chuan-giao-dien mục F). */
export function PartnerPicker({
  partners,
  value,
  onChange,
  label,
}: {
  partners: PartnerOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const selected = partners.find((p) => p.id === value);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = q.trim().toLowerCase();
  const matches = partners
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))
    .slice(0, 8);

  return (
    <div className="relative">
      <label className="mb-0.5 block text-[11.5px] text-[var(--ink2)]">{label}</label>
      <input
        id="partner-picker"
        className={inputCls}
        placeholder="Gõ tên hoặc mã để tìm…"
        value={open ? q : selected ? `${selected.name} (${selected.code})` : q}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] shadow-md">
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-[var(--ink2)]">Không tìm thấy</li>}
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--lane)]"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                {p.name} <span className="font-mono text-[11.5px] text-[var(--ink2)]">{p.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
