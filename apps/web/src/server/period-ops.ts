import type { TransactionSql } from "postgres";
import { AppError, formatMoney, isBalanced, type JournalAdjustInput, type MatchReceiptInput, type PostingLine } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { postEntry } from "./journal";

const today = () => new Date().toISOString().slice(0, 10);

export type Blocker = { type: "pending_doc" | "inv_draft" | "unmatched_receipt"; docNo: string; note: string };

/** Mục chặn khoá kỳ (AC-33) — KHÔNG được đơn giản hoá làm mất nghĩa "giao dịch chờ khớp tay":
 * (a) chứng từ `pending` (chờ duyệt) có ngày trong kỳ; (b) hoá đơn bán `draft` mà đã giao trong kỳ (giao rồi mà chưa phát hành);
 * (c) phiếu thu chờ khớp tay trong kỳ = toàn bộ tiền nằm ở phân bổ "Ứng trước" và chưa được phân bổ lại vào khoản phải thu nào. */
export async function periodBlockers(s: TransactionSql, tenantId: string, ym: string): Promise<Blocker[]> {
  const pending = await s<{ doc_no: string; doc_type: string }[]>`
    select doc_no, doc_type from documents
    where tenant_id = ${tenantId} and status = 'pending' and to_char(doc_date, 'YYYY-MM') = ${ym} order by doc_no`;
  const drafts = await s<{ doc_no: string }[]>`
    select doc_no from documents
    where tenant_id = ${tenantId} and doc_type = 'INV' and status = 'draft'
      and left(coalesce(meta->>'deliverDate', to_char(doc_date, 'YYYY-MM-DD')), 7) = ${ym} order by doc_no`;
  const receipts = await s<{ doc_no: string }[]>`
    select d.doc_no from documents d
    where d.tenant_id = ${tenantId} and d.doc_type = 'RCPT' and to_char(d.doc_date, 'YYYY-MM') = ${ym}
      and exists (select 1 from receipt_allocations a where a.receipt_id = d.id and a.receivable_id is null and a.note = 'Ứng trước')
      and not exists (select 1 from receipt_allocations a where a.receipt_id = d.id and a.receivable_id is not null)
    order by d.doc_no`;
  return [
    ...pending.map((d): Blocker => ({ type: "pending_doc", docNo: d.doc_no, note: "Đang chờ duyệt" })),
    ...drafts.map((d): Blocker => ({ type: "inv_draft", docNo: d.doc_no, note: "Đã giao hàng nhưng hoá đơn chưa phát hành" })),
    ...receipts.map((d): Blocker => ({ type: "unmatched_receipt", docNo: d.doc_no, note: "Phiếu thu chờ khớp tay" })),
  ];
}

/** Khoá kỳ (lô 4.3, AC-33): còn mục chặn → `conflict` kèm `blockers`, kỳ vẫn mở. Khoá xong bất biến (app + trigger DB, không có đường mở lại). */
export async function lockPeriod(s: TransactionSql, m: Member, ym: string) {
  if (ym > today().slice(0, 7)) throw new AppError("invalid_argument", "Chưa khoá được kỳ trong tương lai");
  const [cur] = await s`select status from periods where tenant_id = ${m.tenantId} and ym = ${ym} for update`;
  if (cur?.status === "locked") throw new AppError("state_invalid", `Kỳ ${ym} đã khoá rồi`);
  const blockers = await periodBlockers(s, m.tenantId, ym);
  if (blockers.length) {
    throw new AppError("conflict", `Chưa khoá được kỳ ${ym}: còn ${blockers.length} mục cần xử lý`, { blockers });
  }
  await s`
    insert into periods (tenant_id, ym, status) values (${m.tenantId}, ${ym}, 'locked')
    on conflict (tenant_id, ym) do update set status = 'locked'`;
  await audit(s, m.tenantId, m.displayName || m.userId, "period.lock", ym);
  return { ym, status: "locked" as const };
}

