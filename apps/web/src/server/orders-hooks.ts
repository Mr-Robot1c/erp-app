import type { TransactionSql } from "postgres";
import { docTax, docTotal, formatMoney } from "@erp/core";
import type { Member } from "./auth";
import { fulfil } from "./fulfil";
import { asObj } from "./json";

/** Việc sau khi đơn bán `confirmed` (lô 2.2, AC-08): chốt tổng, tạo khoản CỌC (không phải phải thu hoá đơn),
 * giao việc cho kho "Đáp ứng đơn". Giữ tồn / sinh yêu cầu mua-lệnh SX: `fulfil` (lô 2.3). */
export async function orderAfterConfirm(s: TransactionSql, m: Member, so: Record<string, unknown>) {
  const orderId = so.id as string;
  const docNo = so.doc_no as string;
  const meta = asObj<{ depositPct?: number }>(so.meta);

  const lines = await s<{ qty: string; price: string; tax_pct: string }[]>`
    select qty, price, tax_pct from document_lines where document_id = ${orderId} and tenant_id = ${m.tenantId}`;
  const mapped = lines.map((l) => ({ qty: Number(l.qty), price: Number(l.price), taxPct: Number(l.tax_pct) }));
  const net = docTotal(mapped);
  const tax = docTax(mapped);
  const total = net + tax;
  await s`update documents set meta = meta || ${s.json({ net, tax, total } as never)} where id = ${orderId} and tenant_id = ${m.tenantId}`;

  const pct = Number(meta.depositPct ?? 0);
  if (pct > 0) {
    const deposit = Math.round((total * pct) / 100);
    await s`
      insert into receivables (tenant_id, kind, document_id, partner_id, amount)
      values (${m.tenantId}, 'deposit', ${orderId}, ${so.partner_id as string}, ${deposit})`;
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, 'accountant', ${`Thu cọc ${formatMoney(deposit)} cho ${docNo}`}, ${orderId})`;
  }

  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, 'warehouse', ${`Đáp ứng đơn ${docNo}`}, ${orderId})`;

  await fulfil(s, m, orderId); // giữ tồn phần có sẵn; thiếu thì tự sinh yêu cầu mua / lệnh sản xuất (lô 2.3, AC-10)
}
