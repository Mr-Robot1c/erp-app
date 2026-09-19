import type { TransactionSql } from "postgres";
import type { Member } from "./auth";

/** Việc chạy SAU KHI một chứng từ đạt `confirmed` (do duyệt đủ chuỗi hoặc xác nhận thẳng).
 * Mỗi loại chứng từ nối vào đây khi tới lô của nó (lô 2.2: SO → cọc + đáp ứng đơn, ...). */
export async function afterConfirm(_s: TransactionSql, _m: Member, doc: Record<string, unknown>): Promise<void> {
  switch (doc.doc_type) {
    default:
      return; // QUOTE, EXP: không có việc sau xác nhận
  }
}
