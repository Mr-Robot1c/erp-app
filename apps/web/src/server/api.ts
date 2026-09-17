import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@erp/core";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string } };

/**
 * Bọc route handler: try/catch -> { ok, data|error }, HTTP 200 trừ 401 (unauthenticated) / 403 (forbidden)
 * (02-quyet-dinh mục F).
 */
export function handle<T>(fn: (req: Request) => Promise<T>) {
  return async (req: Request): Promise<NextResponse<ApiOk<T> | ApiErr>> => {
    try {
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
      console.error(e);
      return NextResponse.json(
        { ok: false, error: { code: "internal", message: "Lỗi hệ thống" } },
        { status: 200 },
      );
    }
  };
}
