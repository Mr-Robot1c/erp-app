"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DOC_LABEL, formatMoney, type DocType } from "@erp/core";
import { useCachedFetch } from "@/lib/use-cached-fetch";
import type { Charts, ChartMonths } from "@/server/dashboard-charts";

async function fetchCharts(months: ChartMonths): Promise<Charts> {
  const res = await fetch("/api/dashboard/charts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ months }) });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "Không lấy được số liệu");
  return body.data as Charts;
}

// Màu theo pill trạng thái (03 mục D) — CHỈ dùng biến CSS để dark mode ăn theo, không hardcode hex.
const SERIES = [
  { key: "draft", label: "Nháp", color: "var(--ink2)" },
  { key: "pending", label: "Chờ duyệt", color: "var(--warn)" },
  { key: "confirmed", label: "Đã xác nhận", color: "var(--acc)" },
  { key: "done", label: "Hoàn tất", color: "var(--ok)" },
  { key: "cancelled", label: "Đã huỷ", color: "var(--bad)" },
] as const;

const TYPE_ORDER: DocType[] = ["QUOTE", "SO", "DO", "INV", "RCPT", "PR", "PO", "GRN", "VINV", "PAY"];

const tooltipStyle = { background: "var(--sf)", border: "1px solid var(--line)", borderRadius: "var(--r)", color: "var(--ink)", fontSize: 12 };
const axisTick = { fill: "var(--ink2)", fontSize: 11 };

function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)} tỷ`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)} tr`;
  if (a >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(v);
}

function Card({ title, right, children, id }: { title: string; right?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <section id={id} className="rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Hai biểu đồ dưới thẻ KPI (03 mục I.5): chứng từ theo loại × trạng thái (toggle 1/3/6 tháng, mặc định 3) + doanh thu 6 tháng (chỉ khi xem được Kế toán). */
export function DashboardCharts({ showMoney }: { showMoney: boolean }) {
  const [months, setMonths] = useState<ChartMonths>(3);
  const { data } = useCachedFetch(`dashboard:charts:${months}`, () => fetchCharts(months));

  const docRows = data
    ? TYPE_ORDER.map((t) => {
        const row: Record<string, string | number> = { name: DOC_LABEL[t].name };
        let total = 0;
        for (const d of data.docs) {
          if (d.docType !== t) continue;
          const key = d.status === "partial" ? "confirmed" : d.status;
          row[key] = ((row[key] as number) ?? 0) + d.count;
          total += d.count;
        }
        row.total = total;
        return row;
      }).filter((r) => (r.total as number) > 0)
    : [];

  const toggle = (
    <div className="flex gap-1" id="chart-months">
      {([1, 3, 6] as const).map((m) => (
        <button
          key={m}
          type="button"
          data-months={m}
          onClick={() => setMonths(m)}
          className={`rounded-full border px-2.5 py-0.5 text-[12px] ${months === m ? "border-[var(--acc)] bg-[var(--acc)] text-white" : "border-[var(--line)] bg-[var(--sf)]"}`}
        >
          {m} tháng
        </button>
      ))}
    </div>
  );

  return (
    <div className={`mt-4 grid gap-3 ${showMoney ? "lg:grid-cols-2" : ""}`}>
      <Card id="chart-docs" title="Chứng từ theo loại và trạng thái" right={toggle}>
        <div className="h-64">
          {!data ? (
            <div className="h-full animate-pulse rounded-[var(--r)] bg-[var(--lane)]" />
          ) : docRows.length === 0 ? (
            <p className="pt-6 text-center text-sm text-[var(--ink2)]">Chưa có chứng từ nào trong kỳ.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={docRows} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval={0} angle={-30} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--lane)" }} />
                {SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="docs" fill={s.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-[var(--ink2)]">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      </Card>

      {showMoney && (
        <Card id="chart-revenue" title="Doanh thu 6 tháng (chưa thuế)">
          <div className="h-64">
            {!data || !data.revenue ? (
              <div className="h-full animate-pulse rounded-[var(--r)] bg-[var(--lane)]" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenue} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="ym" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                  <YAxis tickFormatter={compact} tick={axisTick} tickLine={false} axisLine={false} width={52} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--lane)" }} formatter={(v) => [formatMoney(Number(v)), "Doanh thu"]} />
                  <Bar dataKey="value" name="Doanh thu" fill="var(--acc)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
