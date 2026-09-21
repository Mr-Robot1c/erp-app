import type { TransactionSql } from "postgres";
import { AppError, formatMoney, postOpeningBalance, type OpeningBalanceInput } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { postEntry } from "./journal";
import { removeSampleData } from "./sample";

const today = () => new Date().toISOString().slice(0, 10);

/** Doanh nghiệp còn "sạch" để nạp số dư đầu kỳ: chưa có chứng từ nào (kể cả số dư đầu đã nạp — chỉ nạp MỘT lần). */
async function assertClean(s: TransactionSql, tenantId: string) {
  const [any] = await s`select 1 from documents where tenant_id = ${tenantId} limit 1`;
  if (any) throw new AppError("conflict", "Doanh nghiệp đã có chứng từ — chỉ nạp số dư đầu kỳ được khi chưa phát sinh nghiệp vụ nào");
}

/** Xoá dữ liệu mẫu trước khi nạp thật (AC-04). Chỉ chạy được khi chưa có chứng từ (tồn đầu mẫu bị xoá theo). */
export async function removeSampleForOnboarding(s: TransactionSql, m: Member) {
  await assertClean(s, m.tenantId);
  const r = await removeSampleData(s, m.tenantId, { purgeOpening: true });
  await audit(s, m.tenantId, m.displayName || m.userId, "sample.remove", "", `partners=${r.removedPartners}, items=${r.removedItems}`);
  return r;
}

/** Nạp số dư đầu kỳ (lô 4.2, AC-04): xoá dữ liệu mẫu; tồn đầu (dòng tồn gắn phiếu ADJ "SỐ DƯ ĐẦU"), khoản phải thu / phải trả (không gắn hoá đơn),
 * MỘT bút toán cân Nợ 156|152 + 131 + 111/112, Có 331, chênh vào 411. Chỉ MỘT lần và chỉ khi chưa có chứng từ (conflict).
 * Hạn chế: bút toán không gắn đối tác nên sổ chi tiết đối tác chưa thấy số đầu kỳ (khoản phải thu/trả vẫn ở màn Công nợ). Hàng theo lô/serial: chưa hỗ trợ. */
export async function applyOpeningBalance(s: TransactionSql, m: Member, input: OpeningBalanceInput) {
  await assertClean(s, m.tenantId);
  const date = input.date ?? today();
  await assertPeriodOpen(s, m.tenantId, date);
  const sample = await removeSampleData(s, m.tenantId, { purgeOpening: true });

  const items = await s<{ id: string; code: string; kind: string; tracking: string }[]>`select id, code, kind, tracking from items where tenant_id = ${m.tenantId}`;
  const whs = await s<{ id: string; code: string }[]>`select id, code from warehouses where tenant_id = ${m.tenantId}`;
  const partners = await s<{ id: string; code: string }[]>`select id, code from partners where tenant_id = ${m.tenantId}`;
  const missing: string[] = [];
  const itemBy = new Map(items.map((i) => [i.code, i]));
  const whBy = new Map(whs.map((w) => [w.code, w.id]));
  const partnerBy = new Map(partners.map((p) => [p.code, p.id]));
  for (const r of input.stock) {
    const it = itemBy.get(r.itemCode);
    if (!it) missing.push(`mặt hàng ${r.itemCode}`);
    else if (it.kind === "service") missing.push(`${r.itemCode} là dịch vụ, không có tồn kho`);
    else if (it.tracking !== "none") missing.push(`${r.itemCode} theo lô/serial: chưa hỗ trợ nạp tồn đầu`);
    if (!whBy.has(r.warehouseCode)) missing.push(`kho ${r.warehouseCode}`);
  }
  for (const r of [...input.receivables, ...input.payables]) if (!partnerBy.has(r.partnerCode)) missing.push(`đối tác ${r.partnerCode}`);
  if (missing.length) throw new AppError("invalid_argument", `Tệp số dư có mã không hợp lệ: ${[...new Set(missing)].join("; ")}`);

  const adj = await createDocument(s, m, { docType: "ADJ", date, meta: { opening: true, note: "SỐ DƯ ĐẦU" } });
  const adjId = adj.id as string;

  const stockByAccount: Record<string, number> = {};
  for (const r of input.stock) {
    const it = itemBy.get(r.itemCode)!;
    await s`
      insert into stock_moves (tenant_id, move_date, item_id, warehouse_id, qty, unit_cost, document_id)
      values (${m.tenantId}, ${date}, ${it.id}, ${whBy.get(r.warehouseCode)!}, ${r.qty}, ${r.unitCost}, ${adjId})`;
    const acc = it.kind === "material" ? "152" : "156";
    stockByAccount[acc] = (stockByAccount[acc] ?? 0) + Math.round(r.qty * r.unitCost);
  }
  for (const r of input.receivables) {
    await s`insert into receivables (tenant_id, kind, document_id, partner_id, amount) values (${m.tenantId}, 'invoice', null, ${partnerBy.get(r.partnerCode)!}, ${r.amount})`;
  }
  for (const r of input.payables) {
    await s`insert into payables (tenant_id, document_id, partner_id, amount) values (${m.tenantId}, null, ${partnerBy.get(r.partnerCode)!}, ${r.amount})`;
  }
  const receivable = input.receivables.reduce((a, r) => a + r.amount, 0);
  const payable = input.payables.reduce((a, r) => a + r.amount, 0);
  const lines = postOpeningBalance({ stockByAccount, receivable, payable, c111: input.cash.c111, c112: input.cash.c112 });
  const entryId = await postEntry(s, m.tenantId, { date, documentId: adjId, memo: "Số dư đầu kỳ", lines });

  await s`update documents set meta = meta || ${s.json({ entryId, receivable, payable } as never)} where id = ${adjId} and tenant_id = ${m.tenantId}`;
  await setStatus(s, m, adjId, "confirmed", "Nạp số dư đầu kỳ");
  await setStatus(s, m, adjId, "done", "Đã nạp");
  const debit = lines.reduce((a, l) => a + l[1], 0);
  await audit(s, m.tenantId, m.displayName || m.userId, "opening.apply", adj.doc_no as string, `tổng ${formatMoney(debit)}; xoá mẫu ${sample.removedPartners}+${sample.removedItems}`);
  return { docId: adjId, docNo: adj.doc_no as string, entryId, totalDebit: debit, removedSample: sample };
}
