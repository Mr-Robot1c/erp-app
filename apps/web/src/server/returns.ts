import type { TransactionSql } from "postgres";
import {
  AppError,
  docTax,
  docTotal,
  formatMoney,
  postPurchaseReturn,
  postSalesReturn,
  type PurchaseReturnInput,
  type SalesReturnInput,
} from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { postEntry } from "./journal";
import { avgCost, lockItems } from "./stock";

const today = () => new Date().toISOString().slice(0, 10);

/** Trả hàng bán (lô 3.5, AC-27). Hoá đơn gốc đã phát hành → sinh hoá đơn điều chỉnh (`INV` meta.kind='credit_note', dòng SỐ ÂM, tham chiếu
 * hoá đơn gốc); hàng nhập lại kho (tốt → kho chính, lỗi → kho chờ kiểm QC) theo GIÁ VỐN đã xuất; bút toán đảo 511/3331/131 + 156/632;
 * giá trị trả: giảm khoản phải thu còn mở của hoá đơn gốc, phần đã thu (dư) → tiền ứng trước của khách. Hàng theo lô/serial: chưa hỗ trợ.
 * (Quyết định: dòng tồn gắn thẳng vào hoá đơn điều chỉnh, không sinh thêm phiếu nhập riêng.) */
export async function salesReturn(s: TransactionSql, m: Member, input: SalesReturnInput) {
  const [inv] = await s`select * from documents where id = ${input.invoiceId} and tenant_id = ${m.tenantId} and doc_type = 'INV' for update`;
  if (!inv) throw new AppError("not_found", "Không tìm thấy hoá đơn");
  const meta = asObj<{ soId?: string; kind?: string }>(inv.meta);
  if (meta.kind === "credit_note") throw new AppError("state_invalid", "Không trả hàng trên hoá đơn điều chỉnh");
  if (inv.status !== "done") throw new AppError("state_invalid", "Hoá đơn chưa phát hành — chưa trả hàng được");
  const date = today();
  await assertPeriodOpen(s, m.tenantId, date);

  // Thứ tự khoá thống nhất: đơn bán → khách → mặt hàng.
  if (meta.soId) await s`select 1 from documents where id = ${meta.soId} and tenant_id = ${m.tenantId} for update`;
  await s`select 1 from partners where id = ${inv.partner_id as string} and tenant_id = ${m.tenantId} for update`;

  const lines = await s<{ line_no: number; item_id: string; qty: string; price: string; tax_pct: string; meta: unknown; kind: string; tracking: string; name: string }[]>`
    select l.line_no, l.item_id, l.qty, l.price, l.tax_pct, l.meta, i.kind, i.tracking, i.name
    from document_lines l join items i on i.id = l.item_id and i.tenant_id = l.tenant_id
    where l.document_id = ${input.invoiceId} and l.tenant_id = ${m.tenantId} order by l.line_no`;
  await lockItems(s, m.tenantId, lines.map((l) => l.item_id));

  const picked: { line: (typeof lines)[number]; qty: number; cost: number }[] = [];
  const seen = new Set<number>();
  for (const req of input.lines) {
    if (seen.has(req.lineNo)) throw new AppError("invalid_argument", `Dòng ${req.lineNo} khai 2 lần`);
    seen.add(req.lineNo);
    const line = lines.find((l) => l.line_no === req.lineNo);
    if (!line) throw new AppError("invalid_argument", `Không có dòng ${req.lineNo} trong hoá đơn`);
    if (line.kind === "service") throw new AppError("invalid_argument", `${line.name}: dịch vụ không trả hàng được`);
    if (line.tracking !== "none") throw new AppError("invalid_argument", `${line.name}: hàng theo lô/serial chưa hỗ trợ trả hàng`);
    const returned = Number(asObj<{ returned?: number }>(line.meta ?? {}).returned ?? 0);
    if (returned + req.qty > Number(line.qty) + 1e-9) {
      throw new AppError("invalid_argument", `${line.name}: trả ${returned + req.qty} vượt số đã bán ${Number(line.qty)}`);
    }
    // Giá vốn để đảo: bình quân các lần xuất của đơn bán gốc; không tìm được thì giá vốn bình quân hiện tại.
    const [out] = meta.soId
      ? await s<{ q: string; v: string }[]>`
          select coalesce(sum(-m.qty), 0) as q, coalesce(sum(-m.qty * m.unit_cost), 0) as v
          from stock_moves m join documents d on d.id = m.document_id and d.tenant_id = m.tenant_id
          where m.tenant_id = ${m.tenantId} and m.item_id = ${line.item_id} and m.qty < 0
            and d.doc_type = 'DO' and d.meta->>'soId' = ${meta.soId}`
      : [{ q: "0", v: "0" }];
    const cost = Number(out.q) > 0 ? Math.round(Number(out.v) / Number(out.q)) : await avgCost(s, m.tenantId, line.item_id);
    picked.push({ line, qty: req.qty, cost });
  }

  const mapped = picked.map((p) => ({ qty: p.qty, price: Number(p.line.price), taxPct: Number(p.line.tax_pct) }));
  const net = docTotal(mapped);
  const tax = docTax(mapped);
  const cogs = picked.reduce((a, p) => a + Math.round(p.qty * p.cost), 0);
  const value = net + tax;

  const [main] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code <> 'QC' order by code limit 1`;
  const [qc] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code = 'QC'`;
  const wh = input.condition === "good" ? main : qc;
  if (!wh) throw new AppError("state_invalid", input.condition === "good" ? "Doanh nghiệp chưa có kho" : "Chưa có kho chờ kiểm (QC) cho hàng lỗi");

  const invNo = inv.doc_no as string;
  const cn = await createDocument(s, m, {
    docType: "INV",
    date,
    partnerId: inv.partner_id as string,
    lines: picked.map((p) => ({ itemId: p.line.item_id, qty: -p.qty, price: Number(p.line.price), taxPct: Number(p.line.tax_pct) })),
    meta: { kind: "credit_note", origInvId: input.invoiceId, origInvNo: invNo, condition: input.condition, net: -net, tax: -tax, total: -value },
  });
  const cnId = cn.id as string;
  await s`update documents set refs = ${s.json([invNo] as never)} where id = ${cnId} and tenant_id = ${m.tenantId}`;
  for (const p of picked) {
    await s`
      insert into stock_moves (tenant_id, move_date, item_id, warehouse_id, qty, unit_cost, document_id)
      values (${m.tenantId}, ${date}, ${p.line.item_id}, ${wh.id}, ${p.qty}, ${p.cost}, ${cnId})`;
    await s`
      update document_lines set meta = meta || ${s.json({ returned: Number(asObj<{ returned?: number }>(p.line.meta ?? {}).returned ?? 0) + p.qty } as never)}
      where document_id = ${input.invoiceId} and tenant_id = ${m.tenantId} and line_no = ${p.line.line_no}`;
  }
  await postEntry(s, m.tenantId, { date, documentId: cnId, memo: `Trả hàng bán ${cn.doc_no as string} (${invNo})`, lines: postSalesReturn(net, tax, cogs) });

  // Giá trị hoàn: giảm khoản phải thu còn mở của hoá đơn gốc; phần khách đã trả → tiền ứng trước.
  const [rec] = await s<{ id: string; amount: string; paid: string }[]>`
    select id, amount, paid from receivables where tenant_id = ${m.tenantId} and kind = 'invoice' and document_id = ${input.invoiceId} for update`;
  const open = rec ? Number(rec.amount) - Number(rec.paid) : 0;
  const reduce = Math.min(value, open);
  if (reduce > 0) await s`update receivables set amount = amount - ${reduce} where id = ${rec.id}`;
  const toAdvance = value - reduce;
  if (toAdvance > 0) {
    await s`
      insert into partner_advances (tenant_id, partner_id, amount) values (${m.tenantId}, ${inv.partner_id as string}, ${toAdvance})
      on conflict (tenant_id, partner_id) do update set amount = partner_advances.amount + excluded.amount`;
    await s`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note) values (${m.tenantId}, ${cnId}, null, ${toAdvance}, 'Hoàn trả hàng')`;
  }
  await s`update documents set meta = meta || ${s.json({ reducedReceivable: reduce, toAdvance } as never)} where id = ${cnId} and tenant_id = ${m.tenantId}`;

  await setStatus(s, m, cnId, "confirmed", "Trả hàng");
  const done = await setStatus(s, m, cnId, "done", `Hoàn ${formatMoney(value)}`);
  await audit(s, m.tenantId, m.displayName || m.userId, "sales.return", cn.doc_no as string, `${invNo}: ${formatMoney(value)}`);
  return done;
}

