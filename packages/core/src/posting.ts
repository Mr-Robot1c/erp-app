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

/** Nhập kho (GRN): Nợ 156 (hàng hoá) | 152 (vật tư) / Có 331 phải trả NCC — giá tạm = giá đơn mua (lô 3.2). */
export const postGrn = (byAccount: Record<string, number>): PostingLine[] => {
  const total = Object.values(byAccount).reduce((a, b) => a + b, 0);
  return [...Object.entries(byAccount).map(([acc, v]): PostingLine => [acc, v, 0]), ["331", 0, total]];
};

/** Hoá đơn mua (VINV) — CHỈ ghi PHẦN CHÊNH giá hàng đã nhập (GRN đã ghi giá tạm) + thuế GTGT đầu vào + dịch vụ khớp 2 bên.
 * KHÔNG ghi lại giá hàng (tránh Có 331 hai lần). Chênh dương: Nợ 156|152; âm: Có 156|152. Có 331 = thuế + dịch vụ + Σ chênh
 * (nếu âm thì thành Nợ 331). Lô 3.3 — sơ đồ chốt trong playbook/gd3-mua-kho.md. */
export const postVendorInvoice = (p: { adjByAccount: Record<string, number>; serviceNet: number; tax: number }): PostingLine[] => {
  const lines: PostingLine[] = [];
  let payable = p.serviceNet + p.tax;
  for (const [acc, v] of Object.entries(p.adjByAccount)) {
    if (v > 0) lines.push([acc, v, 0]);
    else if (v < 0) lines.push([acc, 0, -v]);
    payable += v;
  }
  if (p.serviceNet) lines.push(["642", p.serviceNet, 0]);
  if (p.tax) lines.push(["133", p.tax, 0]);
  lines.push(payable >= 0 ? ["331", 0, payable] : ["331", -payable, 0]);
  return lines;
};

/** Trả tiền nhà cung cấp (PAY): Nợ 331 / Có tiền mặt 111 | ngân hàng 112. Lô 3.4. */
export const postPayment = (amount: number, method: "cash" | "bank"): PostingLine[] => [
  ["331", amount, 0],
  [method === "cash" ? "111" : "112", 0, amount],
];

/** Điều chỉnh kho sau kiểm kê (lô 3.5): thiếu → Nợ 642 / Có 156|152; thừa → Nợ 156|152 / Có 642. */
export const postStockAdjust = (amount: number, delta: number, invAccount: string): PostingLine[] =>
  delta < 0 ? [["642", amount, 0], [invAccount, 0, amount]] : [[invAccount, amount, 0], ["642", 0, amount]];

/** Trả hàng bán (lô 3.5): đảo doanh thu + thuế + phải thu, đảo giá vốn theo giá đã xuất. */
export const postSalesReturn = (net: number, tax: number, cogs: number): PostingLine[] => [
  ["511", net, 0],
  ["3331", tax, 0],
  ["131", 0, net + tax],
  ["156", cogs, 0],
  ["632", 0, cogs],
];

/** Trả hàng mua (lô 3.5): giảm phải trả NCC, xuất hàng khỏi kho theo giá đơn mua. */
export const postPurchaseReturn = (amount: number, invAccount: string): PostingLine[] => [
  ["331", amount, 0],
  [invAccount, 0, amount],
];
