import type { TransactionSql } from "postgres";
import { AppError, approvalTaskText, buildChain, type ApprovalEntry, type DocType, type ExpenseInput, type Role } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { createDocument, setStatus } from "./documents";
import { afterConfirm } from "./hooks";
import { asObj } from "./json";

type ExpenseMeta = { purpose: string; chain: Role[]; approvals: ApprovalEntry[] };

/** Đóng task đang mở của MỘT cấp duyệt cho 1 chứng từ (lô 1.3). */
async function closeTask(s: TransactionSql, tenantId: string, documentId: string, role: string) {
  await s`
    update tasks set done = true
    where tenant_id = ${tenantId} and document_id = ${documentId} and role = ${role} and done = false`;
}

/** Tạo đề xuất chi (EXP) + chuỗi duyệt theo ngưỡng + task cho cấp đầu — port từ demo `createExpense`
 * (packages/core `buildChain`, lô 1.3). Dùng lại khung chứng từ chung (createDocument/setStatus,
 * lô 0.3) thay vì viết lại: EXP có 1 "dòng" ảo {qty:1, price:amount, taxPct:0} để docTotal ra đúng
 * số tiền đề xuất, KHÔNG áp thuế (đây là đề xuất chi nội bộ, không phải hoá đơn). */
export async function createExpense(s: TransactionSql, m: Member, input: ExpenseInput) {
  const [tenant] = await s<{ settings: { expThreshold: number } }[]>`
    select settings from tenants where id = ${m.tenantId}`;
  const { chain, skippedSelf } = buildChain("EXP", input.amount, tenant.settings, m.role);

  const created = await createDocument(s, m, {
    docType: "EXP",
    extId: input.extId ?? null,
    lines: [{ itemId: null, qty: 1, price: input.amount, taxPct: 0 }],
    meta: { purpose: input.purpose, chain, approvals: [] as ApprovalEntry[] },
  });

  const pending = await setStatus(
    s,
    m,
    created.id as string,
    "pending",
    skippedSelf ? `Bỏ cấp tự duyệt (${m.role})` : "",
  );

  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, ${chain[0]}, ${"Duyệt đề xuất chi " + (pending.doc_no as string)}, ${created.id})`;

  return pending;
}

/** Duyệt/từ chối theo lượt (lô 1.3). Người duyệt phải khác người lập; đúng lượt (vai = chain[đã
 * duyệt] hoặc admin); reject bắt buộc lý do, đưa chứng từ về `cancelled` (KHÔNG về `draft` — trigger
 * bất biến lô 0.3 chặn mọi đường về draft, nên "từ chối" ở đây nghĩa là huỷ đề xuất, muốn sửa thì
 * lập đề xuất mới). Duyệt đủ chuỗi -> `confirmed`. */
export async function decideApproval(
  s: TransactionSql,
  m: Member,
  docId: string,
  decision: "approve" | "reject",
  reason?: string,
) {
  const [doc] = await s`select * from documents where id = ${docId} and tenant_id = ${m.tenantId} for update`;
  if (!doc) throw new AppError("not_found", "Không tìm thấy chứng từ");
  if (doc.status !== "pending") throw new AppError("state_invalid", "Chứng từ không ở trạng thái chờ duyệt");
  if (m.userId === doc.created_by) throw new AppError("forbidden", "Người duyệt phải khác người lập");

  // Cột jsonb qua đường `select ... for update` này không tự parse thành object (cùng gặp ở
  // idempotency_keys.response, server/api.ts) -> parse tường minh trước khi đọc field.
  const meta = asObj<ExpenseMeta>(doc.meta);
  const nextRole = meta.chain[meta.approvals.length];
  if (m.role !== "admin" && m.role !== nextRole) {
    throw new AppError("forbidden", "Chưa tới lượt duyệt của vai này");
  }

  await closeTask(s, m.tenantId, docId, nextRole);

  if (decision === "reject") {
    if (!reason) throw new AppError("invalid_argument", "Từ chối phải có lý do");
    const cancelled = await setStatus(s, m, docId, "cancelled", `Từ chối: ${reason}`);
    await audit(s, m.tenantId, m.displayName || m.userId, "approval.reject", doc.doc_no as string, reason);
    return cancelled;
  }

  const approvals: ApprovalEntry[] = [
    ...meta.approvals,
    { byUserId: m.userId, byName: m.displayName, role: m.role, at: new Date().toISOString() },
  ];
  const newMeta = { ...meta, approvals };
  await s`update documents set meta = ${s.json(newMeta as never)} where id = ${docId} and tenant_id = ${m.tenantId}`;
  await audit(
    s,
    m.tenantId,
    m.displayName || m.userId,
    "approval.approve",
    doc.doc_no as string,
    `cấp ${approvals.length}/${meta.chain.length}`,
  );

  if (approvals.length < meta.chain.length) {
    const next = meta.chain[approvals.length];
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, ${next}, ${approvalTaskText(doc.doc_type as DocType, doc.doc_no as string)}, ${docId})`;
    const [refreshed] = await s`select * from documents where id = ${docId} and tenant_id = ${m.tenantId}`;
    return refreshed;
  }

  const confirmed = await setStatus(s, m, docId, "confirmed", "Duyệt đủ chuỗi");
  await afterConfirm(s, m, confirmed);
  // Hook có thể đẩy chứng từ đi tiếp (vd hoá đơn mua ghi sổ → done): trả về bản mới nhất.
  const [latest] = await s`select * from documents where id = ${docId} and tenant_id = ${m.tenantId}`;
  return latest ?? confirmed;
}
