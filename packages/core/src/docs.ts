import type { DocStatus } from "./labels";

/** Bảng chuyển trạng thái hợp lệ (chép tinh thần demo/core.js: setStatus tuần tự theo luồng nghiệp vụ).
 * Luật cứng: KHÔNG BAO GIỜ có đường về `draft` (khớp trigger DB `trg_doc_immutable`);
 * `done`/`cancelled` là trạng thái cuối, không tự chuyển tiếp bằng setStatus thường. */
const TRANSITIONS: Record<DocStatus, readonly DocStatus[]> = {
  draft: ["pending", "confirmed", "cancelled"],
  pending: ["confirmed", "cancelled"],
  confirmed: ["partial", "done", "cancelled"],
  partial: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: DocStatus, to: DocStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type DocLineInput = {
  qty: number;
  price: number;
  taxPct?: number;
};

/** Tiền = đồng nguyên, làm tròn ở TỪNG dòng trước khi cộng (02-quyet-dinh mục C). */
export function lineTotal(line: DocLineInput): number {
  return Math.round(line.qty * line.price);
}

export function docTotal(lines: DocLineInput[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

export function docTax(lines: DocLineInput[]): number {
  return lines.reduce((sum, l) => sum + Math.round((lineTotal(l) * (l.taxPct ?? 0)) / 100), 0);
}
