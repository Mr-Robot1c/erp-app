import type { TransactionSql } from "postgres";
import type { Member } from "./auth";
import { orderAfterConfirm } from "./orders-hooks";
import { poAfterConfirm } from "./purchase";
import { bookVendorInvoice } from "./vinv";

/** Việc chạy SAU KHI một chứng từ đạt `confirmed` (do duyệt đủ chuỗi hoặc xác nhận thẳng).
 * Mỗi loại chứng từ nối vào đây khi tới lô của nó. */
export async function afterConfirm(s: TransactionSql, m: Member, doc: Record<string, unknown>): Promise<void> {
  switch (doc.doc_type) {
    case "SO":
      return orderAfterConfirm(s, m, doc);
    case "PO":
      return poAfterConfirm(s, m, doc);
    case "VINV":
      await bookVendorInvoice(s, m, doc.id as string);
      return;
    default:
      return; // QUOTE, EXP: không có việc sau xác nhận
  }
}
