import type { TransactionSql } from "postgres";
import { AppError } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";
import { createDocument, setStatus } from "./documents";
import { asObj } from "./json";
import { available, lockItems } from "./stock";

type Shortage = { itemId: string; name: string; qty: number; kind: string; cost: number };

/** Số lượng đã được yêu cầu (PR/MO còn mở) cho đơn này — để đáp ứng lại không sinh trùng yêu cầu mua/lệnh SX. */
async function openRequested(s: TransactionSql, tenantId: string, soId: string, itemId: string): Promise<number> {
  const [r] = await s<{ v: string }[]>`
    select coalesce(sum(l.qty), 0) as v
    from documents d join document_lines l on l.document_id = d.id
    where d.tenant_id = ${tenantId} and d.doc_type in ('PR', 'MO') and d.status in ('confirmed', 'partial')
      and d.meta->>'forSO' = ${soId} and l.item_id = ${itemId}`;
  return Number(r.v);
}

/** Đáp ứng đơn bán (lô 2.3, AC-10) — port demo `fulfil`: mỗi dòng hàng lấy phần khả dụng để GIỮ; phần thiếu:
 * hàng mua ngoài → gom 1 yêu cầu mua (PR) gắn đơn + việc cho mua hàng; thành phẩm → lệnh sản xuất (MO) + việc cho
 * kho/xưởng. Khoá mặt hàng đầu giao dịch nên 2 đơn cùng giành món cuối chỉ 1 đơn giữ được. */
export async function fulfil(s: TransactionSql, m: Member, orderId: string) {
  const [so] = await s`
    select * from documents where id = ${orderId} and tenant_id = ${m.tenantId} and doc_type = 'SO'`;
  if (!so) throw new AppError("not_found", "Không tìm thấy đơn bán");
  const soNo = so.doc_no as string;

  const lines = await s<{ line_no: number; item_id: string; qty: string; meta: unknown; kind: string; cost: string; name: string }[]>`
    select l.line_no, l.item_id, l.qty, l.meta, i.kind, i.cost, i.name
    from document_lines l join items i on i.id = l.item_id and i.tenant_id = l.tenant_id
    where l.document_id = ${orderId} and l.tenant_id = ${m.tenantId} order by l.line_no`;

  await lockItems(s, m.tenantId, lines.filter((l) => l.kind !== "service").map((l) => l.item_id));

  const reserved = new Map(
    (await s<{ line_no: number; qty: string }[]>`select line_no, qty from reservations where document_id = ${orderId}`).map((r) => [
      r.line_no,
      Number(r.qty),
    ]),
  );

  const shortages: Shortage[] = [];
  for (const l of lines) {
    if (l.kind === "service") continue; // dịch vụ không giữ tồn
    const delivered = Number(asObj<{ delivered?: number }>(l.meta ?? {}).delivered ?? 0);
    const need = Number(l.qty) - delivered - (reserved.get(l.line_no) ?? 0);
    if (need <= 0) continue;

    const take = Math.min(Math.max(0, await available(s, m.tenantId, l.item_id)), need);
    if (take > 0) {
      await s`
        insert into reservations (tenant_id, document_id, line_no, item_id, qty)
        values (${m.tenantId}, ${orderId}, ${l.line_no}, ${l.item_id}, ${take})
        on conflict (document_id, line_no) do update set qty = reservations.qty + excluded.qty`;
    }
    const rest = need - take;
    if (rest > 0) {
      const missing = rest - (await openRequested(s, m.tenantId, orderId, l.item_id));
      if (missing > 0) shortages.push({ itemId: l.item_id, name: l.name, qty: missing, kind: l.kind, cost: Number(l.cost) });
    }
  }

  const refs: string[] = [];
  const buy = shortages.filter((x) => x.kind !== "finished");
  if (buy.length) {
    const pr = await createDocument(s, m, {
      docType: "PR",
      lines: buy.map((x) => ({ itemId: x.itemId, qty: x.qty, price: x.cost, taxPct: 0 })),
      meta: { forSO: orderId, forSONo: soNo },
    });
    await s`update documents set refs = ${s.json([soNo] as never)} where id = ${pr.id as string} and tenant_id = ${m.tenantId}`;
    await setStatus(s, m, pr.id as string, "confirmed", `Tự sinh từ ${soNo}`);
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, 'purchasing', ${`Mua ${buy.map((x) => `${x.qty} ${x.name}`).join(", ")} cho ${soNo}`}, ${pr.id as string})`;
    refs.push(pr.doc_no as string);
  }
  for (const x of shortages.filter((y) => y.kind === "finished")) {
    const mo = await createDocument(s, m, {
      docType: "MO",
      lines: [{ itemId: x.itemId, qty: x.qty, price: x.cost, taxPct: 0 }],
      meta: { forSO: orderId, forSONo: soNo },
    });
    await s`update documents set refs = ${s.json([soNo] as never)} where id = ${mo.id as string} and tenant_id = ${m.tenantId}`;
    await setStatus(s, m, mo.id as string, "confirmed", `Tự sinh từ ${soNo}`);
    await s`
      insert into tasks (tenant_id, role, text, document_id)
      values (${m.tenantId}, 'warehouse', ${`Sản xuất ${x.qty} ${x.name} cho ${soNo}`}, ${mo.id as string})`;
    refs.push(mo.doc_no as string);
  }

  if (refs.length) {
    const soRefs = asObj<string[]>(so.refs ?? []);
    await s`update documents set refs = ${s.json([...soRefs, ...refs] as never)} where id = ${orderId} and tenant_id = ${m.tenantId}`;
    await audit(s, m.tenantId, m.displayName || m.userId, "order.fulfil", soNo, `thiếu hàng → ${refs.join(", ")}`);
  }
  return { shortages: shortages.map((x) => ({ itemId: x.itemId, qty: x.qty })), created: refs };
}
