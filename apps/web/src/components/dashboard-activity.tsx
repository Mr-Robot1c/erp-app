"use client";
import Link from "next/link";
import { DOC_LABEL, type DocStatus, type DocType } from "@erp/core";
import { useCachedFetch } from "@/lib/use-cached-fetch";
import { docHref } from "@/lib/doc-links";
import { relTime } from "@/lib/format-time";
import type { Activity } from "@/server/activity";
import { StatusPill, statusLabelOf } from "./doc-ui";

async function fetchActivity(): Promise<Activity> {
  const res = await fetch("/api/dashboard/activity", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "Không lấy được số liệu");
  return body.data as Activity;
}

const pillOf = (docType: string, status: string, deliveredAll: boolean) => (
  <StatusPill status={status as DocStatus} label={statusLabelOf({ doc_type: docType, status: status as DocStatus, meta: { deliveredAll } })} />
);

function DocNo({ docType, docNo }: { docType: string; docNo: string }) {
  const href = docHref(docType, docNo);
  return href ? (
    <Link href={href} className="font-mono text-[var(--acc)] hover:underline">
      {docNo}
    </Link>
  ) : (
    <span className="font-mono">{docNo}</span>
  );
}

function Skeleton() {
  return <div className="h-40 animate-pulse rounded-[var(--r)] bg-[var(--lane)]" />;
}

/** Hai khối cuối Tổng quan (UI-3): "Hoạt động gần đây" (audit_log tenant, 10 dòng) + "Chứng từ tôi lập đang xử lý" (≤5). Cache 30s khuôn CB-1.7b. */
export function DashboardActivity() {
  const { data } = useCachedFetch("dashboard:activity", fetchActivity);
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <section id="activity-feed" className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3">
        <h2 className="mb-2 text-[13px] font-semibold">Hoạt động gần đây</h2>
        {!data ? (
          <Skeleton />
        ) : data.activity.length === 0 ? (
          <p className="text-sm text-[var(--ink2)]">Chưa có hoạt động nào.</p>
        ) : (
          <ul className="text-[12.5px]">
            {data.activity.map((a) => (
              <li key={a.id} data-activity className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t border-[var(--line)] py-1.5 first:border-t-0">
                <b className="font-medium">{a.actor || "Hệ thống"}</b>
                <span className="text-[var(--ink2)]">{a.label}</span>
                {a.ref && (a.doc ? <DocNo docType={a.doc.docType} docNo={a.ref} /> : <span className="font-mono">{a.ref}</span>)}
                {a.doc && pillOf(a.doc.docType, a.doc.status, a.doc.deliveredAll)}
                <span className="ml-auto text-[var(--ink2)]" suppressHydrationWarning>
                  {relTime(a.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="my-docs" className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3">
        <h2 className="mb-2 text-[13px] font-semibold">Chứng từ tôi lập đang xử lý</h2>
        {!data ? (
          <Skeleton />
        ) : data.mine.length === 0 ? (
          <p className="text-sm text-[var(--ink2)]">Không có chứng từ nào đang xử lý.</p>
        ) : (
          <ul className="text-[12.5px]">
            {data.mine.map((d) => (
              <li key={d.docNo} data-my-doc className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t border-[var(--line)] py-1.5 first:border-t-0">
                <DocNo docType={d.docType} docNo={d.docNo} />
                <span className="text-[var(--ink2)]">{DOC_LABEL[d.docType as DocType]?.name ?? d.docType}</span>
                {pillOf(d.docType, d.status, d.deliveredAll)}
                {d.waitingFor && <span className="ml-auto text-[var(--ink2)]">đang chờ {d.waitingFor}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
