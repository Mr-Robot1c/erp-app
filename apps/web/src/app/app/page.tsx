import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLE_LABEL, canView, formatMoney, type Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { QueueCards } from "@/components/queue-cards";
import { getQueues } from "@/server/queues";
import { getKpis } from "@/server/reports";

// Tổng quan (03-chuan-giao-dien mục C): chào → thẻ việc theo bộ phận (3.6) → thẻ KPI TIỀN (lô 4.4, số từ sổ; vai xem được Kế toán mới thấy) — bấm số nào cũng
// ra danh sách/sổ nguồn. Kỳ chọn bằng `?ym=`; mặc định tháng hiện tại.
export default async function AppHome({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("role, display_name, tenant_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  const role = membership.role as Role;

  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.ym ?? "") ? (params.ym as string) : new Date().toISOString().slice(0, 7);
  const [queues, kpis] = await Promise.all([getQueues(membership.tenant_id as string), getKpis(membership.tenant_id as string, ym)]);
  const { data: tenant } = await supabase.from("tenants").select("name").maybeSingle();
  const { data: period } = await supabase.from("periods").select("status").eq("ym", ym).maybeSingle();
  const showMoney = canView(role, "acc");

  const cards: { key: string; label: string; value: string; note?: string; href: string }[] = showMoney
    ? [
        { key: "revenue", label: `Doanh thu ${ym}`, value: formatMoney(kpis.revenue), note: "chưa thuế, theo ngày giao", href: `/app/acc?view=ledger&ym=${ym}&account=511` },
        { key: "cash", label: `Tiền về ${ym}`, value: formatMoney(kpis.cashIn), note: "vào tiền mặt + ngân hàng", href: `/app/acc?view=balance&ym=${ym}` },
        { key: "ar", label: "Phải thu", value: formatMoney(kpis.receivable), href: "/app/acc?view=debt" },
        { key: "ap", label: "Phải trả", value: formatMoney(kpis.payable), href: "/app/acc?view=debt" },
        { key: "stock", label: "Giá trị tồn", value: formatMoney(kpis.stockValue), href: "/app/stock" },
        { key: "overdue", label: "Hoá đơn quá hạn", value: String(kpis.overdueCount), href: "/app/acc?view=debt" },
        { key: "tasks", label: "Việc treo", value: String(kpis.openTasks), href: "/app/tasks" },
        { key: "period", label: "Kỳ", value: ym, note: period?.status === "locked" ? "Đã khoá" : "Đang mở", href: "/app/acc?view=period" },
      ]
    : [{ key: "tasks", label: "Việc treo", value: String(kpis.openTasks), href: "/app/tasks" }];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Xin chào, {membership.display_name || user.email}</h1>
          <p className="text-sm text-[var(--ink2)]">
            {ROLE_LABEL[role] ?? role} · {tenant?.name ?? "ERP"}
          </p>
        </div>
        {showMoney && (
          <form method="get" className="flex items-center gap-2">
            <input type="month" name="ym" defaultValue={ym} className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-2.5 py-1.5 text-sm" />
            <button className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] px-3 py-1.5 text-sm">Xem kỳ</button>
          </form>
        )}
      </div>

      <div className="mt-4">
        <QueueCards queues={queues} role={role} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" id="kpi-cards">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} data-kpi={c.key} className="block rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3 hover:border-[var(--acc)]">
            <div className="text-[11px] tracking-wide text-[var(--ink2)] uppercase">{c.label}</div>
            <div className="mt-0.5 text-[22px] font-semibold tabular-nums" data-value>
              {c.value}
            </div>
            {c.note && <div className="text-[11.5px] text-[var(--ink2)]">{c.note}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
