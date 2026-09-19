import type { TransactionSql } from "postgres";
import {
  AppError,
  QUOTE_VALID_DAYS,
  addDays,
  approvalTaskText,
  quoteBelowList,
  type ApprovalEntry,
  type QuoteInput,
  type Role,
} from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { createDocument, setStatus } from "./documents";
import { afterConfirm } from "./hooks";
import { asObj } from "./json";

const today = () => new Date().toISOString().slice(0, 10);

/** Tạo báo giá nháp (lô 2.1). meta.listPrices = giá bảng từng dòng tại thời điểm lập (AC-06). */
export async function createQuote(s: TransactionSql, m: Member, input: QuoteInput) {
  const [partner] = await s`select kind from partners where id = ${input.partnerId} and tenant_id = ${m.tenantId}`;
  if (!partner) throw new AppError("not_found", "Không tìm thấy khách hàng");
  if (partner.kind === "supplier") throw new AppError("invalid_argument", "Đối tác này là nhà cung cấp, không phải khách hàng");

  const ids = [...new Set(input.lines.map((l) => l.itemId))];
  const items = await s<{ id: string; price: string }[]>`
    select id, price from items where tenant_id = ${m.tenantId} and id in ${s(ids)}`;
  if (items.length !== ids.length) throw new AppError("not_found", "Có mặt hàng không tồn tại");
  const listOf = new Map(items.map((i) => [i.id, Number(i.price)]));

  const date = today();
  return createDocument(s, m, {
    docType: "QUOTE",
    date,
    partnerId: input.partnerId,
    extId: input.extId ?? null,
    lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, taxPct: 10 })),
    meta: { validTo: addDays(date, QUOTE_VALID_DAYS), listPrices: input.lines.map((l) => listOf.get(l.itemId)!) },
  });
}

/** Xác nhận/gửi báo giá — port demo confirmQuote. Có dòng giá < giá bảng -> chờ trưởng kinh doanh (AC-06). */
export async function confirmQuote(s: TransactionSql, m: Member, quoteId: string) {
  const [doc] = await s`
    select * from documents where id = ${quoteId} and tenant_id = ${m.tenantId} and doc_type = 'QUOTE' for update`;
  if (!doc) throw new AppError("not_found", "Không tìm thấy báo giá");
  if (doc.status !== "draft") throw new AppError("state_invalid", "Báo giá không ở trạng thái nháp");

  const meta = asObj<{ listPrices: number[] }>(doc.meta);
  const lines = await s<{ price: string }[]>`
    select price from document_lines where document_id = ${quoteId} and tenant_id = ${m.tenantId} order by line_no`;
  if (!lines.length) throw new AppError("state_invalid", "Báo giá chưa có dòng");

  const below = quoteBelowList(lines.map((l) => ({ price: Number(l.price) })), meta.listPrices);
  const chain: Role[] = below ? (["sales_lead"] as Role[]).filter((r) => r !== m.role) : [];

  if (!below || chain.length === 0) {
    const confirmed = await setStatus(s, m, quoteId, "confirmed", below ? "Trưởng kinh doanh tự lập, bỏ cấp tự duyệt" : "");
    await afterConfirm(s, m, confirmed);
    return confirmed;
  }

  const approvals: ApprovalEntry[] = [];
  await s`update documents set meta = meta || ${s.json({ chain, approvals } as never)} where id = ${quoteId} and tenant_id = ${m.tenantId}`;
  const pending = await setStatus(s, m, quoteId, "pending", "Giá thấp hơn bảng giá, chờ Trưởng kinh doanh");
  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, ${chain[0]}, ${approvalTaskText("QUOTE", pending.doc_no as string)}, ${quoteId})`;
  await audit(s, m.tenantId, m.displayName || m.userId, "quote.pending", pending.doc_no as string, "giá thấp hơn bảng giá");
  return pending;
}

/** Quét báo giá `confirmed` quá hạn -> `cancelled` "Hết hạn" (AC-07). Gọi tay/CI nightly, chưa cần cron. */
export async function expireQuotes(s: TransactionSql, m: Member) {
  const rows = await s<{ id: string }[]>`
    select id from documents
    where tenant_id = ${m.tenantId} and doc_type = 'QUOTE' and status = 'confirmed'
      and (meta->>'validTo') < ${today()}`;
  for (const r of rows) await setStatus(s, m, r.id, "cancelled", "Hết hạn");
  return { expired: rows.length };
}
