import { timingSafeEqual } from "node:crypto";
import { AppError } from "@erp/core";
import { handle } from "@/server/api";
import { sweepAll } from "@/server/overdue";

/** Quét công nợ quá hạn (S04) — gọi hằng ngày từ GitHub Actions (schedule) với header `x-job-token` = biến môi trường `JOB_TOKEN`.
 * Không có JOB_TOKEN cấu hình, hoặc token sai → forbidden (không tiết lộ lý do). */
export const POST = handle(async (req: Request) => {
  const expected = process.env.JOB_TOKEN ?? "";
  const given = req.headers.get("x-job-token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError("forbidden");
  // Tuỳ chọn { tenantId } để quét riêng một doanh nghiệp (vận hành / kiểm thử).
  const body = (await req.json().catch(() => ({}))) as { tenantId?: string };
  return sweepAll(undefined, typeof body.tenantId === "string" ? body.tenantId : undefined);
});
