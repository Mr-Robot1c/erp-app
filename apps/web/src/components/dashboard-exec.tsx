"use client";
import { formatMoney } from "@erp/core";
import { useCachedFetch } from "@/lib/use-cached-fetch";
import type { ExecDashboard } from "@/server/dashboard-exec";

async function fetchExecDashboard(): Promise<ExecDashboard> {
  const res = await fetch("/api/dashboard/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "Không lấy được bức tranh quản trị");
  return body.data as ExecDashboard;
}

function Dot({ tone, label }: { tone: "ok" | "warn" | "bad"; label: string }) {
  return <span className="absolute top-3 right-3 h-2 w-2 rounded-full" style={{ background: `var(--${tone})` }} title={label} aria-label={label} />;
}

function Card({ label, dot, children }: { label: string; dot?: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="relative min-w-0 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4">
      {dot}
      <h3 className="pr-4 text-[11px] font-semibold tracking-wide text-[var(--ink2)] uppercase">{label}</h3>
      {children}
    </article>
  );
}

const valueClass = "mt-1 text-[24px] font-semibold tabular-nums";
const noteClass = "mt-1 text-[12px] text-[var(--ink2)]";

/** UI-4C: 6 tín hiệu quyết định dành riêng cho admin/director; cache client 30s theo khuôn CB-1.7b. */
export function DashboardExec() {
  const { data } = useCachedFetch("dashboard:exec", fetchExecDashboard);

  if (!data) {
    return (
      <section className="mt-4" aria-label="Bức tranh quản trị đang tải">
        <h2 className="text-base font-semibold">Bức tranh quản trị</h2>
        <div className="mt-3 grid gap-3 exec-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]" />
          ))}
        </div>
      </section>
    );
  }

  const delta = data.revenueTrend.deltaPct;
  const deltaTone = delta === null || delta === 0 ? null : delta > 0 ? "ok" : "bad";
  const pct = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(data.quoteConversion.pct);

  return (
    <section className="mt-4" id="dashboard-exec">
      <h2 className="text-base font-semibold">Bức tranh quản trị</h2>
      <div className="mt-3 grid gap-3 exec-grid">
        <Card label="Doanh thu tháng" dot={deltaTone ? <Dot tone={deltaTone} label={delta! > 0 ? "Doanh thu tăng" : "Doanh thu giảm"} /> : undefined}>
          <div className={valueClass}>{formatMoney(data.revenueTrend.current)}</div>
          <p className={noteClass}>
            Tháng trước {formatMoney(data.revenueTrend.previous)} ·{" "}
            <span className={deltaTone === "ok" ? "text-[var(--ok)]" : deltaTone === "bad" ? "text-[var(--bad)]" : undefined}>
              {delta === null ? "chưa có nền so sánh" : `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} ${Math.abs(delta).toLocaleString("vi-VN")}%`}
            </span>
          </p>
        </Card>

        <Card label="Dòng tiền tháng">
          <div className={valueClass}>{formatMoney(data.cashflow.net)}</div>
          <p className={noteClass}>Thu {formatMoney(data.cashflow.receipts)} · Chi {formatMoney(data.cashflow.payments)}</p>
        </Card>

        <Card label="Top khách 3 tháng">
          <div className={valueClass}>{data.topCustomers.length} khách</div>
          {data.topCustomers.length ? (
            <ol className="mt-2 space-y-1 text-[12px]">
              {data.topCustomers.map((customer) => (
                <li key={customer.code} className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate" title={`${customer.code} · ${customer.name}`}>{customer.code} · {customer.name}</span>
                  <span className="shrink-0 tabular-nums text-[var(--ink2)]">{formatMoney(customer.revenue)}</span>
                </li>
              ))}
            </ol>
          ) : <p className={noteClass}>Chưa có doanh thu giao hàng</p>}
        </Card>

        <Card label="Phải thu quá hạn" dot={data.overdueAr.total > 0 ? <Dot tone="bad" label="Có công nợ quá hạn" /> : undefined}>
          <div className={valueClass}>{formatMoney(data.overdueAr.total)}</div>
          <p className={noteClass}>{data.overdueAr.customerCount} khách quá hạn</p>
        </Card>

        <Card label="Tồn chậm 90+ ngày" dot={data.deadStock.value > 0 ? <Dot tone="warn" label="Có tồn chậm" /> : undefined}>
          <div className={valueClass}>{formatMoney(data.deadStock.value)}</div>
          <p className={noteClass}>{data.deadStock.skuCount} SKU không xuất trên 90 ngày</p>
        </Card>

        <Card label="Chuyển đổi BG tháng">
          <div className={valueClass}>{pct}%</div>
          <p className={noteClass}>{data.quoteConversion.convertedQuotes}/{data.quoteConversion.totalQuotes} báo giá đã chuyển đơn</p>
        </Card>
      </div>
    </section>
  );
}
