"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABEL, type Role } from "@erp/core";

type Task = { id: string; role: Role; text: string; document_id: string | null; created_at: string };

const VI_ERR: Record<string, string> = {
  state_invalid: "Chứng từ không còn ở trạng thái chờ duyệt.",
  forbidden: "Chưa tới lượt duyệt của bạn, hoặc bạn chính là người lập.",
  invalid_argument: "Cần nhập lý do từ chối.",
  not_found: "Không tìm thấy chứng từ.",
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function TasksBoard({ tasks, myRole }: { tasks: Task[]; myRole: Role }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.role] = (acc[t.role] ?? 0) + 1;
    return acc;
  }, {});

  async function decide(task: Task, decision: "approve" | "reject") {
    if (decision === "reject" && !reason.trim()) {
      setMsg("Cần nhập lý do từ chối.");
      return;
    }
    setBusyId(task.id);
    setMsg("");
    const json = await post("/api/approvals/decide", {
      docId: task.document_id,
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold">Việc cần làm</h1>

      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(counts).map(([role, n]) => (
          <span key={role} className="pill pending">
            {ROLE_LABEL[role as Role] ?? role} ({n})
          </span>
        ))}
        {tasks.length === 0 && <span className="text-sm text-[var(--ink2)]">Không có việc nào đang chờ.</span>}
      </div>

      {msg && <p className="mt-3 text-sm text-[var(--bad)]">{msg}</p>}

      <ul className="mt-4 flex flex-col gap-2" id="task-list">
        {tasks.map((t) => {
          const canDecide = myRole === "admin" || myRole === t.role;
          return (
            <li key={t.id} className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3" data-task-id={t.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="pill pending mr-2">{ROLE_LABEL[t.role] ?? t.role}</span>
                  {t.text}
                </div>
                {canDecide && (
                  <div className="flex shrink-0 gap-2">
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
                <div className="mt-2 flex gap-2">
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
    </div>
  );
}
