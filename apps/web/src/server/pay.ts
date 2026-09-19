import type { TransactionSql } from "postgres";
import { AppError, approvalTaskText, formatMoney, postPayment, type ApprovalEntry, type PayInput } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { postEntry } from "./journal";
import { chiefChain } from "./vinv";

const today = () => new Date().toISOString().slice(0, 10);

/** Trả tiền nhà cung cấp (lô 3.4, AC-24). Vượt tổng nợ → invalid_argument. Số tiền > ngưỡng (`poThreshold`) → phiếu chi `pending`
 * chờ kế toán trưởng (người lập là kế toán trưởng thì lên giám đốc), CHI THẬT khi duyệt (hook `afterConfirm['PAY']`);
 * ≤ ngưỡng → chi ngay. Chi = phân bổ vào khoản phải trả theo hạn tăng dần + bút toán Nợ 331 / Có 111|112. */
export async function paySupplier(s: TransactionSql, m: Member, input: PayInput) {
  const date = input.date ?? today();
  await assertPeriodOpen(s, m.tenantId, date);
  const [partner] = await s`select id from partners where id = ${input.supplierId} and tenant_id = ${m.tenantId} for update`;
  if (!partner) throw new AppError("not_found", "Không tìm thấy nhà cung cấp");

  const [{ open }] = await s<{ open: string }[]>`
    select coalesce(sum(amount - paid), 0) as open from payables where tenant_id = ${m.tenantId} and partner_id = ${input.supplierId}`;
  if (input.amount > Number(open)) {
    throw new AppError("invalid_argument", `Số tiền ${formatMoney(input.amount)} vượt tổng nợ phải trả ${formatMoney(Number(open))}`);
  }
  if (input.bankRef) {
    const dup = await s`select 1 from bank_txns where tenant_id = ${m.tenantId} and bank_ref = ${input.bankRef}`;
    if (dup.length) throw new AppError("duplicate", `Giao dịch ngân hàng ${input.bankRef} đã ghi một lần rồi`);
  }

  const [t] = await s<{ settings: unknown }[]>`select settings from tenants where id = ${m.tenantId}`;
  const threshold = Number(asObj<{ poThreshold?: number }>(t.settings).poThreshold ?? 20_000_000);

  const pay = await createDocument(s, m, {
    docType: "PAY",
    date,
    partnerId: input.supplierId,
    meta: { amount: input.amount, method: input.method, bankRef: input.bankRef ?? null, date },
  });
  const payId = pay.id as string;

  if (input.amount > threshold) {
    const chain = chiefChain(m.role);
    const approvals: ApprovalEntry[] = [];
    await s`update documents set meta = meta || ${s.json({ chain, approvals } as never)} where id = ${payId} and tenant_id = ${m.tenantId}`;
    const pending = await setStatus(s, m, payId, "pending", "Vượt ngưỡng duyệt chi");
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, ${chain[0]}, ${approvalTaskText("PAY", pending.doc_no as string)}, ${payId})`;
    await audit(s, m.tenantId, m.displayName || m.userId, "pay.pending", pending.doc_no as string, formatMoney(input.amount));
    return pending;
  }
  return executePayment(s, m, payId);
}

/** Chi thật cho một phiếu chi (`draft` — chi ngay, hoặc `confirmed` — sau khi duyệt). */
export async function executePayment(s: TransactionSql, m: Member, payId: string) {
  const [pay] = await s`select * from documents where id = ${payId} and tenant_id = ${m.tenantId} and doc_type = 'PAY' for update`;
  if (!pay) throw new AppError("not_found", "Không tìm thấy phiếu chi");
  if (!["draft", "confirmed"].includes(pay.status as string)) throw new AppError("state_invalid", "Phiếu chi không ở trạng thái chờ chi");
  const meta = asObj<{ amount: number; method: "bank" | "cash"; bankRef: string | null; date: string }>(pay.meta);
  const date = meta.date; // doc_date từ DB là Date, không phải chuỗi — ngày ghi sổ lấy từ meta
  await assertPeriodOpen(s, m.tenantId, date);
  await s`select 1 from partners where id = ${pay.partner_id as string} and tenant_id = ${m.tenantId} for update`;

  if (meta.bankRef) {
    const dup = await s`select 1 from bank_txns where tenant_id = ${m.tenantId} and bank_ref = ${meta.bankRef}`;
    if (dup.length) throw new AppError("duplicate", `Giao dịch ngân hàng ${meta.bankRef} đã ghi một lần rồi`);
    await s`insert into bank_txns (tenant_id, bank_ref, receipt_id) values (${m.tenantId}, ${meta.bankRef}, ${payId})`;
  }

  const open = await s<{ id: string; amount: string; paid: string }[]>`
    select id, amount, paid from payables
    where tenant_id = ${m.tenantId} and partner_id = ${pay.partner_id as string} and amount - paid > 0
    order by due_date asc nulls last, created_at for update`;
  let left = meta.amount;
  for (const p of open) {
    if (left <= 0) break;
    const use = Math.min(left, Number(p.amount) - Number(p.paid));
    await s`update payables set paid = paid + ${use} where id = ${p.id}`;
    await s`insert into payment_allocations (tenant_id, payment_id, payable_id, amount, note) values (${m.tenantId}, ${payId}, ${p.id}, ${use}, 'Hoá đơn mua')`;
    left -= use;
  }
  if (left > 0) throw new AppError("state_invalid", "Công nợ phải trả đã thay đổi, không đủ để chi — lập lại phiếu chi");

  await postEntry(s, m.tenantId, { date, documentId: payId, memo: `Chi tiền ${pay.doc_no as string}`, lines: postPayment(meta.amount, meta.method) });
  if (pay.status === "draft") await setStatus(s, m, payId, "confirmed", "");
  const done = await setStatus(s, m, payId, "done", meta.bankRef ? `Giao dịch ${meta.bankRef}` : "Đã chi");
  await s`update tasks set done = true where document_id = ${payId} and tenant_id = ${m.tenantId} and not done`;
  await audit(s, m.tenantId, m.displayName || m.userId, "pay.execute", pay.doc_no as string, formatMoney(meta.amount));
  return done;
}
