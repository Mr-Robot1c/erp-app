import { z } from "zod";
import { DOC_TYPES, STATUSES } from "./labels";

/** Mã danh mục: chữ/số/gạch, 1-32 ký tự (02-quyet-dinh mục C). */
export const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const partnerSchema = z.object({
  code: z.string().regex(CODE_RE, "Mã không hợp lệ"),
  name: z.string().min(1, "Thiếu tên"),
  kind: z.enum(["customer", "supplier", "both"]),
  creditLimit: z.number().int().nonnegative().default(0),
});
export type PartnerInput = z.infer<typeof partnerSchema>;

export const itemSchema = z.object({
  code: z.string().regex(CODE_RE, "Mã không hợp lệ"),
  name: z.string().min(1, "Thiếu tên"),
  kind: z.enum(["goods", "service", "material", "finished"]),
  uom: z.string().min(1).default("cái"),
  price: z.number().int().nonnegative().default(0),
  cost: z.number().int().nonnegative().default(0),
  tracking: z.enum(["none", "lot", "serial"]).default("none"),
});
export type ItemInput = z.infer<typeof itemSchema>;

export const docLineSchema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  qty: z.number().nonnegative(),
  price: z.number().int().nonnegative(),
  taxPct: z.number().min(0).max(100).optional(),
});

/** Khung chứng từ dùng chung (lô 0.3) — endpoint nghiệp vụ riêng của từng loại chứng từ
 * (GĐ2 trở đi) sẽ có schema chặt hơn theo loại; đây là bản mỏng để dựng khung + test. */
export const createDocumentSchema = z.object({
  docType: z.enum(DOC_TYPES),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày sai định dạng YYYY-MM-DD")
    .optional(),
  partnerId: z.string().uuid().nullable().optional(),
  extId: z.string().uuid().nullable().optional(),
  lines: z.array(docLineSchema).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const setStatusSchema = z.object({
  docId: z.string().uuid(),
  to: z.enum(STATUSES),
  note: z.string().optional(),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;
