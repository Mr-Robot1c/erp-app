import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { TransactionSql } from "postgres";
import { AppError } from "@erp/core";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string } };

function isPostgresUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "23505";
}

/**
 * Hợp đồng idempotency đầy đủ (02-quyet-dinh mục F, bổ sung 18/09). Gọi TRONG transaction của
 * nghiệp vụ, SAU KHI đã qua requireMember/can() (quyền kiểm trước, replay sau).
 *
 * fingerprint = endpoint + ':' + sha256(body) — lưu vào cột `endpoint`. Lần đầu: insert row rỗng
 * (response tạm) -> chạy fn() -> update response = kết quả (CÙNG transaction). Gặp lại (insert
 * on conflict do nothing không trả dòng) -> đọc dòng cũ: fingerprint khác -> "conflict" (key dùng
 * sai); fingerprint trùng -> trả response đã lưu, KHÔNG chạy lại fn().
 *
 * Đồng thời: 2 request cùng key cùng lúc -> request sau bị Postgres giữ trên PK (tenant_id,key)
 * tới khi request trước commit/rollback (ON CONFLICT phải đợi transaction đang giữ hàng xong).
 * Rollback -> khoá biến mất cùng transaction -> request sau chạy như lần đầu (lỗi giữa chừng
 * không "đốt" key). Commit -> request sau đọc được response cuối cùng, không double-write.
 */
export async function withIdempotency<T>(
  s: TransactionSql,
  tenantId: string,
  key: string | null,
  endpoint: string,
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) return fn(); // endpoint không khai idempotency required -> chạy thẳng

  const fingerprint = `${endpoint}:${createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex")}`;

  const inserted = await s`
    insert into idempotency_keys (tenant_id, key, endpoint, response)
    values (${tenantId}, ${key}, ${fingerprint}, '{}'::jsonb)
    on conflict (tenant_id, key) do nothing
    returning tenant_id`;

  if (inserted.length === 0) {
    const [existing] = await s<{ endpoint: string; response: unknown }[]>`
      select endpoint, response from idempotency_keys where tenant_id = ${tenantId} and key = ${key}`;
    if (!existing) throw new AppError("internal", "idempotency_keys: mất dòng sau conflict");
    if (existing.endpoint !== fingerprint) {
      throw new AppError("conflict", "Idempotency-Key đã dùng cho yêu cầu khác");
    }
    // Cột jsonb không tự parse thành object qua driver ở đường này -> parse tường minh khi cần.
    return (typeof existing.response === "string" ? JSON.parse(existing.response) : existing.response) as T;
  }

  const result = await fn();
  await s`update idempotency_keys set response = ${JSON.stringify(result)}::jsonb where tenant_id = ${tenantId} and key = ${key}`;
  return result;
}

/**
 * Bọc route handler: try/catch -> { ok, data|error }, HTTP 200 trừ 401 (unauthenticated) / 403 (forbidden)
 * (02-quyet-dinh mục F). `idempotency: 'required'` -> thiếu header Idempotency-Key thì chặn ngay,
 * không gọi fn (mọi endpoint tạo chứng từ/ghi tiền/ghi kho từ GĐ2 phải khai option này).
 */
export function handle<T>(fn: (req: Request) => Promise<T>, opts?: { idempotency?: "required" }) {
  return async (req: Request): Promise<NextResponse<ApiOk<T> | ApiErr>> => {
    try {
      if (opts?.idempotency === "required" && !req.headers.get("idempotency-key")) {
        return NextResponse.json(
          { ok: false, error: { code: "invalid_argument", message: "Thiếu Idempotency-Key" } },
          { status: 200 },
        );
      }
      const data = await fn(req);
      return NextResponse.json({ ok: true, data });
    } catch (e) {
      if (e instanceof AppError) {
        const status = e.code === "unauthenticated" ? 401 : e.code === "forbidden" ? 403 : 200;
        return NextResponse.json(
          { ok: false, error: { code: e.code, message: e.message } },
          { status },
        );
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { ok: false, error: { code: "invalid_argument", message: e.issues.map((i) => i.message).join("; ") } },
          { status: 200 },
        );
      }
      // Postgres unique_violation (23505) -> duplicate. Hàng rào là constraint DB (SELECT kiểm trùng
      // ở route vẫn giữ để trả message đẹp trước); mapping này là lưới đỡ khi 2 request cùng lúc lách qua
      // (02-quyet-dinh, lo 0.2b viec 2).
      if (isPostgresUniqueViolation(e)) {
        return NextResponse.json(
          { ok: false, error: { code: "duplicate", message: "Dữ liệu đã tồn tại" } },
          { status: 200 },
        );
      }
      console.error(e);
      return NextResponse.json(
        { ok: false, error: { code: "internal", message: "Lỗi hệ thống" } },
        { status: 200 },
      );
    }
  };
}
