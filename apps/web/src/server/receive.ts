import type { TransactionSql } from "postgres";
import { AppError, postGrn, type ReceiveInput } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { assertPeriodOpen, createDocument, setStatus } from "./documents";
import { fulfil } from "./fulfil";
import { asObj } from "./json";
import { postEntry } from "./journal";
import { lockItems } from "./stock";

const today = () => new Date().toISOString().slice(0, 10);

type PoLine = {
  line_no: number;
  item_id: string;
  qty: string;
  price: string;
  tax_pct: string;
  meta: unknown;
  kind: string;
  tracking: string;
  inspect: boolean;
  name: string;
};

/** Nhận hàng theo đơn mua (lô 3.2, AC-11/21) — port demo receiveGoods. Nhập kho giá = giá đơn mua; phiếu nhập GRN `done`;
 * bút toán Nợ 156|152 / Có 331 (giá tạm — chênh giá hoá đơn xử lý ở lô 3.3); cộng dồn `received` trên dòng đơn mua;
 * lệch quá dung sai (khi nhận đủ hoặc đợt cuối `final`) → việc "Nhập lệch" cho mua hàng (AC-21); hàng cần kiểm vào kho QC;
 * đơn mua gắn đơn bán (forSO) → tự giữ cho đơn gốc, khả dụng KHÔNG tăng (AC-11). */