/** Trả hàng mua (lô 3.5) — chiều ngược nhận hàng: xuất khỏi kho chính theo GIÁ ĐƠN MUA, phiếu `VINV` meta.kind='debit_note' (dòng âm), bút toán
 * Nợ 331 / Có 156|152, giảm khoản phải trả còn mở của nhà cung cấp (phần còn lại ghi `refundDue` — NCC còn nợ lại). Thuế đầu vào của hoá đơn đã ghi:
 * xử lý ở GĐ4. Hàng theo lô/serial: chưa hỗ trợ. */
export async function purchaseReturn(s: TransactionSql, m: Member, input: PurchaseReturnInput) {
  const [po] = await s`select * from documents where id = ${input.poId} and tenant_id = ${m.tenantId} and doc_type = 'PO' for update`;
  if (!po) throw new AppError("not_found", "Không tìm thấy đơn mua");
  const date = today();
  await assertPeriodOpen(s, m.tenantId, date);
  await s`select 1 from partners where id = ${po.partner_id as string} and tenant_id = ${m.tenantId} for update`;

  const lines = await s<{ line_no: number; item_id: string; qty: string; price: string; meta: unknown; kind: string; tracking: string; name: string }[]>`
    select l.line_no, l.item_id, l.qty, l.price, l.meta, i.kind, i.tracking, i.name
    from document_lines l join items i on i.id = l.item_id and i.tenant_id = l.tenant_id
    where l.document_id = ${input.poId} and l.tenant_id = ${m.tenantId} order by l.line_no`;
  await lockItems(s, m.tenantId, lines.map((l) => l.item_id));
  const [main] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code <> 'QC' order by code limit 1`;
  if (!main) throw new AppError("state_invalid", "Doanh nghiệp chưa có kho");

  const picked: { line: (typeof lines)[number]; qty: number }[] = [];
  const seen = new Set<number>();
  for (const req of input.lines) {
    if (seen.has(req.lineNo)) throw new AppError("invalid_argument", `Dòng ${req.lineNo} khai 2 lần`);
    seen.add(req.lineNo);
    const line = lines.find((l) => l.line_no === req.lineNo);
    if (!line) throw new AppError("invalid_argument", `Không có dòng ${req.lineNo} trong đơn mua`);
    if (line.kind === "service") throw new AppError("invalid_argument", `${line.name}: dịch vụ không trả hàng được`);
    if (line.tracking !== "none") throw new AppError("invalid_argument", `${line.name}: hàng theo lô/serial chưa hỗ trợ trả hàng`);
    const lm = asObj<{ received?: number; returned?: number }>(line.meta ?? {});
    const returned = Number(lm.returned ?? 0);
    if (returned + req.qty > Number(lm.received ?? 0) + 1e-9) {
      throw new AppError("invalid_argument", `${line.name}: trả ${returned + req.qty} vượt số đã nhận ${Number(lm.received ?? 0)}`);
    }
    const [{ v }] = await s<{ v: string }[]>`
      select coalesce(sum(qty), 0) as v from stock_moves where tenant_id = ${m.tenantId} and item_id = ${line.item_id} and warehouse_id = ${main.id}`;
    if (Number(v) < req.qty) throw new AppError("state_invalid", `${line.name}: kho chỉ còn ${Number(v)}, không trả được ${req.qty}`);
    picked.push({ line, qty: req.qty });
  }

  const byAcc: Record<string, number> = {};
  let value = 0;
  for (const p of picked) {
    const amt = Math.round(p.qty * Number(p.line.price));
    value += amt;
    const acc = p.line.kind === "material" ? "152" : "156";
    byAcc[acc] = (byAcc[acc] ?? 0) + amt;
  }
  const dn = await createDocument(s, m, {
    docType: "VINV",
    date,
    partnerId: po.partner_id as string,
    lines: picked.map((p) => ({ itemId: p.line.item_id, qty: -p.qty, price: Number(p.line.price), taxPct: 0 })),
    meta: { kind: "debit_note", poId: input.poId, poNo: po.doc_no, total: -value },
  });
  const dnId = dn.id as string;
  await s`update documents set refs = ${s.json([po.doc_no as string] as never)} where id = ${dnId} and tenant_id = ${m.tenantId}`;
  for (const p of picked) {
    await s`
      insert into stock_moves (tenant_id, move_date, item_id, warehouse_id, qty, unit_cost, document_id)
      values (${m.tenantId}, ${date}, ${p.line.item_id}, ${main.id}, ${-p.qty}, ${Number(p.line.price)}, ${dnId})`;
    await s`
      update document_lines set meta = meta || ${s.json({ returned: Number(asObj<{ returned?: number }>(p.line.meta ?? {}).returned ?? 0) + p.qty } as never)}
      where document_id = ${input.poId} and tenant_id = ${m.tenantId} and line_no = ${p.line.line_no}`;
  }
  for (const [acc, amt] of Object.entries(byAcc)) {
    await postEntry(s, m.tenantId, { date, documentId: dnId, memo: `Trả hàng mua ${dn.doc_no as string}`, lines: postPurchaseReturn(amt, acc) });
  }

  // Giảm khoản phải trả còn mở của nhà cung cấp (theo hạn tăng dần).
  const open = await s<{ id: string; amount: string; paid: string }[]>`
    select id, amount, paid from payables where tenant_id = ${m.tenantId} and partner_id = ${po.partner_id as string} and amount - paid > 0
    order by due_date asc nulls last, created_at for update`;
  let left = value;
  for (const p of open) {
    if (left <= 0) break;
    const cut = Math.min(left, Number(p.amount) - Number(p.paid));
    await s`update payables set amount = amount - ${cut} where id = ${p.id}`;
    left -= cut;
  }
  await s`update documents set meta = meta || ${s.json({ reducedPayable: value - left, refundDue: left } as never)} where id = ${dnId} and tenant_id = ${m.tenantId}`;

  await setStatus(s, m, dnId, "confirmed", "Trả hàng mua");
  const done = await setStatus(s, m, dnId, "done", `Giảm phải trả ${formatMoney(value - left)}`);
  await audit(s, m.tenantId, m.displayName || m.userId, "purchase.return", dn.doc_no as string, `${po.doc_no as string}: ${formatMoney(value)}`);
  return done;
}