/** Bút toán điều chỉnh tay (lô 4.3): gắn phiếu `ADJ` (có số, truy ngược được), MỘT bút toán cân; ghi vào kỳ khoá → period_locked + suggestedDate. */
export async function journalAdjust(s: TransactionSql, m: Member, input: JournalAdjustInput) {
  const lines: PostingLine[] = input.lines.map(([acc, d, c]) => [acc, d, c]);
  for (const [i, [acc, d, c]] of lines.entries()) {
    if ((d > 0) === (c > 0)) throw new AppError("invalid_argument", `Dòng ${i + 1} (TK ${acc}): chỉ được có Nợ HOẶC Có`);
  }
  if (!isBalanced(lines)) throw new AppError("invalid_argument", "Bút toán không cân: tổng Nợ phải bằng tổng Có");
  await assertPeriodOpen(s, m.tenantId, input.date);
  const adj = await createDocument(s, m, { docType: "ADJ", date: input.date, meta: { manual: true, memo: input.memo } });
  const entryId = await postEntry(s, m.tenantId, { date: input.date, documentId: adj.id as string, memo: input.memo, lines });
  await setStatus(s, m, adj.id as string, "confirmed", "Bút toán điều chỉnh");
  const done = await setStatus(s, m, adj.id as string, "done", input.memo);
  const total = lines.reduce((a, l) => a + l[1], 0);
  await audit(s, m.tenantId, m.displayName || m.userId, "journal.adjust", adj.doc_no as string, `${input.memo} — ${formatMoney(total)}`);
  return { ...done, entryId };
}

/** Khớp tay phiếu thu (lô 4.3 — để khoá kỳ được): xử lý phần "Ứng trước" của một phiếu thu.
 * - có `receivableId`: phân bổ phần đó vào khoản phải thu còn mở của CÙNG khách (giảm tiền ứng trước của khách);
 * - không có: xác nhận GIỮ làm tiền ứng trước (đổi ghi chú thành "Ứng trước (đã xác nhận)") — không còn nằm hàng chờ khớp. */
export async function matchReceipt(s: TransactionSql, m: Member, input: MatchReceiptInput) {
  const [rcpt] = await s`select id, doc_no, partner_id, status from documents where id = ${input.receiptId} and tenant_id = ${m.tenantId} and doc_type = 'RCPT' for update`;
  if (!rcpt) throw new AppError("not_found", "Không tìm thấy phiếu thu");
  const pending = await s<{ id: string; amount: string }[]>`
    select id, amount from receipt_allocations
    where tenant_id = ${m.tenantId} and receipt_id = ${input.receiptId} and receivable_id is null and note = 'Ứng trước' for update`;
  if (!pending.length) throw new AppError("state_invalid", "Phiếu thu này không còn khoản chờ khớp");
  const partnerId = rcpt.partner_id as string;
  await s`select 1 from partners where id = ${partnerId} and tenant_id = ${m.tenantId} for update`;
  const total = pending.reduce((a, p) => a + Number(p.amount), 0);

  if (!input.receivableId) {
    await s`update receipt_allocations set note = 'Ứng trước (đã xác nhận)' where id in ${s(pending.map((p) => p.id))}`;
    await audit(s, m.tenantId, m.displayName || m.userId, "receipt.confirm_advance", rcpt.doc_no as string, formatMoney(total));
    return { receiptId: input.receiptId, matched: 0, advance: total };
  }

  const [rec] = await s<{ id: string; amount: string; paid: string; partner_id: string }[]>`
    select id, amount, paid, partner_id from receivables where id = ${input.receivableId} and tenant_id = ${m.tenantId} for update`;
  if (!rec || rec.partner_id !== partnerId) throw new AppError("invalid_argument", "Khoản phải thu không thuộc khách của phiếu thu");
  const open = Number(rec.amount) - Number(rec.paid);
  if (open <= 0) throw new AppError("state_invalid", "Khoản phải thu này đã thu đủ");
  const use = Math.min(total, open);
  const [adv] = await s<{ amount: string }[]>`select amount from partner_advances where tenant_id = ${m.tenantId} and partner_id = ${partnerId} for update`;
  if (Number(adv?.amount ?? 0) < use) throw new AppError("state_invalid", "Tiền ứng trước của khách không đủ để khớp (đã được cấn trừ ở nơi khác)");

  await s`update partner_advances set amount = amount - ${use} where tenant_id = ${m.tenantId} and partner_id = ${partnerId}`;
  await s`update receivables set paid = paid + ${use} where id = ${rec.id}`;
  // Thu bớt phần chờ khớp (theo thứ tự) và ghi phân bổ mới "Khớp tay".
  let left = use;
  for (const p of pending) {
    if (left <= 0) break;
    const cut = Math.min(left, Number(p.amount));
    if (cut === Number(p.amount)) await s`delete from receipt_allocations where id = ${p.id}`;
    else await s`update receipt_allocations set amount = amount - ${cut} where id = ${p.id}`;
    left -= cut;
  }
  await s`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note) values (${m.tenantId}, ${input.receiptId}, ${rec.id}, ${use}, 'Khớp tay')`;
  await audit(s, m.tenantId, m.displayName || m.userId, "receipt.match", rcpt.doc_no as string, formatMoney(use));
  return { receiptId: input.receiptId, matched: use, advance: total - use };
}
