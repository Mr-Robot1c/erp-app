import { redirect } from "next/navigation";
import { ROLE_LABEL, type Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { QueueCards } from "@/components/queue-cards";
import { getQueues } from "@/server/queues";

// Tổng quan — bản GĐ1 tối thiểu (lô 1.4, playbook/03-chuan-giao-dien.md mục C): chào + 4 thẻ đếm.
// Hàng nút hành động nhanh / Việc cần làm / Hoạt động gần đây nâng dần ở các lô sau khi có nghiệp vụ.
export default async function AppHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("role, display_name, tenant_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const queues = await getQueues(membership.tenant_id as string);
  const { data: tenant } = await supabase.from("tenants").select("name").maybeSingle();

  const [{ count: memberCount }, { count: docCount }, { count: taskCount }] = await Promise.all([
    supabase.from("memberships").select("*", { count: "exact", head: true }),
    supabase.from("documents").select("*", { count: "exact", head: true }),
    supabase.from("tasks").select("*", { count: "exact", head: true }).eq("done", false),
  ]);

  const ym = new Date().toISOString().slice(0, 7);
  const { data: period } = await supabase.from("periods").select("status").eq("ym", ym).maybeSingle();
  const periodLabel = period?.status === "locked" ? "Đã khoá" : "Đang mở";

  const cards = [
    { label: "Thành viên", value: memberCount ?? 0 },
    { label: "Chứng từ", value: docCount ?? 0 },
    { label: "Việc treo", value: taskCount ?? 0 },
    { label: "Kỳ hiện tại", value: ym, note: periodLabel },
  ];

  return (
    <div>
      <h1 className="text-lg font-semibold">Xin chào, {membership.display_name || user.email}</h1>
      <p className="text-sm text-[var(--ink2)]">
        {ROLE_LABEL[membership.role as Role] ?? membership.role} · {tenant?.name ?? "ERP"}
      </p>

      <div className="mt-4">
        <QueueCards queues={queues} role={membership.role as Role} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3">
            <div className="text-[11px] tracking-wide text-[var(--ink2)] uppercase">{c.label}</div>
            <div className="mt-0.5 text-[22px] font-semibold tabular-nums">{c.value}</div>
            {c.note && <div className="text-[11.5px] text-[var(--ink2)]">{c.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
