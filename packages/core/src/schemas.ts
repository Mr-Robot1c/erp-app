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
  uomFactors: z.record(z.string(), z.number().positive()).default({}),
});
export type ItemInput = z.infer<typeof itemSchema>;

/** Sửa danh mục (lô 3.0): `code` bất biến — nếu gửi lên phải trùng mã cũ (server đối chiếu, khác → invalid_argument). */
export const partnerUpdateSchema = z.object({
  id: z.string().uuid(),
  code: z.string().optional(),
  name: z.string().min(1, "Thiếu tên").optional(),
  kind: z.enum(["customer", "supplier", "both"]).optional(),
  creditLimit: z.number().int().nonnegative().optional(),
});
export const itemUpdateSchema = z.object({
  id: z.string().uuid(),
  code: z.string().optional(),
  name: z.string().min(1, "Thiếu tên").optional(),
  kind: z.enum(["goods", "service", "material", "finished"]).optional(),
  uom: z.string().min(1).optional(),
  price: z.number().int().nonnegative().optional(),
  cost: z.number().int().nonnegative().optional(),
  tracking: z.enum(["none", "lot", "serial"]).optional(),
  uomFactors: z.record(z.string(), z.number().positive()).optional(),
});
export const warehouseSchema = z.object({
  code: z.string().regex(CODE_RE, "Mã không hợp lệ"),
  name: z.string().min(1, "Thiếu tên"),
});

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

export const quoteLineSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive("Số lượng phải lớn hơn 0"),
  price: z.number().int().nonnegative("Đơn giá không âm"),
});

export const quoteSchema = z.object({
  partnerId: z.string().uuid(),
  extId: z.string().uuid().nullable().optional(),
  lines: z.array(quoteLineSchema).min(1, "Báo giá cần ít nhất 1 dòng"),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const quoteIdSchema = z.object({ quoteId: z.string().uuid() });
export type QuoteIdInput = z.infer<typeof quoteIdSchema>;

export const quoteToOrderSchema = z.object({
  quoteId: z.string().uuid(),
  terms: z.enum(["cash", "credit"]),
  depositPct: z.number().min(0).max(100).default(0),
});
export type QuoteToOrderInput = z.infer<typeof quoteToOrderSchema>;

export const orderIdSchema = z.object({ orderId: z.string().uuid() });
export type OrderIdInput = z.infer<typeof orderIdSchema>;

export const deliverLineSchema = z.object({
  lineNo: z.number().int().positive(),
  qty: z.number().positive("Số lượng phải lớn hơn 0"),
  uom: z.string().min(1).optional(),
  serials: z.array(z.string().min(1)).optional(),
  lots: z.array(z.object({ lotNo: z.string().min(1), qty: z.number().positive() })).optional(),
});

export const deliverSchema = z.object({
  orderId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày sai định dạng YYYY-MM-DD").optional(),
  signedBy: z.string().trim().min(1).optional(),
  lines: z.array(deliverLineSchema).min(1, "Chưa nhập số lượng xuất"),
});
export type DeliverInput = z.infer<typeof deliverSchema>;

export const issueInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày sai định dạng YYYY-MM-DD").optional(),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export const receiptSchema = z.object({
  partnerId: z.string().uuid(),
  amount: z.number().int().positive("Số tiền phải lớn hơn 0"),
  method: z.enum(["bank", "cash"]),
  bankRef: z.string().trim().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày sai định dạng YYYY-MM-DD").optional(),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

export const purchaseOrderSchema = z
  .object({
    supplierId: z.string().uuid(),
    fromPrId: z.string().uuid().optional(),
    extId: z.string().uuid().nullable().optional(),
    lines: z.array(quoteLineSchema).optional(),
  })
  .refine((v) => v.fromPrId || (v.lines && v.lines.length > 0), { message: "Đơn mua cần yêu cầu mua gốc hoặc ít nhất 1 dòng" });
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const poIdSchema = z.object({ poId: z.string().uuid() });

export const receiveSchema = z.object({
  poId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày sai định dạng YYYY-MM-DD").optional(),
  /** Đợt nhận CUỐI: nhà cung cấp không giao thêm nữa — dùng để kiểm lệch quá dung sai khi nhận thiếu (AC-21). */
  final: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        lineNo: z.number().int().positive(),
        qty: z.number().positive("Số lượng phải lớn hơn 0"),
        lots: z.array(z.object({ lotNo: z.string().min(1), qty: z.number().positive() })).optional(),
        serials: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1, "Chưa nhập số lượng nhận"),
});
export type ReceiveInput = z.infer<typeof receiveSchema>;

export const passQcSchema = z.object({ grnId: z.string().uuid() });
