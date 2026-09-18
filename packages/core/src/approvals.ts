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
