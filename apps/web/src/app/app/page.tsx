import { redirect } from "next/navigation";
import { ROLE_LABEL, canView, type Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { QueueCardsClient } from "@/components/queue-cards-client";
import { KpiCardsClient } from "@/components/kpi-cards-client";
import { DashboardCharts } from "@/components/dashboard-charts";

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
  const { data: tenant } = await supabase.from("tenants").select("name").maybeSingle();
  const { data: period } = await supabase.from("periods").select("status").eq("ym", ym).maybeSingle();
  const showMoney = canView(role, "acc");

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
        <QueueCardsClient role={role} />
      </div>

      <KpiCardsClient ym={ym} showMoney={showMoney} periodLocked={period?.status === "locked"} />

      <DashboardCharts showMoney={showMoney} />
    </div>
  );
}
