/** Mã lỗi API — nguồn sự thật MỘT chỗ (02-quyet-dinh mục F). Thêm mã mới phải ghi vào file đó. */
export const ERROR_CODES = [
  "unauthenticated",
  "no_tenant",
  "forbidden",
  "invalid_argument",
  "not_found",
  "conflict",
  "state_invalid",
  "period_locked",
  "stock_insufficient",
  "duplicate",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  code: ErrorCode;
  /** Chi tiết máy đọc được kèm lỗi (vd `suggestedDate` của period_locked, `blockers` của khoá kỳ) — trả nguyên trong `error`. */
  extra?: Record<string, unknown>;
  constructor(code: ErrorCode, message?: string, extra?: Record<string, unknown>) {
    super(message ?? code);
    this.code = code;
    this.extra = extra;
  }
}
