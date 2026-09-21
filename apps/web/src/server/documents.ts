import type { TransactionSql } from "postgres";
import { AppError, canTransition, docTax, docTotal, formatDocNo, type CreateDocumentInput, type DocStatus } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";

/** Tạo chứng từ: cấp số + insert doc + lines + history + audit — TRONG một transaction (02-D2). */
export async function createDocument(s: TransactionSql, m: Member, input: CreateDocumentInput) {
  const lines = input.lines ?? [];

  const [seq] = await s`
    insert into doc_sequences (tenant_id, doc_type, last_no)
    values (${m.tenantId}, ${input.docType}, 1)
    on conflict (tenant_id, doc_type) do update set last_no = doc_sequences.last_no + 1
    returning last_no`;
  const docNo = formatDocNo(input.docType, seq.last_no as number);
  const date = input.date ?? new Date().toISOString().slice(0, 10);

  const meta = { ...(input.meta ?? {}), totals: { total: docTotal(lines), tax: docTax(lines) } };

  const [doc] = await s`
    insert into documents (tenant_id, doc_type, doc_no, doc_date, partner_id, ext_id, meta, created_by, created_by_name)
    values (
      ${m.tenantId}, ${input.docType}, ${docNo}, ${date},
      ${input.partnerId ?? null}, ${input.extId ?? null}, ${s.json(meta as never)},
      ${m.userId}, ${m.displayName}
    )
    returning *`;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await s`
      insert into document_lines (tenant_id, document_id, line_no, item_id, qty, price, tax_pct)
      values (
        ${m.tenantId}, ${doc.id}, ${i + 1}, ${l.itemId ?? null},
        ${l.qty}, ${l.price}, ${l.taxPct ?? 10}
      )`;
  }

  await s`
    insert into doc_status_history (tenant_id, document_id, actor, from_status, to_status, note)
    values (${m.tenantId}, ${doc.id}, ${m.displayName || m.userId}, null, 'draft', '')`;

  await audit(s, m.tenantId, m.displayName || m.userId, "doc.create", docNo);

  return doc;
}

/** Chuyển trạng thái: đọc chứng từ FOR UPDATE, kiểm canTransition, ghi history + audit. */
export async function setStatus(s: TransactionSql, m: Member, docId: string, to: DocStatus, note = "") {
  const [doc] = await s`
    select * from documents where id = ${docId} and tenant_id = ${m.tenantId} for update`;
  if (!doc) throw new AppError("not_found", "Không tìm thấy chứng từ");

  const from = doc.status as DocStatus;
  if (!canTransition(from, to)) {
    throw new AppError("state_invalid", `Không thể chuyển từ ${from} sang ${to}`);
  }

  const [updated] = await s`
    update documents set status = ${to} where id = ${docId} and tenant_id = ${m.tenantId} returning *`;

  await s`
    insert into doc_status_history (tenant_id, document_id, actor, from_status, to_status, note)
    values (${m.tenantId}, ${docId}, ${m.displayName || m.userId}, ${from}, ${to}, ${note})`;

  await audit(s, m.tenantId, m.displayName || m.userId, "doc.set_status", doc.doc_no as string, `${from} -> ${to}`);

  return updated;
}

/** Kỳ khoá chặn ghi (lô 4.3, AC-32): ngày rơi vào kỳ đã khoá → `period_locked` kèm `suggestedDate` = ngày 1 của kỳ MỞ sớm nhất
 * sau ngày đó (và `suggestedPeriod` dạng YYYY-MM) để người dùng ghi lại vào kỳ đó. */
export async function assertPeriodOpen(s: TransactionSql, tenantId: string, date: string) {
  const ym = date.slice(0, 7);
  const [period] = await s`select status from periods where tenant_id = ${tenantId} and ym = ${ym}`;
  if (period?.status !== "locked") return;
  const locked = new Set((await s<{ ym: string }[]>`select ym from periods where tenant_id = ${tenantId} and status = 'locked'`).map((r) => r.ym));
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7));
  do {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  } while (locked.has(`${y}-${String(m).padStart(2, "0")}`));
  const suggestedPeriod = `${y}-${String(m).padStart(2, "0")}`;
  throw new AppError("period_locked", `Kỳ ${ym} đã khoá — ghi vào kỳ ${suggestedPeriod}`, { suggestedDate: `${suggestedPeriod}-01`, suggestedPeriod });
}
