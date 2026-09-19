import type { TransactionSql } from "postgres";
import {
  AppError,
  addDays,
  approvalTaskText,
  docTax,
  docTotal,
  formatMoney,
  postVendorInvoice,
  type ApprovalEntry,
  type Role,
  type VendorInvoiceInput,
} from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { postEntry } from "./journal";

const today = () => new Date().toISOString().slice(0, 10);
const STOCK_KINDS = new Set(["goods", "material", "finished"]);

/** Người duyệt hoá đơn lệch / khoản chi lớn: kế toán trưởng; nếu chính người lập là kế toán trưởng thì lên giám đốc (không tự duyệt — AC-29). */
export const chiefChain = (creator: Role): Role[] => (creator === "chief_accountant" ? ["director"] : ["chief_accountant"]);

type PoLine = { line_no: number; item_id: string; qty: string; price: string; tax_pct: string; meta: unknown; kind: string; name: string };
type Match = { lineNo: number; qty: number; price: number; poPrice: number; kind: string; name: string };

/** Ghi hoá đơn nhà cung cấp, khớp ba bên (lô 3.3, AC-22/23) — port demo vendorInvoice.
 * - Hàng hoá/vật tư: số lượng hoá đơn (cộng dồn) KHÔNG vượt số đã nhận (AC-23: chưa có phiếu nhập → `state_invalid`, không phải trả).
 * - Giá lệch quá dung sai (hoặc dịch vụ vượt số lượng đơn mua) → hoá đơn `pending`, chuỗi [kế toán trưởng], ghi `matchNote`; duyệt → ghi sổ.
 * - Sạch → ghi sổ ngay: phải trả (sổ phụ `payables`) = net + thuế; bút toán CHỈ phần chênh + thuế (không ghi lại giá hàng đã ở GRN). */
