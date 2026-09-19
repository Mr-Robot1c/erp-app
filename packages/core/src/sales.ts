import type { DocType } from "./labels";
import { DOC_LABEL } from "./labels";

export const QUOTE_VALID_DAYS = 14;

/** Cộng ngày cho chuỗi YYYY-MM-DD (UTC, không lệch múi giờ). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Báo giá có dòng giá thấp hơn giá bảng -> cần trưởng kinh doanh duyệt (AC-06, port demo confirmQuote). */
export function quoteBelowList(lines: { price: number }[], listPrices: number[]): boolean {
  return lines.some((l, i) => l.price < (listPrices[i] ?? 0));
}

/** Nội dung việc "duyệt" hiển thị ở /app/tasks — theo loại chứng từ. */
export function approvalTaskText(docType: DocType, docNo: string): string {
  return docType === "EXP" ? `Duyệt đề xuất chi ${docNo}` : `Duyệt ${DOC_LABEL[docType].name.toLowerCase()} ${docNo}`;
}
