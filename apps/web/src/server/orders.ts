import type { TransactionSql } from "postgres";
import {
  AppError,
  approvalTaskText,
  exceedsCreditLimit,
  type ApprovalEntry,
  type QuoteToOrderInput,
  type Role,
} from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { createDocument, setStatus } from "./documents";
import { afterConfirm } from "./hooks";
import { asObj } from "./json";

const today = () => new Date().toISOString().slice(0, 10);

/** Chuyển báo giá hợp lệ thành đơn bán nháp (lô 2.2) — port demo quoteToOrder. Hết hiệu lực -> state_invalid (AC-07). */
export async function quoteToOrder(s: TransactionSql, m: Member, input: QuoteToOrderInput) {
  const [q] = await s`
    select * from documents where id = ${input.quoteId} and tenant_id = ${m.tenantId} and doc_type = 'QUOTE' for update`;
  if (!q) throw new AppError("not_found", "Không tìm thấy báo giá");
  if (q.status !== "confirmed") throw new AppError("state_invalid", "Báo giá chưa hợp lệ hoặc đã hết hạn/đã chuyển đơn");
  const qmeta = asObj<{ validTo: string }>(q.meta);
  if (qmeta.validTo < today()) throw new AppError("state_invalid", "Báo giá đã hết hiệu lực");

  const lines = await s<{ item_id: string; qty: string; price: string; tax_pct: string }[]>`
    select item_id, qty, price, tax_pct from document_lines
    where document_id = ${q.id as string} and tenant_id = ${m.tenantId} order by line_no`;

  const so = await createDocument(s, m, {
    docType: "SO",
    partnerId: q.partner_id as string,
    extId: (q.ext_id as string | null) ?? null,
    lines: lines.map((l) => ({ itemId: l.item_id, qty: Number(l.qty), price: Number(l.price), taxPct: Number(l.tax_pct) })),
    meta: { terms: input.terms, depositPct: input.depositPct, quoteId: q.id, quoteNo: q.doc_no },
  });

  const qrefs = asObj<string[]>(q.refs ?? []);
  await s`update documents set refs = ${s.json([q.doc_no as string] as never)} where id = ${so.id as string} and tenant_id = ${m.tenantId}`;
  await s`update documents set refs = ${s.json([...qrefs, so.doc_no as string] as never)} where id = ${q.id as string} and tenant_id = ${m.tenantId}`;
  await setStatus(s, m, q.id as string, "done", `Đã thành ${so.doc_no as string}`);
  await audit(s, m.tenantId, m.displayName || m.userId, "order.create", so.doc_no as string, `từ ${q.doc_no as string}`);
  return so;
}

/** Dư nợ phải thu (hoá đơn chưa trả) + tổng chưa thuế các đơn công nợ đang mở của khách. */
async function creditNumbers(s: TransactionSql, tenantId: string, partnerId: string) {
  const [ar] = await s<{ v: string }[]>`
    select coalesce(sum(amount - paid), 0) as v from receivables
    where tenant_id = ${tenantId} and partner_id = ${partnerId} and kind = 'invoice'`;
  const [open] = await s<{ v: string }[]>`
    select coalesce(sum(round(l.qty * l.price)), 0) as v
    from documents d join document_lines l on l.document_id = d.id
    where d.tenant_id = ${tenantId} and d.partner_id = ${partnerId} and d.doc_type = 'SO'
      and d.status in ('confirmed', 'partial') and d.meta->>'terms' = 'credit'`;
  const [od] = await s<{ n: string }[]>`
    select count(*) as n from receivables
    where tenant_id = ${tenantId} and partner_id = ${partnerId} and kind = 'invoice'
      and amount - paid > 0 and due_date < ${today()}`;
  return { receivable: Number(ar.v), openOrdersNet: Number(open.v), overdue: Number(od.n) > 0 };
}

/** Xác nhận đơn bán — port demo confirmOrder. Đơn công nợ vượt hạn mức / có nợ quá hạn -> chờ kế toán trưởng (AC-09).
 * Khoá dòng khách hàng đầu giao dịch: 2 người xác nhận cùng lúc cho cùng khách phải tuần tự (không lách hạn mức). */
export async function confirmOrder(s: TransactionSql, m: Member, orderId: string) {
  const [so] = await s`
    select * from documents where id = ${orderId} and tenant_id = ${m.tenantId} and doc_type = 'SO' for update`;
  if (!so) throw new AppError("not_found", "Không tìm thấy đơn bán");
  if (so.status !== "draft") throw new AppError("state_invalid", "Đơn không ở trạng thái nháp");
  const meta = asObj<{ terms: string }>(so.meta);

  let needsApproval = false;
  if (meta.terms === "credit") {
    const [p] = await s<{ credit_limit: string }[]>`
      select credit_limit from partners where id = ${so.partner_id as string} and tenant_id = ${m.tenantId} for update`;
    const c = await creditNumbers(s, m.tenantId, so.partner_id as string);
    const [{ net }] = await s<{ net: string }[]>`
      select coalesce(sum(round(qty * price)), 0) as net from document_lines where document_id = ${orderId} and tenant_id = ${m.tenantId}`;
    needsApproval =
      c.overdue ||
      exceedsCreditLimit({ receivable: c.receivable, openOrdersNet: c.openOrdersNet, orderNet: Number(net), limit: Number(p.credit_limit) });
  }

  const chain: Role[] = needsApproval ? (["chief_accountant"] as Role[]).filter((r) => r !== m.role) : [];
  if (!needsApproval || chain.length === 0) {
    const confirmed = await setStatus(s, m, orderId, "confirmed", needsApproval ? "Kế toán trưởng tự lập, bỏ cấp tự duyệt" : "");
    await afterConfirm(s, m, confirmed);
    return confirmed;
  }

  const approvals: ApprovalEntry[] = [];
  await s`update documents set meta = meta || ${s.json({ chain, approvals, note: "Vượt hạn mức hoặc có nợ quá hạn" } as never)}
          where id = ${orderId} and tenant_id = ${m.tenantId}`;
  const pending = await setStatus(s, m, orderId, "pending", "Vượt hạn mức hoặc có nợ quá hạn");
  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, ${chain[0]}, ${approvalTaskText("SO", pending.doc_no as string)}, ${orderId})`;
  await audit(s, m.tenantId, m.displayName || m.userId, "order.pending", pending.doc_no as string, "chờ duyệt công nợ");
  return pending;
}
