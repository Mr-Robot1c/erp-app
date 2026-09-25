"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DOC_LABEL, type DocStatus, type DocType } from "@erp/core";
import { StatusPill, statusLabelOf } from "./doc-ui";
import { docHref } from "@/lib/doc-links";
import type { SearchHit } from "@/server/search";

function hrefOf(h: SearchHit): string {
  return docHref(h.docType, h.docNo) ?? "/app/stock";
}

/** Ô tìm chứng từ toàn cục giữa header (03 mục I.3): số chứng từ hoặc tên đối tác → ≤8 kết quả → bấm mở chi tiết. */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/search/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: term }) });
        const body = await res.json();
        if (mine === seq.current) setHits(body.ok ? (body.data.hits as SearchHit[]) : []);
      } catch {
        if (mine === seq.current) setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim() ? hits : null;

  return (
    <div className="relative w-full max-w-md">
      <label className="flex items-center gap-2 rounded-[var(--r)] border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-sm">
        <Search size={15} className="text-[var(--ink2)]" aria-hidden />
        <input
          id="global-search"
          type="search"
          autoComplete="off"
          placeholder="Tìm số chứng từ, đối tác…"
          className="w-full bg-transparent outline-none placeholder:text-[var(--ink2)]"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        />
      </label>
      {open && shown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul id="global-search-results" className="absolute right-0 left-0 z-20 mt-1.5 max-h-96 overflow-y-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] py-1 shadow-lg">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-[var(--ink2)]">Không tìm thấy chứng từ nào.</li>}
            {shown.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  data-hit={h.docNo}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--lane)]"
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    router.push(hrefOf(h));
                  }}
                >
                  <span className="font-mono text-[var(--acc)]">{h.docNo}</span>
                  <span className="text-[var(--ink2)]">{DOC_LABEL[h.docType as DocType]?.name ?? h.docType}</span>
                  <span className="flex-1 truncate">{h.partnerName ?? ""}</span>
                  <StatusPill status={h.status as DocStatus} label={statusLabelOf({ doc_type: h.docType, status: h.status as DocStatus, meta: { deliveredAll: h.deliveredAll } })} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
