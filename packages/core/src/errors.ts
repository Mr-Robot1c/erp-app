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
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}
