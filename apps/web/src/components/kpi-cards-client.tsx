"use client";
import Link from "next/link";
import { formatMoney } from "@erp/core";
import { useCachedFetch } from "@/lib/use-cached-fetch";
import type { Kpis } from "@/server/reports";

async function fetchSummary(ym: string): Promise<Kpis> {
  const res = await fetch("/api/dashboard/summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ym }) });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "Không lấy được số liệu");
  return body.data as Kpis;
}

// CB-1.7b: tách khỏi trang Tổng quan để trang render ngay không đợi getKpis(); dữ liệu lấy qua
// /api/dashboard/summary, cache 30s (use-cached-fetch.ts) — đổi kỳ (`ym`) đổi key nên luôn đúng kỳ.
export function KpiCardsClient({ ym, showMoney, periodLocked }: { ym: string; showMoney: boolean; periodLocked: boolean }) {
  const { data: kpis } = useCachedFetch(`dashboard:summary:${ym}`, () => fetchSummary(ym));

  if (!kpis) {
    const cols = showMoney ? 8 : 1;
    return (
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-[70px] animate-pulse rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]" />
        ))}
      </div>
    );
  }

  const cards: { key: string; label: string; value: string; note?: string; href: string }[] = showMoney
    ? [
        { key: "revenue", label: `Doanh thu ${ym}`, value: formatMoney(kpis.revenue), note: "chưa thuế, theo ngày giao", href: `/app/acc?view=ledger&ym=${ym}&account=511` },
        { key: "cash", label: `Tiền về ${ym}`, value: formatMoney(kpis.cashIn), note: "vào tiền mặt + ngân hàng", href: `/app/acc?view=balance&ym=${ym}` },
        { key: "ar", label: "Phải thu", value: formatMoney(kpis.receivable), href: "/app/acc?view=debt" },
        { key: "ap", label: "Phải trả", value: formatMoney(kpis.payable), href: "/app/acc?view=debt" },
        { key: "stock", label: "Giá trị tồn", value: formatMoney(kpis.stockValue), href: "/app/stock" },
        { key: "overdue", label: "Hoá đơn quá hạn", value: String(kpis.overdueCount), href: "/app/acc?view=debt" },
        { key: "tasks", label: "Việc treo", value: String(kpis.openTasks), href: "/app/tasks" },
        { key: "period", label: "Kỳ", value: ym, note: periodLocked ? "Đã khoá" : "Đang mở", href: "/app/acc?view=period" },
      ]
    : [{ key: "tasks", label: "Việc treo", value: String(kpis.openTasks), href: "/app/tasks" }];

  // Chấm trạng thái (03 mục I.6) CHỈ khi có ngưỡng rõ: quá hạn > 0 → đỏ; việc treo > 10 → cam. Không bịa "mục tiêu".
  const dotOf = (key: string): { tone: "bad" | "warn"; title: string } | null =>
    key === "overdue" && kpis.overdueCount > 0
      ? { tone: "bad", title: "Có hoá đơn quá hạn" }
      : key === "tasks" && kpis.openTasks > 10
        ? { tone: "warn", title: "Việc treo nhiều (hơn 10)" }
        : null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" id="kpi-cards">
      {cards.map((c) => {
        const dot = dotOf(c.key);
        return (
        <Link key={c.key} href={c.href} data-kpi={c.key} className="relative block rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3 hover:border-[var(--acc)]">
          {dot && <span data-kpi-dot={dot.tone} title={dot.title} className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full" style={{ background: `var(--${dot.tone})` }} />}
          <div className="text-[11px] tracking-wide text-[var(--ink2)] uppercase">{c.label}</div>
          <div className="mt-0.5 text-[22px] font-semibold tabular-nums" data-value>
            {c.value}
          </div>
          {c.note && <div className="text-[11.5px] text-[var(--ink2)]">{c.note}</div>}
        </Link>
        );
      })}
    </div>
  );
}