export async function vendorInvoice(s: TransactionSql, m: Member, input: VendorInvoiceInput) {
  const [po] = await s`select * from documents where id = ${input.poId} and tenant_id = ${m.tenantId} and doc_type = 'PO' for update`;
  if (!po) throw new AppError("not_found", "Không tìm thấy đơn mua");
  if (!["confirmed", "partial", "done"].includes(po.status as string)) throw new AppError("state_invalid", "Đơn mua chưa xác nhận");
  const date = input.date ?? today();
  await assertPeriodOpen(s, m.tenantId, date);

  const dup = await s`
    select 1 from documents where tenant_id = ${m.tenantId} and doc_type = 'VINV' and partner_id = ${po.partner_id as string}
      and status <> 'cancelled' and meta->>'invoiceNo' = ${input.invoiceNo}`;
  if (dup.length) throw new AppError("duplicate", `Số hoá đơn ${input.invoiceNo} của nhà cung cấp này đã ghi rồi`);

  const poLines = await s<PoLine[]>`
    select l.line_no, l.item_id, l.qty, l.price, l.tax_pct, l.meta, i.kind, i.name
    from document_lines l join items i on i.id = l.item_id and i.tenant_id = l.tenant_id
    where l.document_id = ${input.poId} and l.tenant_id = ${m.tenantId} order by l.line_no`;
  const [t] = await s<{ settings: unknown }[]>`select settings from tenants where id = ${m.tenantId}`;
  const settings = asObj<{ tolerancePct?: number }>(t.settings);
  const tolerancePct = Number(settings.tolerancePct ?? 2);

  const matches: Match[] = [];
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const req of input.lines) {
    if (seen.has(req.lineNo)) throw new AppError("invalid_argument", `Dòng ${req.lineNo} khai 2 lần`);
    seen.add(req.lineNo);
    const pl = poLines.find((l) => l.line_no === req.lineNo);
    if (!pl) throw new AppError("invalid_argument", `Không có dòng ${req.lineNo} trong đơn mua`);
    const lm = asObj<{ received?: number; invoiced?: number }>(pl.meta ?? {});
    const invoiced = Number(lm.invoiced ?? 0);
    const poPrice = Number(pl.price);
    if (STOCK_KINDS.has(pl.kind)) {
      const received = Number(lm.received ?? 0);
      if (invoiced + req.qty > received + 1e-9) {
        throw new AppError(
          "state_invalid",
          received === 0
            ? `${pl.name}: chưa có phiếu nhập — không ghi hoá đơn mua được (no_receipt)`
            : `${pl.name}: hoá đơn ${invoiced + req.qty} vượt số đã nhận ${received} (no_receipt)`,
        );
      }
    } else if (invoiced + req.qty > Number(pl.qty) + 1e-9) {
      problems.push(`${pl.name}: số lượng hoá đơn ${invoiced + req.qty} vượt đơn mua ${Number(pl.qty)}`);
    }
    if (poPrice > 0 ? (Math.abs(req.price - poPrice) / poPrice) * 100 > tolerancePct : req.price > 0) {
      problems.push(`${pl.name}: giá hoá đơn ${formatMoney(req.price)} lệch giá đơn mua ${formatMoney(poPrice)} quá ${tolerancePct}%`);
    }
    matches.push({ lineNo: req.lineNo, qty: req.qty, price: req.price, poPrice, kind: pl.kind, name: pl.name });
  }

  const poNo = po.doc_no as string;
  const vinv = await createDocument(s, m, {
    docType: "VINV",
    date,
    partnerId: po.partner_id as string,
    lines: matches.map((x) => ({
      itemId: poLines.find((l) => l.line_no === x.lineNo)!.item_id,
      qty: x.qty,
      price: x.price,
      taxPct: input.lines.find((l) => l.lineNo === x.lineNo)?.taxPct ?? Number(poLines.find((l) => l.line_no === x.lineNo)!.tax_pct),
    })),
    meta: { poId: input.poId, poNo, invoiceNo: input.invoiceNo, date, matches },
  });
  const vinvId = vinv.id as string;
  await s`update documents set refs = ${s.json([poNo] as never)} where id = ${vinvId} and tenant_id = ${m.tenantId}`;
  await s`update documents set refs = ${s.json([...asObj<string[]>(po.refs ?? []), vinv.doc_no as string] as never)} where id = ${input.poId} and tenant_id = ${m.tenantId}`;

  if (problems.length) {
    const chain = chiefChain(m.role);
    const approvals: ApprovalEntry[] = [];
    await s`update documents set meta = meta || ${s.json({ chain, approvals, matchNote: problems.join("; ") } as never)} where id = ${vinvId} and tenant_id = ${m.tenantId}`;
    const pending = await setStatus(s, m, vinvId, "pending", "Lệch khi đối chiếu ba bên");
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, ${chain[0]}, ${approvalTaskText("VINV", pending.doc_no as string)}, ${vinvId})`;
    await audit(s, m.tenantId, m.displayName || m.userId, "vinv.pending", pending.doc_no as string, problems.join("; "));
    return pending;
  }
  return bookVendorInvoice(s, m, vinvId);
}

/** Ghi sổ hoá đơn mua: bút toán, khoản phải trả, cộng dồn `invoiced` trên dòng đơn mua. Gọi trực tiếp (hoá đơn sạch)
 * hoặc từ hook `afterConfirm['VINV']` sau khi kế toán trưởng duyệt lệch. */
export async function bookVendorInvoice(s: TransactionSql, m: Member, vinvId: string) {
  const [v] = await s`select * from documents where id = ${vinvId} and tenant_id = ${m.tenantId} and doc_type = 'VINV' for update`;
  if (!v) throw new AppError("not_found", "Không tìm thấy hoá đơn mua");
  if (!["draft", "confirmed"].includes(v.status as string)) throw new AppError("state_invalid", "Hoá đơn mua không ở trạng thái chờ ghi sổ");
  const meta = asObj<{ poId: string; date: string; matches: Match[] }>(v.meta);
  await assertPeriodOpen(s, m.tenantId, meta.date);
  await s`select 1 from documents where id = ${meta.poId} and tenant_id = ${m.tenantId} for update`;

  const poLines = await s<{ line_no: number; meta: unknown; tax_pct: string }[]>`
    select line_no, meta, tax_pct from document_lines where document_id = ${meta.poId} and tenant_id = ${m.tenantId}`;
  const lines = await s<{ qty: string; price: string; tax_pct: string }[]>`
    select qty, price, tax_pct from document_lines where document_id = ${vinvId} and tenant_id = ${m.tenantId}`;
  const mapped = lines.map((l) => ({ qty: Number(l.qty), price: Number(l.price), taxPct: Number(l.tax_pct) }));
  const net = docTotal(mapped);
  const tax = docTax(mapped);

  const adjByAccount: Record<string, number> = {};
  let serviceNet = 0;
  let cogsAdjustment = 0;
  for (const x of meta.matches) {
    const pl = poLines.find((l) => l.line_no === x.lineNo);
    const lm = asObj<{ received?: number; invoiced?: number }>(pl?.meta ?? {});
    if (STOCK_KINDS.has(x.kind)) {
      if (Number(lm.invoiced ?? 0) + x.qty > Number(lm.received ?? 0) + 1e-9) throw new AppError("state_invalid", `${x.name}: hoá đơn vượt số đã nhận (no_receipt)`);
      const adj = Math.round(x.qty * x.price) - Math.round(x.qty * x.poPrice);
      const acc = x.kind === "material" ? "152" : "156";
      adjByAccount[acc] = (adjByAccount[acc] ?? 0) + adj;
      cogsAdjustment += adj;
    } else {
      serviceNet += Math.round(x.qty * x.price);
    }
  }

  const [t] = await s<{ settings: unknown }[]>`select settings from tenants where id = ${m.tenantId}`;
  const terms = Number(asObj<{ terms?: number }>(t.settings).terms ?? 30);
  const due = addDays(meta.date, terms);
  const vNo = v.doc_no as string;

  await postEntry(s, m.tenantId, { date: meta.date, documentId: vinvId, memo: `Hoá đơn mua ${vNo}`, lines: postVendorInvoice({ adjByAccount, serviceNet, tax }) });
  await s`
    insert into payables (tenant_id, document_id, partner_id, amount, due_date)
    values (${m.tenantId}, ${vinvId}, ${v.partner_id as string}, ${net + tax}, ${due})`;
  for (const x of meta.matches) {
    const pl = poLines.find((l) => l.line_no === x.lineNo);
    const invoiced = Number(asObj<{ invoiced?: number }>(pl?.meta ?? {}).invoiced ?? 0) + x.qty;
    await s`
      update document_lines set meta = meta || ${s.json({ invoiced } as never)}
      where document_id = ${meta.poId} and tenant_id = ${m.tenantId} and line_no = ${x.lineNo}`;
  }
  await s`update documents set meta = meta || ${s.json({ net, tax, total: net + tax, due, cogsAdjustment } as never)} where id = ${vinvId} and tenant_id = ${m.tenantId}`;
  if (v.status === "draft") await setStatus(s, m, vinvId, "confirmed", "Khớp ba bên");
  const done = await setStatus(s, m, vinvId, "done", "Đã ghi phải trả");
  await s`update tasks set done = true where document_id = ${vinvId} and tenant_id = ${m.tenantId} and not done`;
  await audit(s, m.tenantId, m.displayName || m.userId, "vinv.book", vNo, `phải trả ${formatMoney(net + tax)}`);
  return done;
}
