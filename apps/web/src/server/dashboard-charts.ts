import { sql } from "./db";

export type ChartMonths = 1 | 3 | 6;
export type DocChartRow = { docType: string; status: string; count: number };
export type RevenuePoint = { ym: string; value: number };
export type Charts = { months: ChartMonths; docs: DocChartRow[]; revenue: RevenuePoint[] | null };

/** 6 kỳ gần nhất tính tới tháng hiện tại (cũ → mới), dạng YYYY-MM. */
export function lastYms(n: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

/** Dữ liệu 2 biểu đồ Tổng quan (UI-2 I.5): (a) đếm chứng từ theo loại × trạng thái trong `months` tháng gần nhất (theo ngày chứng từ);
 * (b) doanh thu 6 tháng = Σ (Có − Nợ) TK 511 từ sổ, chưa thuế — CÙNG công thức thẻ KPI. Doanh thu là số tiền nên chỉ trả khi
 * `withMoney` (vai xem được Kế toán); vai khác nhận null. Lọc tenant tường minh (kết nối server bỏ qua RLS). */
export async function getCharts(tenantId: string, months: ChartMonths, withMoney: boolean): Promise<Charts> {
  const from = `${lastYms(months)[0]}-01`;
  const docRows = await sql<{ doc_type: string; status: string; n: string }[]>`
    select doc_type, status, count(*) as n from documents
    where tenant_id = ${tenantId} and doc_date >= ${from}::date and doc_type not in ('ADJ', 'EXP', 'MO')
    group by doc_type, status`;
  const docs = docRows.map((r) => ({ docType: r.doc_type, status: r.status, count: Number(r.n) }));

  let revenue: RevenuePoint[] | null = null;
  if (withMoney) {
    const yms = lastYms(6);
    const revRows = await sql<{ ym: string; v: string }[]>`
      select ym, coalesce(sum(credit - debit), 0) as v from v_journal
      where tenant_id = ${tenantId} and account_code = '511' and ym in ${sql(yms)}
      group by ym`;
    const by = new Map(revRows.map((r) => [r.ym, Number(r.v)]));
    revenue = yms.map((ym) => ({ ym, value: by.get(ym) ?? 0 }));
  }
  return { months, docs, revenue };
}
