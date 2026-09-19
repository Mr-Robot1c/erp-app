import type { TransactionSql } from "postgres";
import { AppError, convertQty, postDelivery, type DeliverInput } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { postEntry } from "./journal";
import { avgCost, lockItems, onHand } from "./stock";

const today = () => new Date().toISOString().slice(0, 10);

type OrderLine = {
  line_no: number;
  item_id: string;
  qty: string;
  price: string;
  tax_pct: string;
  meta: unknown;
  kind: string;
  tracking: string;
  uom: string;
  uom_factors: unknown;
  name: string;
};
type Planned = { line: OrderLine; qtyBase: number; cost: number; moves: { qty: number; lotNo?: string; serialNo?: string }[] };

/** Xuất kho + ký nhận (lô 2.4, AC-12/13/14/43) — port demo `deliver`. Đơn phải `confirmed`/`partial` (AC-13);
 * qty ≤ số đang giữ của dòng; hàng theo lô/serial phải khai đủ; quy đổi đơn vị về gốc (AC-43); trong MỘT giao dịch:
 * giảm giữ, ghi stock_move âm (giá vốn bình quân lúc xuất), phiếu xuất DO `done` (bằng chứng giao = xác nhận của kho +
 * meta.signedBy), bút toán 632/156, tạo hoá đơn NHÁP đúng dòng đã giao (doanh thu ghi theo NGÀY GIAO ở lô 2.5). */
