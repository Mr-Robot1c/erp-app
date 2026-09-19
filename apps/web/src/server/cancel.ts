import type { TransactionSql } from "postgres";
import { AppError } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { setStatus } from "./documents";
import { lockItems } from "./stock";

const CANCELLABLE = new Set(["QUOTE", "SO", "PR", "PO", "MO"]);

/** Huỷ chứng từ chưa thực hiện (lô 3.5, AC-28) — port demo cancel.
 * - Đơn bán chưa giao: nhả hết hàng đang giữ, huỷ yêu cầu mua / lệnh sản xuất còn mở gắn đơn, tiền cọc đã thu → tiền ứng trước của khách.
 * - Đơn mua chưa nhận: huỷ (đã nhận một phần → dùng trả hàng mua).
 * - Báo giá / yêu cầu mua / lệnh sản xuất: huỷ nếu chưa xong.
 * Chứng từ đã `done` → state_invalid (chỉ còn đường trả hàng). Mọi việc còn mở của chứng từ được đóng. */
export async function cancelDocument(s: TransactionSql, m: Member, docId: string) {
  const [doc] = await s`select * from documents where id = ${docId} and tenant_id = ${m.tenantId} for update`;
  if (!doc) throw new AppError("not_found", "Không tìm thấy chứng từ");
  const type = doc.doc_type as string;
  if (!CANCELLABLE.has(type)) throw new AppError("state_invalid", "Loại chứng từ này không huỷ trực tiếp được");
  if (doc.status === "done") throw new AppError("state_invalid", "Chứng từ đã hoàn tất — chỉ xử lý được bằng trả hàng");
  if (doc.status === "cancelled") throw new AppError("state_invalid", "Chứng từ đã huỷ");
  const no = doc.doc_no as string;

  if (type === "SO") {
    if (doc.status === "partial") throw new AppError("state_invalid", "Đơn đã giao một phần — xử lý bằng trả hàng");
    const [delivered] = await s`select 1 from documents where tenant_id = ${m.tenantId} and doc_type = 'DO' and meta->>'soId' = ${docId} and status <> 'cancelled' limit 1`;
    if (delivered) throw new AppError("state_invalid", "Đơn đã có phiếu xuất kho — xử lý bằng trả hàng");
    await s`select 1 from partners where id = ${doc.partner_id as string} and tenant_id = ${m.tenantId} for update`;
    const held = await s<{ item_id: string }[]>`select item_id from reservations where document_id = ${docId} and tenant_id = ${m.tenantId}`;
    await lockItems(s, m.tenantId, held.map((h) => h.item_id));
    await s`delete from reservations where document_id = ${docId} and tenant_id = ${m.tenantId}`;

    // Yêu cầu mua / lệnh sản xuất tự sinh cho đơn này mà còn mở → huỷ theo.
    const kids = await s<{ id: string }[]>`
      select id from documents where tenant_id = ${m.tenantId} and doc_type in ('PR', 'MO') and meta->>'forSO' = ${docId}
        and status in ('draft', 'pending', 'confirmed')`;
    for (const k of kids) {
      await setStatus(s, m, k.id, "cancelled", `Huỷ theo đơn ${no}`);
      await s`update tasks set done = true where document_id = ${k.id} and tenant_id = ${m.tenantId} and not done`;
    }

    // Cọc đã thu không mất: chuyển thành tiền ứng trước của khách; khoản cọc coi như đã tất toán.
    const deps = await s<{ id: string; paid: string }[]>`
      select id, paid from receivables where tenant_id = ${m.tenantId} and kind = 'deposit' and document_id = ${docId} for update`;
    for (const d of deps) {
      const paid = Number(d.paid);
      if (paid > 0) {
        await s`
          insert into partner_advances (tenant_id, partner_id, amount) values (${m.tenantId}, ${doc.partner_id as string}, ${paid})
          on conflict (tenant_id, partner_id) do update set amount = partner_advances.amount + excluded.amount`;
      }
      await s`update receivables set amount = ${paid} where id = ${d.id}`;
    }
  } else if (type === "PO") {
    if (doc.status === "partial") throw new AppError("state_invalid", "Đơn mua đã nhận một phần — xử lý bằng trả hàng mua");
    const [got] = await s`select 1 from documents where tenant_id = ${m.tenantId} and doc_type = 'GRN' and meta->>'poId' = ${docId} limit 1`;
    if (got) throw new AppError("state_invalid", "Đơn mua đã có phiếu nhập kho — xử lý bằng trả hàng mua");
  }

  const cancelled = await setStatus(s, m, docId, "cancelled", "Huỷ");
  await s`update tasks set done = true where document_id = ${docId} and tenant_id = ${m.tenantId} and not done`;
  await audit(s, m.tenantId, m.displayName || m.userId, "doc.cancel", no);
  return cancelled;
}