export async function receiveGoods(s: TransactionSql, m: Member, input: ReceiveInput) {
  const [po] = await s`
    select * from documents where id = ${input.poId} and tenant_id = ${m.tenantId} and doc_type = 'PO' for update`;
  if (!po) throw new AppError("not_found", "Không tìm thấy đơn mua");
  if (!["confirmed", "partial"].includes(po.status as string)) throw new AppError("state_invalid", "Đơn mua chưa xác nhận, chưa nhận hàng được");
  const poMeta = asObj<{ forSO?: string | null }>(po.meta);
  const date = input.date ?? today();
  await assertPeriodOpen(s, m.tenantId, date);
  // Thứ tự khoá THỐNG NHẤT với confirmOrder/deliver: đơn bán trước, mặt hàng sau — tránh deadlock chéo.
  const [forSo] = poMeta.forSO
    ? await s`select status from documents where id = ${poMeta.forSO} and tenant_id = ${m.tenantId} for update`
    : [];

  const lines = await s<PoLine[]>`
    select l.line_no, l.item_id, l.qty, l.price, l.tax_pct, l.meta, i.kind, i.tracking, i.inspect, i.name
    from document_lines l join items i on i.id = l.item_id and i.tenant_id = l.tenant_id
    where l.document_id = ${input.poId} and l.tenant_id = ${m.tenantId} order by l.line_no`;
  await lockItems(s, m.tenantId, lines.map((l) => l.item_id));

  const [main] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code <> 'QC' order by code limit 1`;
  const [qc] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code = 'QC'`;
  if (!main) throw new AppError("state_invalid", "Doanh nghiệp chưa có kho");

  const plan: { line: PoLine; qty: number; wh: string; moves: { qty: number; lotNo?: string; serialNo?: string }[] }[] = [];
  const seen = new Set<number>();
  for (const req of input.lines) {
    if (seen.has(req.lineNo)) throw new AppError("invalid_argument", `Dòng ${req.lineNo} khai 2 lần`);
    seen.add(req.lineNo);
    const line = lines.find((l) => l.line_no === req.lineNo);
    if (!line) throw new AppError("invalid_argument", `Không có dòng ${req.lineNo} trong đơn mua`);
    if (line.inspect && !qc) throw new AppError("state_invalid", "Chưa có kho chờ kiểm (QC)");

    let moves: { qty: number; lotNo?: string; serialNo?: string }[] = [{ qty: req.qty }];
    if (line.tracking === "serial") {
      const sn = req.serials ?? [];
      if (sn.length !== req.qty || new Set(sn).size !== sn.length) {
        throw new AppError("invalid_argument", `Dòng ${line.name}: phải khai đủ ${req.qty} số serial, không trùng`);
      }
      moves = sn.map((x) => ({ qty: 1, serialNo: x }));
    } else if (line.tracking === "lot") {
      const lots = req.lots ?? [];
      if (Math.abs(lots.reduce((a, l) => a + l.qty, 0) - req.qty) > 1e-9) {
        throw new AppError("invalid_argument", `Dòng ${line.name}: tổng số lượng các lô phải bằng ${req.qty}`);
      }
      moves = lots.map((l) => ({ qty: l.qty, lotNo: l.lotNo }));
    }
    plan.push({ line, qty: req.qty, wh: line.inspect ? qc.id : main.id, moves });
  }

  const [t] = await s<{ settings: unknown }[]>`select settings from tenants where id = ${m.tenantId}`;
  const tolerancePct = Number(asObj<{ tolerancePct?: number }>(t.settings).tolerancePct ?? 2);

  const poNo = po.doc_no as string;
  const grn = await createDocument(s, m, {
    docType: "GRN",
    date,
    partnerId: po.partner_id as string,
    extId: (po.ext_id as string | null) ?? null,
    lines: plan.map((p) => ({ itemId: p.line.item_id, qty: p.qty, price: Number(p.line.price), taxPct: Number(p.line.tax_pct) })),
    meta: { poId: input.poId, poNo, forSO: poMeta.forSO ?? null },
  });
  const grnId = grn.id as string;
  const grnNo = grn.doc_no as string;

  const byAcc: Record<string, number> = {};
  const variance: { lineNo: number; itemId: string; ordered: number; received: number; diff: number }[] = [];
  let anyQc = false;
  for (const p of plan) {
    for (const mv of p.moves) {
      await s`
        insert into stock_moves (tenant_id, move_date, item_id, warehouse_id, qty, unit_cost, document_id, lot_no, serial_no)
        values (${m.tenantId}, ${date}, ${p.line.item_id}, ${p.wh}, ${mv.qty}, ${Number(p.line.price)}, ${grnId}, ${mv.lotNo ?? null}, ${mv.serialNo ?? null})`;
    }
    if (p.line.inspect) anyQc = true;
    const acc = p.line.kind === "material" ? "152" : "156";
    byAcc[acc] = (byAcc[acc] ?? 0) + Math.round(p.qty * Number(p.line.price));

    const received = Number(asObj<{ received?: number }>(p.line.meta ?? {}).received ?? 0) + p.qty;
    await s`
      update document_lines set meta = meta || ${s.json({ received } as never)}
      where document_id = ${input.poId} and tenant_id = ${m.tenantId} and line_no = ${p.line.line_no}`;
    p.line.meta = { ...asObj<Record<string, unknown>>(p.line.meta ?? {}), received };

    const ordered = Number(p.line.qty);
    const diff = received - ordered;
    if ((received >= ordered || input.final) && (Math.abs(diff) / ordered) * 100 > tolerancePct) {
      variance.push({ lineNo: p.line.line_no, itemId: p.line.item_id, ordered, received, diff });
    }
  }
  await postEntry(s, m.tenantId, { date, documentId: grnId, memo: `Nhập kho ${grnNo}`, lines: postGrn(byAcc) });

  const receivedAll = lines.every((l) => {
    const p = plan.find((x) => x.line.line_no === l.line_no);
    return Number(asObj<{ received?: number }>((p?.line ?? l).meta ?? {}).received ?? 0) >= Number(l.qty);
  });
  await s`update documents set meta = meta || ${s.json({ variance, qc: anyQc, qcPassed: false } as never)} where id = ${grnId} and tenant_id = ${m.tenantId}`;
  await setStatus(s, m, grnId, "confirmed", "");
  const done = await setStatus(s, m, grnId, "done", "Đã nhập kho");

  if (po.status === "confirmed" && !receivedAll) await setStatus(s, m, input.poId, "partial", "Nhận một phần");
  await s`update documents set meta = meta || ${s.json({ receivedAll, closedShort: !receivedAll && !!input.final } as never)} where id = ${input.poId} and tenant_id = ${m.tenantId}`;
  const poRefs = asObj<string[]>(po.refs ?? []);
  await s`update documents set refs = ${s.json([poNo] as never)} where id = ${grnId} and tenant_id = ${m.tenantId}`;
  await s`update documents set refs = ${s.json([...poRefs, grnNo] as never)} where id = ${input.poId} and tenant_id = ${m.tenantId}`;

  if (variance.length) {
    const names = variance.map((v) => `${lines.find((l) => l.line_no === v.lineNo)?.name} lệch ${v.diff > 0 ? "+" : ""}${v.diff}`).join(", ");
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, 'purchasing', ${`Nhập lệch: ${names} (${grnNo})`}, ${grnId})`;
  }
  if (receivedAll || input.final) await s`update tasks set done = true where document_id = ${input.poId} and tenant_id = ${m.tenantId} and not done`;

  // Hàng về cho đơn bán gốc: tự giữ (khả dụng KHÔNG tăng vì hàng vừa nhập bị đơn gốc giữ ngay).
  if (poMeta.forSO && !anyQc) {
    if (forSo && ["confirmed", "partial"].includes(forSo.status as string)) {
      await fulfil(s, m, poMeta.forSO);
      await audit(s, m.tenantId, m.displayName || m.userId, "order.auto_reserve", poMeta.forSO, grnNo);
    }
  }
  await audit(s, m.tenantId, m.displayName || m.userId, "po.receive", poNo, grnNo);
  return done;
}

/** Kho chờ kiểm → kho chính (lô 3.2): đạt kiểm thì chuyển đúng số lượng của phiếu nhập sang kho chính (2 dòng ± cùng
 * giao dịch), rồi nếu hàng thuộc đơn bán gốc thì tự giữ. */
export async function passQc(s: TransactionSql, m: Member, grnId: string) {
  const [grn] = await s`
    select * from documents where id = ${grnId} and tenant_id = ${m.tenantId} and doc_type = 'GRN' for update`;
  if (!grn) throw new AppError("not_found", "Không tìm thấy phiếu nhập");
  const meta = asObj<{ qc?: boolean; qcPassed?: boolean; forSO?: string | null }>(grn.meta);
  if (!meta.qc) throw new AppError("state_invalid", "Phiếu nhập này không có hàng chờ kiểm");
  if (meta.qcPassed) throw new AppError("state_invalid", "Phiếu nhập đã chuyển kho chính");

  const [main] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code <> 'QC' order by code limit 1`;
  const [qc] = await s<{ id: string }[]>`select id from warehouses where tenant_id = ${m.tenantId} and code = 'QC'`;
  if (!main || !qc) throw new AppError("state_invalid", "Thiếu kho chính hoặc kho chờ kiểm");

  const [so] = meta.forSO ? await s`select status from documents where id = ${meta.forSO} and tenant_id = ${m.tenantId} for update` : []; // khoá đơn bán TRƯỚC mặt hàng
  const moves = await s<{ item_id: string; qty: string; unit_cost: string; lot_no: string | null; serial_no: string | null }[]>`
    select item_id, qty, unit_cost, lot_no, serial_no from stock_moves
    where tenant_id = ${m.tenantId} and document_id = ${grnId} and warehouse_id = ${qc.id}`;
  await lockItems(s, m.tenantId, moves.map((x) => x.item_id));
  for (const mv of moves) {
    await s`
      insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost, document_id, lot_no, serial_no)
      values (${m.tenantId}, ${mv.item_id}, ${qc.id}, ${-Number(mv.qty)}, ${mv.unit_cost}, ${grnId}, ${mv.lot_no}, ${mv.serial_no}),
             (${m.tenantId}, ${mv.item_id}, ${main.id}, ${Number(mv.qty)}, ${mv.unit_cost}, ${grnId}, ${mv.lot_no}, ${mv.serial_no})`;
  }
  await s`update documents set meta = meta || ${s.json({ qcPassed: true } as never)} where id = ${grnId} and tenant_id = ${m.tenantId}`;
  await audit(s, m.tenantId, m.displayName || m.userId, "grn.pass_qc", grn.doc_no as string);

  if (meta.forSO && so && ["confirmed", "partial"].includes(so.status as string)) await fulfil(s, m, meta.forSO);
  return { grnId, passed: moves.length };
}