export async function deliverOrder(s: TransactionSql, m: Member, input: DeliverInput) {
  const [so] = await s`
    select * from documents where id = ${input.orderId} and tenant_id = ${m.tenantId} and doc_type = 'SO' for update`;
  if (!so) throw new AppError("not_found", "Không tìm thấy đơn bán");
  if (!["confirmed", "partial"].includes(so.status as string)) {
    throw new AppError("state_invalid", "Đơn chưa xác nhận, không xuất được");
  }
  const date = input.date ?? today();
  await assertPeriodOpen(s, m.tenantId, date);

  const lines = await s<OrderLine[]>`
    select l.line_no, l.item_id, l.qty, l.price, l.tax_pct, l.meta, i.kind, i.tracking, i.uom, i.uom_factors, i.name
    from document_lines l join items i on i.id = l.item_id and i.tenant_id = l.tenant_id
    where l.document_id = ${input.orderId} and l.tenant_id = ${m.tenantId} order by l.line_no`;
  await lockItems(s, m.tenantId, lines.filter((l) => l.kind !== "service").map((l) => l.item_id));

  const reserved = new Map(
    (await s<{ line_no: number; qty: string }[]>`select line_no, qty from reservations where document_id = ${input.orderId}`).map((r) => [
      r.line_no,
      Number(r.qty),
    ]),
  );
  const [wh] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} order by code limit 1`;

  // 1) Kiểm hết trước, chưa ghi gì.
  const plan: Planned[] = [];
  const seen = new Set<number>();
  for (const req of input.lines) {
    if (seen.has(req.lineNo)) throw new AppError("invalid_argument", `Dòng ${req.lineNo} khai 2 lần`);
    seen.add(req.lineNo);
    const line = lines.find((l) => l.line_no === req.lineNo);
    if (!line) throw new AppError("invalid_argument", `Không có dòng ${req.lineNo} trong đơn`);

    let qtyBase: number;
    try {
      qtyBase = convertQty(req.qty, req.uom, line.uom, asObj<Record<string, number>>(line.uom_factors ?? {}));
    } catch (e) {
      throw new AppError("invalid_argument", (e as Error).message);
    }

    const delivered = Number(asObj<{ delivered?: number }>(line.meta ?? {}).delivered ?? 0);
    if (line.kind === "service") {
      if (qtyBase > Number(line.qty) - delivered) throw new AppError("state_invalid", `Dòng ${line.name}: vượt số lượng còn lại`);
      plan.push({ line, qtyBase, cost: 0, moves: [] });
      continue;
    }

    const held = reserved.get(line.line_no) ?? 0;
    if (qtyBase > held) throw new AppError("state_invalid", `Dòng ${line.name}: xuất ${qtyBase} vượt số đang giữ ${held}`);
    if ((await onHand(s, m.tenantId, line.item_id)) - qtyBase < 0) throw new AppError("stock_insufficient", `Không âm kho: ${line.name}`);

    let moves: Planned["moves"];
    if (line.tracking === "serial") {
      const serials = req.serials ?? [];
      if (serials.length !== qtyBase || new Set(serials).size !== serials.length) {
        throw new AppError("invalid_argument", `Dòng ${line.name}: phải khai đủ ${qtyBase} số serial, không trùng`);
      }
      moves = serials.map((sn) => ({ qty: -1, serialNo: sn }));
    } else if (line.tracking === "lot") {
      const lots = req.lots ?? [];
      if (Math.abs(lots.reduce((a, l) => a + l.qty, 0) - qtyBase) > 1e-9) {
        throw new AppError("invalid_argument", `Dòng ${line.name}: tổng số lượng các lô phải bằng ${qtyBase}`);
      }
      moves = lots.map((l) => ({ qty: -l.qty, lotNo: l.lotNo }));
    } else {
      moves = [{ qty: -qtyBase }];
    }
    plan.push({ line, qtyBase, cost: await avgCost(s, m.tenantId, line.item_id), moves });
  }
  if (!wh && plan.some((p) => p.moves.length)) throw new AppError("state_invalid", "Doanh nghiệp chưa có kho");

  // 2) Ghi.
  const soNo = so.doc_no as string;
  const cogs = plan.reduce((sum, p) => sum + p.qtyBase * p.cost, 0);
  const docLines = plan.map((p) => ({ itemId: p.line.item_id, qty: p.qtyBase, price: Number(p.line.price), taxPct: Number(p.line.tax_pct) }));

  const dO = await createDocument(s, m, {
    docType: "DO",
    date,
    partnerId: so.partner_id as string,
    extId: (so.ext_id as string | null) ?? null,
    lines: docLines,
    meta: { soId: input.orderId, soNo, signedBy: input.signedBy ?? m.displayName, cogs },
  });
  const doId = dO.id as string;
  const doNo = dO.doc_no as string;

  for (const p of plan) {
    for (const mv of p.moves) {
      await s`
        insert into stock_moves (tenant_id, move_date, item_id, warehouse_id, qty, unit_cost, document_id, lot_no, serial_no)
        values (${m.tenantId}, ${date}, ${p.line.item_id}, ${wh.id}, ${mv.qty}, ${p.cost}, ${doId}, ${mv.lotNo ?? null}, ${mv.serialNo ?? null})`;
    }
    if (p.line.kind !== "service") {
      const left = (reserved.get(p.line.line_no) ?? 0) - p.qtyBase; // check qty > 0: hết giữ thì xoá dòng giữ
      if (left > 0) await s`update reservations set qty = ${left} where document_id = ${input.orderId} and line_no = ${p.line.line_no}`;
      else await s`delete from reservations where document_id = ${input.orderId} and line_no = ${p.line.line_no}`;
    }
    const delivered = Number(asObj<{ delivered?: number }>(p.line.meta ?? {}).delivered ?? 0) + p.qtyBase;
    await s`
      update document_lines set meta = meta || ${s.json({ delivered } as never)}
      where document_id = ${input.orderId} and tenant_id = ${m.tenantId} and line_no = ${p.line.line_no}`;
    p.line.meta = { ...asObj<Record<string, unknown>>(p.line.meta ?? {}), delivered };
  }
  if (cogs) await postEntry(s, m.tenantId, { date, documentId: doId, memo: `Giá vốn ${doNo}`, lines: postDelivery(cogs) });

  await setStatus(s, m, doId, "confirmed", "Kho xuất hàng");
  await setStatus(s, m, doId, "done", input.signedBy ? `Khách ký nhận: ${input.signedBy}` : "Khách ký nhận");

  const allDone = lines.every((l) => {
    const p = plan.find((x) => x.line.line_no === l.line_no);
    const d = Number(asObj<{ delivered?: number }>((p?.line ?? l).meta ?? {}).delivered ?? 0);
    return d >= Number(l.qty);
  });
  if (so.status === "confirmed" && !allDone) await setStatus(s, m, input.orderId, "partial", "Giao một phần");
  await s`update documents set meta = meta || ${s.json({ deliveredAll: allDone } as never)} where id = ${input.orderId} and tenant_id = ${m.tenantId}`;

  const inv = await createDocument(s, m, {
    docType: "INV",
    date,
    partnerId: so.partner_id as string,
    extId: (so.ext_id as string | null) ?? null,
    lines: docLines,
    meta: { soId: input.orderId, soNo, doId, doNo, deliverDate: date },
  });
  const invNo = inv.doc_no as string;
  await s`update documents set refs = ${s.json([soNo, doNo] as never)} where id = ${inv.id as string} and tenant_id = ${m.tenantId}`;
  await s`update documents set refs = ${s.json([soNo, invNo] as never)} where id = ${doId} and tenant_id = ${m.tenantId}`;
  const soRefs = asObj<string[]>(so.refs ?? []);
  await s`update documents set refs = ${s.json([...soRefs, doNo, invNo] as never)} where id = ${input.orderId} and tenant_id = ${m.tenantId}`;

  await s`
    insert into tasks (tenant_id, role, text, document_id)
    values (${m.tenantId}, 'accountant', ${`Phát hành hoá đơn ${invNo} (mốc: ngày làm việc tiếp theo)`}, ${inv.id as string})`;
  if (allDone) {
    await s`update tasks set done = true where document_id = ${input.orderId} and role = 'warehouse' and not done and tenant_id = ${m.tenantId}`;
  }
  await audit(s, m.tenantId, m.displayName || m.userId, "order.deliver", soNo, `${doNo}, ${invNo}`);
  return { doId, doNo, invId: inv.id as string, invNo, deliveredAll: allDone };
}
