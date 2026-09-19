import type { TransactionSql } from "postgres";
import { AppError, approvalTaskText, formatMoney, postStockAdjust, type AdjustInput, type ApprovalEntry, type Role, type TransferInput } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { postEntry } from "./journal";
import { avgCost, lockItems } from "./stock";

const today = () => new Date().toISOString().slice(0, 10);

async function onHandAt(s: TransactionSql, tenantId: string, itemId: string, whId: string): Promise<number> {
  const [r] = await s<{ v: string }[]>`
    select coalesce(sum(qty), 0) as v from stock_moves where tenant_id = ${tenantId} and item_id = ${itemId} and warehouse_id = ${whId}`;
  return Number(r.v);
}

/** Điều chuyển giữa 2 kho (lô 3.5, AC-25): 2 dòng ± cùng giao dịch, tổng tồn không đổi. Bỏ trạng thái "đang chuyển" —
 * chuyển tức thời nội bộ. Mặt hàng theo lô/serial: chưa hỗ trợ (cần chọn đúng lô/serial). */
export async function transferStock(s: TransactionSql, m: Member, input: TransferInput) {
  await assertPeriodOpen(s, m.tenantId, today());
  await lockItems(s, m.tenantId, [input.itemId]);
  const [item] = await s<{ kind: string; tracking: string; name: string }[]>`select kind, tracking, name from items where id = ${input.itemId} and tenant_id = ${m.tenantId}`;
  if (!item) throw new AppError("not_found", "Không tìm thấy mặt hàng");
  if (item.kind === "service") throw new AppError("invalid_argument", "Dịch vụ không có tồn kho");
  if (item.tracking !== "none") throw new AppError("invalid_argument", "Mặt hàng theo lô/serial: chưa hỗ trợ điều chuyển");
  const whs = await s<{ id: string; code: string }[]>`select id, code from warehouses where tenant_id = ${m.tenantId} and id in ${s([input.fromWh, input.toWh])}`;
  if (whs.length !== 2) throw new AppError("not_found", "Không tìm thấy kho");
  const have = await onHandAt(s, m.tenantId, input.itemId, input.fromWh);
  if (have < input.qty) throw new AppError("state_invalid", `Kho nguồn chỉ còn ${have} ${item.name}, không chuyển được ${input.qty}`);
  const cost = await avgCost(s, m.tenantId, input.itemId);
  await s`
    insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost)
    values (${m.tenantId}, ${input.itemId}, ${input.fromWh}, ${-input.qty}, ${cost}),
           (${m.tenantId}, ${input.itemId}, ${input.toWh}, ${input.qty}, ${cost})`;
  const from = whs.find((w) => w.id === input.fromWh)!.code;
  const to = whs.find((w) => w.id === input.toWh)!.code;
  await audit(s, m.tenantId, m.displayName || m.userId, "stock.transfer", item.name, `${input.qty}: ${from} → ${to}`);
  return { itemId: input.itemId, fromWh: input.fromWh, toWh: input.toWh, qty: input.qty };
}

/** Kiểm kê lệch (lô 3.5, AC-26): lập phiếu điều chỉnh `ADJ` CHỜ DUYỆT — tồn CHƯA đổi; kế toán duyệt mới ghi tồn + bút toán chênh lệch. */
export async function requestAdjust(s: TransactionSql, m: Member, input: AdjustInput) {
  await lockItems(s, m.tenantId, [input.itemId]);
  const [item] = await s<{ kind: string; name: string }[]>`select kind, name from items where id = ${input.itemId} and tenant_id = ${m.tenantId}`;
  if (!item) throw new AppError("not_found", "Không tìm thấy mặt hàng");
  if (item.kind === "service") throw new AppError("invalid_argument", "Dịch vụ không có tồn kho");
  const [main] = input.warehouseId
    ? await s<{ id: string }[]>`select id from warehouses where id = ${input.warehouseId} and tenant_id = ${m.tenantId}`
    : await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code <> 'QC' order by code limit 1`;
  if (!main) throw new AppError("not_found", "Không tìm thấy kho");
  if ((await onHandAt(s, m.tenantId, input.itemId, main.id)) + input.delta < 0) throw new AppError("invalid_argument", "Điều chỉnh làm tồn kho âm");

  const cost = await avgCost(s, m.tenantId, input.itemId);
  const chain: Role[] = m.role === "accountant" ? ["chief_accountant"] : ["accountant"]; // không tự duyệt
  const approvals: ApprovalEntry[] = [];
  const adj = await createDocument(s, m, {
    docType: "ADJ",
    lines: [{ itemId: input.itemId, qty: Math.abs(input.delta), price: cost, taxPct: 0 }],
    meta: { delta: input.delta, reason: input.reason, whId: main.id, unitCost: cost, chain, approvals },
  });
  const pending = await setStatus(s, m, adj.id as string, "pending", `Kiểm kê lệch ${input.delta > 0 ? "+" : ""}${input.delta}`);
  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, ${chain[0]}, ${approvalTaskText("ADJ", pending.doc_no as string)}, ${adj.id})`;
  await audit(s, m.tenantId, m.displayName || m.userId, "adj.pending", pending.doc_no as string, `${item.name} ${input.delta}`);
  return pending;
}

/** Sau khi duyệt phiếu điều chỉnh: ghi dòng tồn ± + bút toán chênh lệch (giá trị = |delta| × giá vốn bình quân LÚC DUYỆT). */
export async function adjustAfterConfirm(s: TransactionSql, m: Member, adj: Record<string, unknown>) {
  const id = adj.id as string;
  const meta = asObj<{ delta: number; whId: string }>(adj.meta);
  const [line] = await s<{ item_id: string }[]>`select item_id from document_lines where document_id = ${id} and tenant_id = ${m.tenantId} and line_no = 1`;
  await lockItems(s, m.tenantId, [line.item_id]);
  const [it] = await s<{ kind: string }[]>`select kind from items where id = ${line.item_id} and tenant_id = ${m.tenantId}`;
  const date = today();
  await assertPeriodOpen(s, m.tenantId, date);
  if ((await onHandAt(s, m.tenantId, line.item_id, meta.whId)) + meta.delta < 0) {
    throw new AppError("state_invalid", "Tồn đã thay đổi — điều chỉnh này làm tồn kho âm, lập lại phiếu");
  }
  const cost = await avgCost(s, m.tenantId, line.item_id);
  const amount = Math.round(Math.abs(meta.delta) * cost);
  await s`
    insert into stock_moves (tenant_id, move_date, item_id, warehouse_id, qty, unit_cost, document_id)
    values (${m.tenantId}, ${date}, ${line.item_id}, ${meta.whId}, ${meta.delta}, ${cost}, ${id})`;
  await postEntry(s, m.tenantId, {
    date,
    documentId: id,
    memo: `Điều chỉnh kho ${adj.doc_no as string}`,
    lines: postStockAdjust(amount, meta.delta, it.kind === "material" ? "152" : "156"),
  });
  await s`update documents set meta = meta || ${s.json({ unitCost: cost, amount } as never)} where id = ${id} and tenant_id = ${m.tenantId}`;
  await setStatus(s, m, id, "done", `Đã điều chỉnh, giá trị ${formatMoney(amount)}`);
}
