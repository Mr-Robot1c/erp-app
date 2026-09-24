"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, type Role } from "@erp/core";
import type { TaskRow } from "@/server/tasks";
import { DocDetail, type DocRow } from "./doc-detail";
import { StatusPill, statusLabelOf } from "./doc-ui";

const VI_ERR: Record<string, string> = {
  state_invalid: "Chứng từ không còn ở trạng thái chờ duyệt.",
  forbidden: "Chưa tới lượt duyệt của bạn, hoặc bạn chính là người lập.",
  invalid_argument: "Cần nhập lý do từ chối.",
  not_found: "Không tìm thấy chứng từ.",
};

const SALES_TYPES = new Set(["QUOTE", "SO", "DO", "INV", "RCPT"]);
const BUY_TYPES = new Set(["PR", "PO", "GRN", "VINV", "PAY"]);

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

/** Việc cần làm (UX-1, 03 mục C3). Mặc định chỉ việc CỦA VAI MÌNH; chip "Cả công ty" chỉ admin/giám đốc (việc vai khác chỉ-đọc, không nút).
 * Cả dòng bấm được → mở chứng từ liên quan trong modal chi tiết; Duyệt/Từ chối chỉ hiện khi đúng lượt của vai mình. */
export function TasksBoard({
  tasks,
  myRole,
  scope,
  canSeeAll,
  myCount,
  allCount,
  docs,
  partners,
  items,
}: {
  tasks: TaskRow[];
  myRole: Role;
  userId: string;
  scope: "mine" | "all";
  canSeeAll: boolean;
  myCount: number;
  allCount: number | null;
  docs: DocRow[];
  partners: { id: string; name: string }[];
  items: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function decide(task: TaskRow, decision: "approve" | "reject") {
    if (decision === "reject" && !reason.trim()) {
      setMsg("Cần nhập lý do từ chối.");
      return;
    }
    setBusyId(task.id);
    setMsg("");
    const json = await post("/api/approvals/decide", {
      docId: task.documentId,
      decision,
      reason: decision === "reject" ? reason.trim() : undefined,
    });
    setBusyId(null);
    if (!json.ok) {
      setMsg(VI_ERR[json.error.code] ?? json.error.message);
      return;
    }
    setRejectingId(null);
    setReason("");
    router.refresh();
  }

  const openDoc = docs.find((d) => d.id === openId) ?? null;
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${active ? "border-[var(--acc-fill)] bg-[var(--acc-fill)] text-white" : "border-[var(--line)] bg-[var(--sf)]"}`;

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold">Việc cần làm</h1>
      <p className="text-sm text-[var(--ink2)]" id="tasks-sub">
        {scope === "all" ? "Toàn cảnh cả công ty (chỉ xem)" : `Việc của ${ROLE_LABEL[myRole] ?? myRole}`}
      </p>

      {canSeeAll && (
        <div className="mt-3 flex flex-wrap gap-2" id="task-chips">
          <Link href="/app/tasks" className={chip(scope === "mine")} data-chip="mine">
            Của tôi ({myCount})
          </Link>
          <Link href="/app/tasks?scope=all" className={chip(scope === "all")} data-chip="all">
            Cả công ty{allCount !== null ? ` (${allCount})` : ""}
          </Link>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-[var(--bad)]">{msg}</p>}
      {tasks.length === 0 && (
        <p className="mt-4 text-sm text-[var(--ink2)]" id="tasks-empty">
          Không có việc nào đang chờ bạn.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-2" id="task-list">
        {tasks.map((t) => {
          const doc = t.documentId ? docs.find((d) => d.id === t.documentId) : undefined;
          return (
            <li key={t.id} className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]" data-task-id={t.id} data-task-role={t.role} data-doc-no={t.doc?.docNo ?? ""}>
              <div className="flex items-stretch">
                {doc ? (
                  <button type="button" className="flex flex-1 cursor-pointer items-center gap-2 p-3 text-left hover:bg-[var(--lane)]" onClick={() => setOpenId(doc.id)}>
                    <span className="flex-1">
                      {scope === "all" && <span className="pill pending mr-2">{ROLE_LABEL[t.role] ?? t.role}</span>}
                      {t.text}
                    </span>
                    <span aria-hidden className="text-lg text-[var(--ink2)]">
                      ›
                    </span>
                  </button>
                ) : (
                  <div className="flex-1 p-3">
                    {scope === "all" && <span className="pill pending mr-2">{ROLE_LABEL[t.role] ?? t.role}</span>}
                    {t.text}
                  </div>
                )}
                {t.canAct && (
                  <div className="flex shrink-0 items-center gap-2 pr-3">
                    <button
                      className="rounded-[var(--r)] bg-[var(--ok)] px-2.5 py-1 text-sm text-white disabled:opacity-50"
                      disabled={busyId === t.id}
                      onClick={() => void decide(t, "approve")}
                    >
                      Duyệt
                    </button>
                    <button
                      className="rounded-[var(--r)] border border-[var(--line)] px-2.5 py-1 text-sm text-[var(--bad)] disabled:opacity-50"
                      disabled={busyId === t.id}
                      onClick={() => setRejectingId(rejectingId === t.id ? null : t.id)}
                    >
                      Từ chối
                    </button>
                  </div>
                )}
              </div>
              {rejectingId === t.id && (
                <div className="flex gap-2 border-t border-[var(--line)] p-3">
                  <input
                    type="text"
                    placeholder="Lý do từ chối"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="flex-1 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-2 py-1 text-sm"
                  />
                  <button
                    className="rounded-[var(--r)] bg-[var(--bad)] px-2.5 py-1 text-sm text-white disabled:opacity-50"
                    disabled={busyId === t.id}
                    onClick={() => void decide(t, "reject")}
                  >
                    Xác nhận từ chối
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {openDoc && (
        <DocDetail
          key={openDoc.id}
          doc={openDoc}
          partnerName={(id) => partners.find((p) => p.id === id)?.name ?? "—"}
          itemName={(id) => items.find((i) => i.id === id)?.name ?? "—"}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
          actions={(d) => {
            const href = SALES_TYPES.has(d.doc_type) ? `/app/sales?open=${encodeURIComponent(d.doc_no)}` : BUY_TYPES.has(d.doc_type) ? `/app/buy?open=${encodeURIComponent(d.doc_no)}` : null;
            return (
              <div className="flex items-center gap-3">
                <StatusPill status={d.status} label={statusLabelOf(d)} />
                {href && (
                  <Link href={href} className="text-sm text-[var(--acc)] underline-offset-2 hover:underline" id="task-open-module">
                    Mở ở màn nghiệp vụ để xử lý
                  </Link>
                )}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
