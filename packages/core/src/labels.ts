/** Nhãn tiếng Việt — nguồn sự thật MỘT chỗ (02-quyet-dinh mục C). */

export const ROLES = [
  "admin",
  "director",
  "sales_lead",
  "sales",
  "warehouse",
  "purchasing",
  "dept_lead",
  "accountant",
  "chief_accountant",
  "staff",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Quản trị viên",
  director: "Giám đốc",
  sales_lead: "Trưởng kinh doanh",
  sales: "Nhân viên kinh doanh",
  warehouse: "Thủ kho",
  purchasing: "Mua hàng",
  dept_lead: "Trưởng bộ phận",
  accountant: "Kế toán",
  chief_accountant: "Kế toán trưởng",
  staff: "Nhân viên",
};

export const DOC_TYPES = [
  "QUOTE", "SO", "DO", "INV", "RCPT", "PR", "PO", "GRN", "VINV", "PAY", "EXP", "MO", "ADJ",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABEL: Record<DocType, { prefix: string; name: string }> = {
  QUOTE: { prefix: "BG", name: "Báo giá" },
  SO: { prefix: "ĐB", name: "Đơn bán" },
  DO: { prefix: "PX", name: "Phiếu xuất" },
  INV: { prefix: "HĐ", name: "Hoá đơn bán" },
  RCPT: { prefix: "PT", name: "Phiếu thu" },
  PR: { prefix: "YM", name: "Yêu cầu mua" },
  PO: { prefix: "ĐM", name: "Đơn mua" },
  GRN: { prefix: "PN", name: "Phiếu nhập" },
  VINV: { prefix: "HĐM", name: "Hoá đơn mua" },
  PAY: { prefix: "PC", name: "Phiếu chi" },
  EXP: { prefix: "ĐX", name: "Đề xuất chi" },
  MO: { prefix: "LSX", name: "Lệnh sản xuất" },
  ADJ: { prefix: "ĐC", name: "Điều chỉnh kho" },
};

export const STATUSES = ["draft", "pending", "confirmed", "partial", "done", "cancelled"] as const;
export type DocStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Nháp",
  pending: "Chờ duyệt",
  confirmed: "Đã xác nhận",
  partial: "Một phần",
  done: "Đã thực hiện",
  cancelled: "Đã huỷ",
};

/** Nhãn hiển thị thực tế của đơn bán. `deliveredAll` là trạng thái vận hành đã được
 * luồng xuất kho ghi vào documents.meta; không suy diễn thêm trạng thái không có trong ERP. */
export function salesOrderStatusLabel(status: DocStatus, deliveredAll = false): string {
  if (deliveredAll && status !== "done" && status !== "cancelled") return "Đã giao";
  if (status === "partial") return "Đã giao một phần";
  return STATUS_LABEL[status] ?? status;
}

export function formatDocNo(type: DocType, n: number): string {
  return `${DOC_LABEL[type].prefix}-${String(n).padStart(4, "0")}`;
}

/** Tiền VND: số nguyên đồng. */
export function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString("vi-VN")} đ`;
}
