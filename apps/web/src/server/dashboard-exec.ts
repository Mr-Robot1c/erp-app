import { sql } from "./db";

export type RevenueTrend = { current: number; previous: number; deltaPct: number | null };
export type Cashflow = { receipts: number; payments: number; net: number };
export type TopCustomer = { code: string; name: string; revenue: number };
export type OverdueAr = { total: number; customerCount: number };
export type DeadStock = { value: number; skuCount: number };
export type QuoteConversion = { totalQuotes: number; convertedQuotes: number; pct: number };
export type ExecDashboard = {
  revenueTrend: RevenueTrend;
  cashflow: Cashflow;
  topCustomers: TopCustomer[];
  overdueAr: OverdueAr;
  deadStock: DeadStock;
  quoteConversion: QuoteConversion;
};

function ymInVietnam(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}`;
}

function shiftYm(ym: string, delta: number): string {
  const [year, month] = ym.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Sáu tín hiệu quản trị UI-4C. Mọi nhánh đều lọc tenant tường minh vì kết nối server bỏ qua RLS. */
export async function getExecDashboard(tenantId: string, now = new Date()): Promise<ExecDashboard> {
  const currentYm = ymInVietnam(now);
  const currentStart = `${currentYm}-01`;
  const previousStart = `${shiftYm(currentYm, -1)}-01`;
  const nextStart = `${shiftYm(currentYm, 1)}-01`;
  const threeMonthStart = `${shiftYm(currentYm, -2)}-01`;

  const [revenueRows, cashRows, customerRows, overdueRows, deadRows, quoteRows] = await Promise.all([
    sql<{ current: string; previous: string }[]>`
      select
        coalesce(sum(round(l.qty * l.price)) filter (where d.doc_date >= ${currentStart}::date and d.doc_date < ${nextStart}::date), 0) as current,
        coalesce(sum(round(l.qty * l.price)) filter (where d.doc_date >= ${previousStart}::date and d.doc_date < ${currentStart}::date), 0) as previous
      from documents d
      join document_lines l on l.tenant_id = d.tenant_id and l.document_id = d.id
      where d.tenant_id = ${tenantId} and d.doc_type = 'DO' and d.status = 'done'
        and d.doc_date >= ${previousStart}::date and d.doc_date < ${nextStart}::date`,
    sql<{ receipts: string; payments: string }[]>`
      select
        coalesce(sum((meta->>'amount')::numeric) filter (where doc_type = 'RCPT'), 0) as receipts,
        coalesce(sum((meta->>'amount')::numeric) filter (where doc_type = 'PAY'), 0) as payments
      from documents
      where tenant_id = ${tenantId} and status = 'done' and doc_type in ('RCPT', 'PAY')
        and doc_date >= ${currentStart}::date and doc_date < ${nextStart}::date`,
    sql<{ code: string; name: string; revenue: string }[]>`
      select p.code, p.name, sum(round(l.qty * l.price)) as revenue
      from documents d
      join document_lines l on l.tenant_id = d.tenant_id and l.document_id = d.id
      join partners p on p.tenant_id = d.tenant_id and p.id = d.partner_id
      where d.tenant_id = ${tenantId} and d.doc_type = 'DO' and d.status = 'done'
        and d.doc_date >= ${threeMonthStart}::date and d.doc_date < ${nextStart}::date
      group by p.id, p.code, p.name
      order by revenue desc, p.code
      limit 5`,
    sql<{ total: string; customer_count: string }[]>`
      select coalesce(sum(amount - paid), 0) as total, count(distinct partner_id)::int as customer_count
      from receivables
      where tenant_id = ${tenantId} and kind = 'invoice' and amount - paid > 0 and due_date < current_date`,
    sql<{ value: string; sku_count: string }[]>`
      with stock as (
        select item_id, sum(qty) as qty, sum(qty * unit_cost) as value
        from stock_moves where tenant_id = ${tenantId}
        group by item_id having sum(qty) > 0
      ), last_out as (
        select item_id, max(move_date) as last_out
        from stock_moves where tenant_id = ${tenantId} and qty < 0
        group by item_id
      )
      select coalesce(sum(stock.value), 0) as value, count(*)::int as sku_count
      from stock left join last_out using (item_id)
      where last_out.last_out is null or last_out.last_out < current_date - interval '90 days'`,
    sql<{ total_quotes: string; converted_quotes: string }[]>`
      select count(*)::int as total_quotes,
        count(*) filter (where exists (
          select 1 from documents so
          where so.tenant_id = q.tenant_id and so.doc_type = 'SO' and so.meta->>'quoteId' = q.id::text
        ))::int as converted_quotes
      from documents q
      where q.tenant_id = ${tenantId} and q.doc_type = 'QUOTE'
        and q.doc_date >= ${currentStart}::date and q.doc_date < ${nextStart}::date`,
  ]);

  const current = Number(revenueRows[0]?.current ?? 0);
  const previous = Number(revenueRows[0]?.previous ?? 0);
  const receipts = Number(cashRows[0]?.receipts ?? 0);
  const payments = Number(cashRows[0]?.payments ?? 0);
  const totalQuotes = Number(quoteRows[0]?.total_quotes ?? 0);
  const convertedQuotes = Number(quoteRows[0]?.converted_quotes ?? 0);

  return {
    revenueTrend: {
      current,
      previous,
      deltaPct: previous === 0 ? (current === 0 ? 0 : null) : Math.round(((current - previous) / previous) * 1000) / 10,
    },
    cashflow: { receipts, payments, net: receipts - payments },
    topCustomers: customerRows.map((r) => ({ code: r.code, name: r.name, revenue: Number(r.revenue) })),
    overdueAr: { total: Number(overdueRows[0]?.total ?? 0), customerCount: Number(overdueRows[0]?.customer_count ?? 0) },
    deadStock: { value: Number(deadRows[0]?.value ?? 0), skuCount: Number(deadRows[0]?.sku_count ?? 0) },
    quoteConversion: {
      totalQuotes,
      convertedQuotes,
      pct: totalQuotes === 0 ? 0 : Math.round((convertedQuotes / totalQuotes) * 1000) / 10,
    },
  };
}
