import { sql } from "./db";

export type Kpis = {
  ym: string;
  /** Doanh thu kỳ = Σ (Có − Nợ) TK 511, CHƯA thuế; ghi theo NGÀY GIAO (entry_date của bút toán doanh thu) — đúng R20/AC-34. */
  revenue: number;
  /** Tiền về trong kỳ = Σ Nợ TK 111 + 112. */
  cashIn: number;
  receivable: number;
  payable: number;
  stockValue: number;
  overdueCount: number;
  openTasks: number;
};

/** Số liệu điều hành (lô 4.4) — MỘT câu SQL đếm phía server, tính từ sổ (v_journal) và sổ phụ; đơn huỷ không có bút toán nên không tính. */
export async function getKpis(tenantId: string, ym: string): Promise<Kpis> {
  const [r] = await sql<Record<string, string>[]>`
    select
      (select coalesce(sum(credit - debit), 0) from v_journal where tenant_id = ${tenantId} and ym = ${ym} and account_code = '511') as revenue,
      (select coalesce(sum(debit), 0) from v_journal where tenant_id = ${tenantId} and ym = ${ym} and account_code in ('111', '112')) as cash_in,
      (select coalesce(sum(amount - paid), 0) from receivables where tenant_id = ${tenantId} and kind = 'invoice') as receivable,
      (select coalesce(sum(amount - paid), 0) from payables where tenant_id = ${tenantId}) as payable,
      (select coalesce(sum(qty * unit_cost), 0) from stock_moves where tenant_id = ${tenantId}) as stock_value,
      (select count(*) from receivables where tenant_id = ${tenantId} and kind = 'invoice' and overdue and amount - paid > 0) as overdue_count,
      (select count(*) from tasks where tenant_id = ${tenantId} and not done) as open_tasks`;
  return {
    ym,
    revenue: Number(r.revenue),
    cashIn: Number(r.cash_in),
    receivable: Number(r.receivable),
    payable: Number(r.payable),
    stockValue: Number(r.stock_value),
    overdueCount: Number(r.overdue_count),
    openTasks: Number(r.open_tasks),
  };
}
