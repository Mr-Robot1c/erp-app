"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, ROLE_LABEL, type Role } from "@erp/core";

type Member = { user_id: string; role: Role; display_name: string };
type Invite = { id: string; email: string; role: Role; status: string };

const VI_ERR: Record<string, string> = {
  duplicate: "Email này đã được mời rồi.",
  state_invalid: "Không thể bỏ quản trị viên cuối cùng của doanh nghiệp.",
  not_found: "Không tìm thấy thành viên.",
  invalid_argument: "Thông tin chưa hợp lệ.",
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function TeamManager({
  members,
  invites,
  currentUserId,
}: {
  members: Member[];
  invites: Invite[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function refresh() {
    router.refresh();
  }

  async function invite() {
    setBusy(true);
    setMsg("");
    const json = await post("/api/team/invite", { email, role });
    setBusy(false);
    if (!json.ok) {
      setMsg(VI_ERR[json.error.code] ?? json.error.message);
      return;
    }
    setEmail("");
    refresh();
  }

  async function changeRole(userId: string, newRole: Role) {
    setMsg("");
    const json = await post("/api/team/set-role", { userId, role: newRole });
    if (!json.ok) {
      setMsg(VI_ERR[json.error.code] ?? json.error.message);
      return;
    }
    refresh();
  }

  async function remove(userId: string) {
    setMsg("");
    const json = await post("/api/team/remove", { userId });
    if (!json.ok) {
      setMsg(VI_ERR[json.error.code] ?? json.error.message);
      return;
    }
    refresh();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold">Thành viên & vai</h1>
      {msg && <p className="mt-2 text-sm text-[var(--bad)]">{msg}</p>}

      <section className="mt-4 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4" id="team-members">
        <h2 className="text-[11.5px] font-semibold tracking-wide text-[var(--ink2)] uppercase">
          Thành viên ({members.length})
        </h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {members.map((mm) => (
              <tr key={mm.user_id} className="border-b border-[var(--line)] last:border-b-0" data-user-id={mm.user_id}>
                <td className="py-2">{mm.display_name}</td>
                <td className="py-2">
                  <select
                    value={mm.role}
                    onChange={(e) => void changeRole(mm.user_id, e.target.value as Role)}
                    className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-2 py-1"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  {mm.user_id !== currentUserId && (
                    <button
                      className="text-[var(--bad)] hover:underline"
                      onClick={() => void remove(mm.user_id)}
                    >
                      Xoá
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-4 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4" id="team-invites">
        <h2 className="text-[11.5px] font-semibold tracking-wide text-[var(--ink2)] uppercase">
          Lời mời đang chờ ({invites.length})
        </h2>
        <ul className="mt-2 text-sm">
          {invites.map((inv) => (
            <li key={inv.id}>
              {inv.email} — {ROLE_LABEL[inv.role]}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4">
        <h2 className="text-[11.5px] font-semibold tracking-wide text-[var(--ink2)] uppercase">Mời người mới</h2>
        <form
          className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void invite();
          }}
        >
          <label className="flex-1 text-sm">
            Email
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-2"
            />
          </label>
          <label className="text-sm">
            Vai
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <button
            id="btn-invite"
            type="submit"
            disabled={busy}
            className="rounded-[var(--r)] bg-[var(--acc)] px-3 py-2 font-medium text-white disabled:opacity-50"
          >
            Gửi lời mời
          </button>
        </form>
      </section>
    </div>
  );
}
