import type { TransactionSql } from "postgres";
import { AppError, isBalanced, type PostingLine } from "@erp/core";

/** Ghi bút toán (lô 2.4) — quy tắc hạch toán ở packages/core `posting.ts`. Kiểm cân ở code TRƯỚC (lỗi rõ ràng);
 * trigger DB deferred `entry_balanced` vẫn là hàng rào cuối lúc COMMIT. Dòng 0/0 (vd thuế 0) bị bỏ. */
export async function postEntry(
  s: TransactionSql,
  tenantId: string,
  e: { date: string; documentId: string | null; memo: string; lines: PostingLine[] },
) {
  if (!isBalanced(e.lines)) throw new AppError("internal", "Bút toán không cân");
  const [entry] = await s<{ id: string }[]>`
    insert into journal_entries (tenant_id, entry_date, document_id, memo)
    values (${tenantId}, ${e.date}, ${e.documentId}, ${e.memo}) returning id`;
  for (const [account, debit, credit] of e.lines) {
    if (!debit && !credit) continue;
    await s`
      insert into journal_lines (tenant_id, entry_id, account_code, debit, credit)
      values (${tenantId}, ${entry.id}, ${account}, ${debit}, ${credit})`;
  }
  return entry.id;
}
