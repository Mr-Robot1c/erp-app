import type { TransactionSql } from "postgres";
import {
  AppError,
  addDays,
  docTax,
  docTotal,
  formatMoney,
  postInvoice,
  postReceipt,
  type IssueInvoiceInput,
  type ReceiptInput,
} from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { postEntry } from "./journal";

const today = () => new Date().toISOString().slice(0, 10);

/** Hoàn thành đơn (port demo checkComplete): đã giao đủ + mọi hoá đơn của đơn đã phát hành và thu đủ -> `done`. */
async function checkComplete(s: TransactionSql, m: Member, soId: string) {
  const [so] = await s`select status, meta from documents where id = ${soId} and tenant_id = ${m.tenantId} for update`;
  if (!so || !["confirmed", "partial"].includes(so.status as string)) return;
  if (!asObj<{ deliveredAll?: boolean }>(so.meta).deliveredAll) return;

  const invs = await s<{ status: string; open: string }[]>`
    select d.status, coalesce(r.amount - r.paid, 0) as open
    from documents d left join receivables r on r.document_id = d.id and r.kind = 'invoice'
    where d.tenant_id = ${m.tenantId} and d.doc_type = 'INV' and d.meta->>'soId' = ${soId}`;
  if (!invs.length || invs.some((i) => i.status !== "done" || Number(i.open) > 0)) return;

  await setStatus(s, m, soId, "done", "Đã giao đủ và thu đủ");
  await s`update tasks set done = true where document_id = ${soId} and tenant_id = ${m.tenantId} and not done`;
}

/** Phát hành hoá đơn (lô 2.5, AC-15) — port demo issueInvoice. **Ngày ghi doanh thu = NGÀY GIAO** (meta.deliverDate của
 * hoá đơn sinh từ phiếu xuất), KHÔNG phải ngày bấm phát hành — khớp AC-34 "doanh thu theo ngày giao"; kỳ giao đã khoá →
 * period_locked. `date` chỉ dùng tính hạn thanh toán. Cấn trừ: cọc đã thu của đơn, rồi tiền ứng trước của khách. */
export async function issueInvoice(s: TransactionSql, m: Member, input: IssueInvoiceInput) {
  const [inv] = await s`
    select * from documents where id = ${input.invoiceId} and tenant_id = ${m.tenantId} and doc_type = 'INV' for update`;
  if (!inv) throw new AppError("not_found", "Không tìm thấy hoá đơn");
  if (inv.status !== "draft") throw new AppError("state_invalid", "Hoá đơn đã phát hành");
  const meta = asObj<{ soId?: string; deliverDate?: string }>(inv.meta);
  const deliverDate = meta.deliverDate ?? (inv.doc_date as string);
  await assertPeriodOpen(s, m.tenantId, deliverDate);

  const lines = await s<{ qty: string; price: string; tax_pct: string }[]>`
    select qty, price, tax_pct from document_lines where document_id = ${input.invoiceId} and tenant_id = ${m.tenantId}`;
  const mapped = lines.map((l) => ({ qty: Number(l.qty), price: Number(l.price), taxPct: Number(l.tax_pct) }));
  const net = docTotal(mapped);
  const tax = docTax(mapped);
  const total = net + tax;

  let termDays = 0;
  if (meta.soId) {
    const [so] = await s`select meta from documents where id = ${meta.soId} and tenant_id = ${m.tenantId}`;
    if (asObj<{ terms?: string }>(so?.meta ?? {}).terms === "credit") {
      const [t] = await s<{ settings: unknown }[]>`select settings from tenants where id = ${m.tenantId}`;
      termDays = Number(asObj<{ terms?: number }>(t.settings).terms ?? 30);
    }
  }
  const issueDate = input.date ?? today();
  const due = addDays(issueDate, termDays);
  const invNo = inv.doc_no as string;

  await postEntry(s, m.tenantId, { date: deliverDate, documentId: input.invoiceId, memo: `Doanh thu ${invNo}`, lines: postInvoice(net, tax) });
  const [rec] = await s<{ id: string }[]>`
    insert into receivables (tenant_id, kind, document_id, partner_id, amount, due_date)
    values (${m.tenantId}, 'invoice', ${input.invoiceId}, ${inv.partner_id as string}, ${total}, ${due}) returning id`;

  // Cấn trừ: (1) cọc đã thu của đơn chưa dùng, (2) tiền ứng trước của khách.
  let applied = 0;
  if (meta.soId) {
    const deps = await s<{ id: string; paid: string; used: string }[]>`
      select r.id, r.paid,
             coalesce((select sum(a.amount) from receipt_allocations a where a.receivable_id = r.id and a.note = 'Cấn trừ cọc'), 0) as used
      from receivables r where r.tenant_id = ${m.tenantId} and r.kind = 'deposit' and r.document_id = ${meta.soId} for update`;
    for (const d of deps) {
      const use = Math.min(Number(d.paid) - Number(d.used), total - applied);
      if (use <= 0) continue;
      await s`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note)
              values (${m.tenantId}, ${input.invoiceId}, ${d.id}, ${use}, 'Cấn trừ cọc')`;
      applied += use;
    }
  }
  const [adv] = await s<{ amount: string }[]>`
    select amount from partner_advances where tenant_id = ${m.tenantId} and partner_id = ${inv.partner_id as string} for update`;
  const useAdv = Math.min(Number(adv?.amount ?? 0), total - applied);
  if (useAdv > 0) {
    await s`update partner_advances set amount = amount - ${useAdv} where tenant_id = ${m.tenantId} and partner_id = ${inv.partner_id as string}`;
    await s`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note)
            values (${m.tenantId}, ${input.invoiceId}, ${rec.id}, ${useAdv}, 'Cấn trừ ứng trước')`;
    applied += useAdv;
  }
  if (applied > 0) await s`update receivables set paid = ${applied} where id = ${rec.id}`;

  await s`update documents set meta = meta || ${s.json({ net, tax, total, due, issueDate, advApplied: applied } as never)} where id = ${input.invoiceId} and tenant_id = ${m.tenantId}`;
  await setStatus(s, m, input.invoiceId, "confirmed", "Phát hành hoá đơn");
  const done = await setStatus(s, m, input.invoiceId, "done", "Đã phát hành");
  await s`update tasks set done = true where document_id = ${input.invoiceId} and tenant_id = ${m.tenantId} and not done`;
  await audit(s, m.tenantId, m.displayName || m.userId, "invoice.issue", invNo, `doanh thu ${formatMoney(net)}, thuế ${formatMoney(tax)}`);
  if (meta.soId) await checkComplete(s, m, meta.soId);
  return done;
}

