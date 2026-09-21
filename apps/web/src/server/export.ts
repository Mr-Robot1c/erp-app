import ExcelJS from "exceljs";
import { AppError } from "@erp/core";
import { sql } from "./db";

export type ReportKind = "gl" | "balance" | "ar";

const MONEY = '#,##0;[Red]-#,##0';

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

/** Xuất báo cáo ra Excel (lô 4.4, AC-34): `gl` sổ cái theo kỳ, `balance` số dư tài khoản theo kỳ, `ar` công nợ phải thu còn mở kèm tuổi nợ.
 * Dữ liệu lấy từ CÙNG nguồn với màn hình (v_journal, receivables) nên số khớp từng đồng. Trả buffer xlsx. */
export async function buildReport(tenantId: string, report: ReportKind, period: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";

  if (report === "gl") {
    const ws = sheet(wb, `Sổ cái ${period}`, [
      { header: "Ngày", key: "date", width: 12 },
      { header: "Số chứng từ", key: "doc", width: 16 },
      { header: "Diễn giải", key: "memo", width: 44 },
      { header: "Tài khoản", key: "acc", width: 11 },
      { header: "Nợ", key: "debit", width: 16, money: true },
      { header: "Có", key: "credit", width: 16, money: true },
    ]);
    const rows = await sql<{ d: string; doc_no: string | null; memo: string; account_code: string; debit: string; credit: string }[]>`
      select to_char(entry_date, 'YYYY-MM-DD') as d, doc_no, memo, account_code, debit, credit
      from v_journal where tenant_id = ${tenantId} and ym = ${period} order by entry_date, line_id`;
    let td = 0;
    let tc = 0;
    for (const r of rows) {
      ws.addRow({ date: r.d, doc: r.doc_no ?? "", memo: r.memo, acc: r.account_code, debit: Number(r.debit) || null, credit: Number(r.credit) || null });
      td += Number(r.debit);
      tc += Number(r.credit);
    }
    const total = ws.addRow({ memo: "Cộng", debit: td, credit: tc });
    total.font = { bold: true };
  } else if (report === "balance") {
    const ws = sheet(wb, `Số dư TK ${period}`, [
      { header: "Tài khoản", key: "acc", width: 12 },
      { header: "Tên tài khoản", key: "name", width: 34 },
      { header: "Dư đầu kỳ", key: "open", width: 18, money: true },
      { header: "Phát sinh Nợ", key: "debit", width: 18, money: true },
      { header: "Phát sinh Có", key: "credit", width: 18, money: true },
      { header: "Dư cuối kỳ", key: "close", width: 18, money: true },
    ]);
    const rows = await sql<{ account_code: string; name: string | null; open: string; debit: string; credit: string }[]>`
      select b.account_code, a.name,
             coalesce(sum(b.balance) filter (where b.ym < ${period}), 0) as open,
             coalesce(sum(b.debit) filter (where b.ym = ${period}), 0) as debit,
             coalesce(sum(b.credit) filter (where b.ym = ${period}), 0) as credit
      from v_account_balance b
      left join accounts a on a.tenant_id = b.tenant_id and a.code = b.account_code
      where b.tenant_id = ${tenantId} and b.ym <= ${period}
      group by b.account_code, a.name order by b.account_code`;
    for (const r of rows) {
      ws.addRow({ acc: r.account_code, name: r.name ?? "", open: Number(r.open), debit: Number(r.debit), credit: Number(r.credit), close: Number(r.open) + Number(r.debit) - Number(r.credit) });
    }
  } else if (report === "ar") {
    const ws = sheet(wb, "Công nợ phải thu", [
      { header: "Khách hàng", key: "partner", width: 30 },
      { header: "Chứng từ", key: "doc", width: 16 },
      { header: "Hạn thanh toán", key: "due", width: 15 },
      { header: "Số ngày quá hạn", key: "days", width: 16 },
      { header: "Còn phải thu", key: "open", width: 18, money: true },
    ]);
    const rows = await sql<{ partner: string; doc_no: string | null; due: string | null; days: number | null; open: string }[]>`
      select p.name as partner, d.doc_no, to_char(r.due_date, 'YYYY-MM-DD') as due,
             case when r.due_date is null then null else greatest(current_date - r.due_date, 0) end as days,
             (r.amount - r.paid) as open
      from receivables r
      join partners p on p.id = r.partner_id and p.tenant_id = r.tenant_id
      left join documents d on d.id = r.document_id and d.tenant_id = r.tenant_id
      where r.tenant_id = ${tenantId} and r.kind = 'invoice' and r.amount - r.paid > 0
      order by p.name, r.due_date nulls first`;
    let total = 0;
    for (const r of rows) {
      ws.addRow({ partner: r.partner, doc: r.doc_no ?? "Số dư đầu kỳ", due: r.due ?? "", days: r.days ?? "", open: Number(r.open) });
      total += Number(r.open);
    }
    const t = ws.addRow({ partner: "Cộng", open: total });
    t.font = { bold: true };
  } else {
    throw new AppError("invalid_argument", "Loại báo cáo không hợp lệ");
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
