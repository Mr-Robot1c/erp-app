/** Quy tắc hạch toán — MỘT chỗ (tài liệu B3; TT133). Mỗi hàm trả các dòng [tài khoản, nợ, có]; luôn cân (Σ nợ = Σ có).
 * `journal.post` (server) ghi vào journal_entries/lines, trigger DB deferred kiểm cân lúc COMMIT. */
export type PostingLine = [account: string, debit: number, credit: number];

/** Xuất kho (DO): giá vốn hàng bán / hàng hoá. Lô 2.4. */
export const postDelivery = (cogs: number): PostingLine[] => [
  ["632", cogs, 0],
  ["156", 0, cogs],
];

/** Phát hành hoá đơn bán (INV): phải thu / doanh thu / thuế GTGT đầu ra. Lô 2.5. */
export const postInvoice = (net: number, tax: number): PostingLine[] => [
  ["131", net + tax, 0],
  ["511", 0, net],
  ["3331", 0, tax],
];

/** Thu tiền (RCPT): tiền mặt (111) hoặc ngân hàng (112) / phải thu. Lô 2.5. */
export const postReceipt = (amount: number, method: "cash" | "bank"): PostingLine[] => [
  [method === "cash" ? "111" : "112", amount, 0],
  ["131", 0, amount],
];

export const isBalanced = (lines: PostingLine[]) => lines.reduce((s, l) => s + l[1] - l[2], 0) === 0;
