import type { TransactionSql } from "postgres";
import {
  AppError,
  addDays,
  approvalTaskText,
  buildPoChain,
  docTotal,
  type ApprovalEntry,
  type PurchaseOrderInput,
} from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { createDocument, setStatus } from "./documents";
import { asObj } from "./json";

/** Tạo đơn mua nháp (lô 3.1) — port demo createPO. Từ yêu cầu mua (PR đã `confirmed`): sao chép dòng, PR → `done`, đóng
 * việc của PR, mang `forSO` sang đơn mua để lô 3.2 nhập hàng xong tự giữ cho đơn bán gốc (AC-11). */
export async function createPurchaseOrder(s: TransactionSql, m: Member, input: PurchaseOrderInput) {
  const [supplier] = await s`select kind from partners where id = ${input.supplierId} and tenant_id = ${m.tenantId}`;
  if (!supplier) throw new AppError("not_found", "Không tìm thấy nhà cung cấp");
  if (supplier.kind === "customer") throw new AppError("invalid_argument", "Đối tác này là khách hàng, không phải nhà cung cấp");

  let lines: { itemId: string; qty: number; price: number }[] = input.lines ?? [];
  let pr: Record<string, unknown> | null = null;
  if (input.fromPrId) {
    const [row] = await s`
      select * from documents where id = ${input.fromPrId} and tenant_id = ${m.tenantId} and doc_type = 'PR' for update`;
    if (!row) throw new AppError("not_found", "Không tìm thấy yêu cầu mua");
    if (row.status !== "confirmed") throw new AppError("state_invalid", "Yêu cầu mua đã chuyển đơn hoặc chưa hiệu lực");
    pr = row;
    const prLines = await s<{ item_id: string; qty: string; price: string }[]>`
      select item_id, qty, price from document_lines where document_id = ${input.fromPrId} and tenant_id = ${m.tenantId} order by line_no`;
    lines = prLines.map((l) => ({ itemId: l.item_id, qty: Number(l.qty), price: Number(l.price) }));
  } else {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const found = await s`select id from items where tenant_id = ${m.tenantId} and id in ${s(ids)}`;
    if (found.length !== ids.length) throw new AppError("not_found", "Có mặt hàng không tồn tại");
  }

  const prMeta = pr ? asObj<{ forSO?: string; forSONo?: string }>(pr.meta) : {};
  const po = await createDocument(s, m, {
    docType: "PO",
    partnerId: input.supplierId,
    extId: input.extId ?? null,
    lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, taxPct: 10 })),
    meta: pr ? { prId: pr.id, prNo: pr.doc_no, forSO: prMeta.forSO ?? null, forSONo: prMeta.forSONo ?? null } : {},
  });

  if (pr) {
    await s`update documents set refs = ${s.json([pr.doc_no as string] as never)} where id = ${po.id as string} and tenant_id = ${m.tenantId}`;
    const prRefs = asObj<string[]>(pr.refs ?? []);
    await s`update documents set refs = ${s.json([...prRefs, po.doc_no as string] as never)} where id = ${pr.id as string} and tenant_id = ${m.tenantId}`;
    await setStatus(s, m, pr.id as string, "done", `Đã thành ${po.doc_no as string}`);
    await s`update tasks set done = true where document_id = ${pr.id as string} and tenant_id = ${m.tenantId} and not done`;
  }
  await audit(s, m.tenantId, m.displayName || m.userId, "po.create", po.doc_no as string, pr ? `từ ${pr.doc_no as string}` : "");
  return po;
}

/** Xác nhận đơn mua (lô 3.1, AC-20): KHÔNG có đường `confirmed` thẳng — luôn `pending` với chuỗi duyệt theo ngưỡng; duyệt đủ
 * chuỗi (endpoint duyệt chung) -> `confirmed` "Đã gửi NCC" + hạn giao dự kiến (hook `afterConfirm` PO). */
export async function confirmPurchaseOrder(s: TransactionSql, m: Member, poId: string) {
  const [po] = await s`
    select * from documents where id = ${poId} and tenant_id = ${m.tenantId} and doc_type = 'PO' for update`;
  if (!po) throw new AppError("not_found", "Không tìm thấy đơn mua");
  if (po.status !== "draft") throw new AppError("state_invalid", "Đơn mua không ở trạng thái nháp");

  const lines = await s<{ qty: string; price: string }[]>`
    select qty, price from document_lines where document_id = ${poId} and tenant_id = ${m.tenantId}`;
  const total = docTotal(lines.map((l) => ({ qty: Number(l.qty), price: Number(l.price) })));
  const [t] = await s<{ settings: unknown }[]>`select settings from tenants where id = ${m.tenantId}`;
  const settings = asObj<{ poThreshold: number }>(t.settings);

  const { chain, skippedSelf } = buildPoChain(total, settings, m.role);
  const approvals: ApprovalEntry[] = [];
  await s`update documents set meta = meta || ${s.json({ chain, approvals, total } as never)} where id = ${poId} and tenant_id = ${m.tenantId}`;
  const pending = await setStatus(
    s,
    m,
    poId,
    "pending",
    total > settings.poThreshold ? "Vượt ngưỡng duyệt đơn mua" : skippedSelf ? "Bỏ cấp tự duyệt" : "Chờ trưởng bộ phận duyệt",
  );
  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, ${chain[0]}, ${approvalTaskText("PO", pending.doc_no as string)}, ${poId})`;
  await audit(s, m.tenantId, m.displayName || m.userId, "po.pending", pending.doc_no as string, `chuỗi ${chain.length} cấp`);
  return pending;
}

/** Sau khi đơn mua `confirmed`: ghi hạn giao dự kiến (ngày + 5) — nhắc trễ hạn để GĐ5. */
export async function poAfterConfirm(s: TransactionSql, m: Member, po: Record<string, unknown>) {
  const eta = addDays(new Date().toISOString().slice(0, 10), 5);
  await s`update documents set meta = meta || ${s.json({ eta, sentToSupplier: true } as never)} where id = ${po.id as string} and tenant_id = ${m.tenantId}`;
}
