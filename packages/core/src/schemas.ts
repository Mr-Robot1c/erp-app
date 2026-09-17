import { z } from "zod";

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
