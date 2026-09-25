/** Nhãn tiếng Việt cho mã hành động audit_log (03 mục G: mã tiếng Anh KHÔNG lộ ra màn). Mã lạ → "cập nhật". */
const LABEL: Record<string, string> = {
  "doc.create": "lập", "docs.create": "lập", "doc.set_status": "chuyển trạng thái", "doc.cancel": "huỷ",
  "quote.pending": "gửi duyệt báo giá", "quotes.create": "lập báo giá",
  "order.create": "lập đơn bán", "order.pending": "gửi duyệt đơn bán", "order.deliver": "xuất kho", "orders.deliver": "xuất kho",
  "order.fulfil": "đáp ứng tồn cho", "order.auto_reserve": "giữ hàng cho",
  "invoice.issue": "phát hành hoá đơn", "invoices.issue": "phát hành hoá đơn",
  "receipt.create": "ghi thu tiền", "receipts.create": "ghi thu tiền", "receipt.match": "khớp tay phiếu thu", "receipts.match": "khớp tay phiếu thu",
  "receipt.confirm_advance": "giữ làm tiền ứng trước",
  "po.create": "lập đơn mua", "po.pending": "gửi duyệt đơn mua", "po.receive": "nhận hàng", "purchase.receive": "nhận hàng",
  "vinv.book": "ghi hoá đơn mua", "vinv.pending": "gửi duyệt hoá đơn mua",
  "pay.pending": "gửi duyệt phiếu chi", "pay.execute": "chi tiền", "purchase.pay": "chi tiền",
  "approval.approve": "duyệt", "approval.reject": "từ chối",
  "grn.pass_qc": "đạt kiểm hàng", "stock.transfer": "chuyển kho", "stock.adjust": "kiểm kê", "adj.pending": "gửi duyệt điều chỉnh kho",
  "sales.return": "nhận trả hàng", "purchase.return": "trả hàng nhà cung cấp",
  "journal.adjust": "ghi bút toán điều chỉnh", "period.lock": "khoá kỳ", "opening.apply": "nạp số dư đầu kỳ",
  "partner.create": "thêm đối tác", "partner.update": "sửa đối tác", "item.create": "thêm mặt hàng", "item.update": "sửa mặt hàng", "warehouse.create": "thêm kho",
  "team.invite": "mời thành viên", "team.accept": "nhận lời mời", "team.set_role": "đổi vai thành viên", "team.remove": "gỡ thành viên",
  "tenant.settings": "đổi cài đặt", "tenant.register": "đăng ký doanh nghiệp", "sample.remove": "xoá dữ liệu mẫu",
};
export const auditLabel = (action: string): string => LABEL[action] ?? "cập nhật";
