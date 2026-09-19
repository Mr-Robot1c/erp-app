/** Đơn vị tính quy đổi về đơn vị gốc (AC-43, lô 2.4). `factors` = { "thùng": 12 } nghĩa là 1 thùng = 12 đơn vị gốc.
 * Không truyền `uom` (hoặc bằng đơn vị gốc) thì giữ nguyên; đơn vị lạ thì báo lỗi rõ ràng. */
export function convertQty(qty: number, uom: string | undefined, baseUom: string, factors: Record<string, number> = {}): number {
  if (!uom || uom === baseUom) return qty;
  const f = factors[uom];
  if (!f || !(f > 0)) throw new Error(`Không có quy đổi cho đơn vị "${uom}" (đơn vị gốc: ${baseUom})`);
  return Math.round(qty * f * 1000) / 1000;
}
