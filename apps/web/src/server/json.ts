/** Cột jsonb qua đường `select ... ` thô của driver `postgres` có lúc tới dạng chuỗi chưa parse
 * (gặp ở idempotency_keys.response lô 0.3 và documents.meta lô 1.3) — luôn qua hàm này khi đọc. */
export function asObj<T = Record<string, unknown>>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}
