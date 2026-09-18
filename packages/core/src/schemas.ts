import { z } from "zod";
import { DOC_TYPES, STATUSES, ROLES } from "./labels";

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

export const INDUSTRY_CODES = ["default", "trade", "construction", "manufacturing"] as const;

export const registerTenantSchema = z.object({
  name: z.string().trim().min(1, "Thiếu tên doanh nghiệp"),
  taxCode: z.string().trim().min(8, "Mã số thuế không hợp lệ").max(20, "Mã số thuế không hợp lệ"),
  industry: z.enum(INDUSTRY_CODES),
  withSample: z.boolean().default(true),
});
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  role: z.enum(ROLES),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const setRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
});
export type SetRoleInput = z.infer<typeof setRoleSchema>;

export const removeMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

export const expenseSchema = z.object({
  amount: z.number().int().positive("Số tiền phải lớn hơn 0"),
  purpose: z.string().trim().min(1, "Thiếu lý do đề xuất"),
  extId: z.string().uuid().nullable().optional(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const approvalDecisionSchema = z.object({
  docId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1).optional(),
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

/** 4 ngưỡng cấu hình doanh nghiệp (lô 1.4). Chuỗi duyệt ĐANG ĐI không đổi khi sửa ngưỡng — chain
 * đã snapshot vào meta lúc tạo chứng từ (AC-05). */
export const settingsSchema = z.object({
  expThreshold: z.number().int().positive("Phải lớn hơn 0"),
  poThreshold: z.number().int().positive("Phải lớn hơn 0"),
  tolerancePct: z.number().min(0).max(10, "Dung sai 0–10%"),
  terms: z.number().int().positive("Phải lớn hơn 0"),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
