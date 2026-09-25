const SALES_TYPES = new Set(["QUOTE", "SO", "DO", "INV", "RCPT"]);
const BUY_TYPES = new Set(["PR", "PO", "GRN", "VINV", "PAY"]);

/** Đích mở chi tiết chứng từ: `?open=<số>` là cơ chế sẵn có của Bán hàng/Mua hàng (tự chọn tab + mở modal). Loại khác → null. */
export function docHref(docType: string, docNo: string): string | null {
  if (SALES_TYPES.has(docType)) return `/app/sales?open=${encodeURIComponent(docNo)}`;
  if (BUY_TYPES.has(docType)) return `/app/buy?open=${encodeURIComponent(docNo)}`;
  return null;
}