/** Ghi thu tiền (lô 2.5, AC-17/18) — port demo `receive`: mã giao dịch ngân hàng ghi MỘT lần (trùng → duplicate);
 * phân bổ vào khoản phải thu mở (cọc trước, rồi theo hạn tăng dần); dư → tiền ứng trước; bút toán 111|112/131. */
export async function recordReceipt(s: TransactionSql, m: Member, input: ReceiptInput) {
  const date = input.date ?? today();
  await assertPeriodOpen(s, m.tenantId, date);
  const [partner] = await s`select id from partners where id = ${input.partnerId} and tenant_id = ${m.tenantId} for update`;
  if (!partner) throw new AppError("not_found", "Không tìm thấy khách hàng");

  if (input.bankRef) {
    const dup = await s`select 1 from bank_txns where tenant_id = ${m.tenantId} and bank_ref = ${input.bankRef}`;
    if (dup.length) throw new AppError("duplicate", `Giao dịch ngân hàng ${input.bankRef} đã ghi thu một lần rồi`);
  }

  const rcpt = await createDocument(s, m, {
    docType: "RCPT",
    date,
    partnerId: input.partnerId,
    meta: { amount: input.amount, method: input.method, bankRef: input.bankRef ?? null },
  });
  const rid = rcpt.id as string;
  if (input.bankRef) await s`insert into bank_txns (tenant_id, bank_ref, receipt_id) values (${m.tenantId}, ${input.bankRef}, ${rid})`;

  const open = await s<{ id: string; kind: string; document_id: string | null; amount: string; paid: string }[]>`
    select id, kind, document_id, amount, paid from receivables
    where tenant_id = ${m.tenantId} and partner_id = ${input.partnerId} and amount - paid > 0
    order by (kind = 'deposit') desc, due_date asc nulls last, created_at
    for update`;
  let left = input.amount;
  const touchedInvoices = new Set<string>();
  for (const r of open) {
    if (left <= 0) break;
    const use = Math.min(left, Number(r.amount) - Number(r.paid));
    await s`update receivables set paid = paid + ${use} where id = ${r.id}`;
    await s`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note)
            values (${m.tenantId}, ${rid}, ${r.id}, ${use}, ${r.kind === "deposit" ? "Cọc" : "Hoá đơn"})`;
    left -= use;
    if (r.kind === "deposit" && r.document_id && Number(r.paid) + use >= Number(r.amount)) {
      await s`update documents set meta = meta || ${s.json({ depositPaid: true } as never)} where id = ${r.document_id} and tenant_id = ${m.tenantId}`;
      await s`update tasks set done = true where document_id = ${r.document_id} and tenant_id = ${m.tenantId} and role = 'accountant' and text like 'Thu cọc%' and not done`;
    }
    if (r.kind === "invoice" && r.document_id) touchedInvoices.add(r.document_id);
  }
  if (left > 0) {
    await s`
      insert into partner_advances (tenant_id, partner_id, amount) values (${m.tenantId}, ${input.partnerId}, ${left})
      on conflict (tenant_id, partner_id) do update set amount = partner_advances.amount + excluded.amount`;
    await s`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note)
            values (${m.tenantId}, ${rid}, null, ${left}, 'Ứng trước')`;
  }

  await postEntry(s, m.tenantId, { date, documentId: rid, memo: `Thu tiền ${rcpt.doc_no as string}`, lines: postReceipt(input.amount, input.method) });
  await setStatus(s, m, rid, "confirmed", "");
  const done = await setStatus(s, m, rid, "done", input.bankRef ? `Giao dịch ${input.bankRef}` : "");

  for (const invId of touchedInvoices) {
    const [d] = await s`select meta from documents where id = ${invId} and tenant_id = ${m.tenantId}`;
    const soId = asObj<{ soId?: string }>(d?.meta ?? {}).soId;
    if (soId) await checkComplete(s, m, soId);
  }
  await audit(s, m.tenantId, m.displayName || m.userId, "receipt.create", rcpt.doc_no as string, formatMoney(input.amount));
  return done;
}
