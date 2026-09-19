import type { Role } from "./labels";

/** Loại chứng từ có chuỗi duyệt — chỉ 'EXP' ở lô 1.3; SO/PO/ADJ nối vào khi tới lô của chúng. */
export type ApprovalKind = "EXP";

export type ApprovalEntry = { byUserId: string; byName: string; role: Role; at: string };

/** Port từ demo/core.js `createExpense` (packages/core, lô 1.3): chuỗi duyệt theo ngưỡng, bỏ cấp
 * trùng vai người lập (AC-29). Chuỗi được SNAPSHOT vào meta.chain lúc tạo — đổi ngưỡng sau đó
 * không ảnh hưởng đề xuất đang đi (AC-05, lô 1.4). */
export function buildChain(
  kind: ApprovalKind,
  amount: number,
  settings: { expThreshold: number },
  creatorRole: Role,
): { chain: Role[]; skippedSelf: boolean } {
  if (kind !== "EXP") throw new Error(`buildChain: chưa hỗ trợ kind=${kind}`);

  const base: Role[] = ["dept_lead", "accountant"];
  if (amount > settings.expThreshold) base.push("director");

  const chain = base.filter((r) => r !== creatorRole);
  return { chain, skippedSelf: chain.length < base.length };
}

/** Chuỗi duyệt đơn mua (lô 3.1, AC-20): MỌI đơn mua có ít nhất 1 cấp duyệt. Tổng > ngưỡng -> trưởng bộ phận rồi kế toán
 * trưởng; ≤ ngưỡng -> trưởng bộ phận. Người lập trùng vai thì bỏ cấp tự duyệt; nếu bỏ xong chuỗi rỗng thì nâng lên kế
 * toán trưởng (vẫn phải có người KHÁC duyệt). */
export function buildPoChain(total: number, settings: { poThreshold: number }, creatorRole: Role): { chain: Role[]; skippedSelf: boolean } {
  const base: Role[] = total > settings.poThreshold ? ["dept_lead", "chief_accountant"] : ["dept_lead"];
  const filtered = base.filter((r) => r !== creatorRole);
  const chain: Role[] = filtered.length ? filtered : ["chief_accountant"];
  return { chain, skippedSelf: filtered.length < base.length };
}
