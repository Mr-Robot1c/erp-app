import type { OpeningBalanceInput } from "./schemas";

/** Đọc tệp CSV số dư đầu kỳ (lô 4.2). Cột: `loai,ma,kho,so_luong,gia_von,so_tien`; loại ∈ ton | phai_thu | phai_tra | tien (mã 111/112).
 * Dòng đầu là tiêu đề (bỏ qua nếu bắt đầu bằng "loai"); dòng trống và dòng bắt đầu bằng # bị bỏ. Trả lỗi kèm số dòng để hiện cho người dùng. */
export function parseOpeningCsv(text: string): { data: OpeningBalanceInput; errors: string[] } {
  const data: OpeningBalanceInput = { stock: [], receivables: [], payables: [], cash: { c111: 0, c112: 0 } };
  const errors: string[] = [];
  const num = (v: string | undefined) => Number((v ?? "").replace(/[.\s]/g, "").replace(",", "."));
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const c = line.split(/[,;\t]/).map((x) => x.trim());
      if (i === 0 && (c[0] ?? "").toLowerCase() === "loai") return;
      const at = `Dòng ${i + 1}`;
      const kind = (c[0] ?? "").toLowerCase();
      if (kind === "ton") {
        const qty = num(c[3]);
        const cost = num(c[4]);
        if (!c[1] || !c[2]) errors.push(`${at}: thiếu mã hàng hoặc mã kho`);
        else if (!(qty > 0)) errors.push(`${at}: số lượng phải lớn hơn 0`);
        else if (!Number.isInteger(cost) || cost < 0) errors.push(`${at}: giá vốn phải là số nguyên không âm`);
        else data.stock.push({ itemCode: c[1], warehouseCode: c[2], qty, unitCost: cost });
      } else if (kind === "phai_thu" || kind === "phai_tra") {
        const amount = num(c[5]);
        if (!c[1]) errors.push(`${at}: thiếu mã đối tác`);
        else if (!Number.isInteger(amount) || amount <= 0) errors.push(`${at}: số tiền phải là số nguyên lớn hơn 0`);
        else (kind === "phai_thu" ? data.receivables : data.payables).push({ partnerCode: c[1], amount });
      } else if (kind === "tien") {
        const amount = num(c[5]);
        if (!Number.isInteger(amount) || amount < 0) errors.push(`${at}: số tiền phải là số nguyên không âm`);
        else if (c[1] === "111") data.cash.c111 += amount;
        else if (c[1] === "112") data.cash.c112 += amount;
        else errors.push(`${at}: tiền chỉ nhận mã 111 (tiền mặt) hoặc 112 (ngân hàng)`);
      } else errors.push(`${at}: loại "${c[0]}" không hợp lệ (ton, phai_thu, phai_tra, tien)`);
    });
  return { data, errors };
}
