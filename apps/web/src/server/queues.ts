import { sql } from "./db";

/** Số việc theo 3 bộ phận (lô 3.6, playbook/03 mục C2) — MỘT câu SQL đếm phía server, không kéo bảng về client.
 * Công thức đúng như spec: tính từ documents / reservations / stock_moves / receipt_allocations của tenant. */
export type Queues = {
  sales: { quotePending: number; soDraft: number; soPending: number };
  warehouse: { toShip: number; toReceive: number; qcItems: number };
  accounting: { invDraft: number; unmatched: number; payPending: number };
};

export async function getQueues(tenantId: string): Promise<Queues> {
  const [r] = await sql<Record<string, string>[]>`
    select
      (select count(*) from documents where tenant_id = ${tenantId} and doc_type = 'QUOTE' and status = 'pending') as quote_pending,
      (select count(*) from documents where tenant_id = ${tenantId} and doc_type = 'SO' and status = 'draft') as so_draft,
      (select count(*) from documents where tenant_id = ${tenantId} and doc_type = 'SO' and status = 'pending') as so_pending,
      (select count(*) from documents d where d.tenant_id = ${tenantId} and d.doc_type = 'SO' and d.status in ('confirmed', 'partial')
         and exists (select 1 from reservations r where r.document_id = d.id and r.qty > 0)) as to_ship,
      (select count(*) from documents where tenant_id = ${tenantId} and doc_type = 'PO' and status in ('confirmed', 'partial')
         and coalesce(meta->>'receivedAll', 'false') <> 'true' and coalesce(meta->>'closedShort', 'false') <> 'true') as to_receive,
      (select count(*) from (
         select m.item_id from stock_moves m join warehouses w on w.id = m.warehouse_id and w.tenant_id = m.tenant_id
         where m.tenant_id = ${tenantId} and w.code = 'QC' group by m.item_id having sum(m.qty) > 0) q) as qc_items,
      (select count(*) from documents where tenant_id = ${tenantId} and doc_type = 'INV' and status = 'draft') as inv_draft,
      (select count(distinct receipt_id) from receipt_allocations where tenant_id = ${tenantId} and receivable_id is null and note = 'Ứng trước') as unmatched,
      (select count(*) from documents where tenant_id = ${tenantId} and doc_type = 'PAY' and status = 'pending') as pay_pending`;
  const n = (k: string) => Number(r[k]);
  return {
    sales: { quotePending: n("quote_pending"), soDraft: n("so_draft"), soPending: n("so_pending") },
    warehouse: { toShip: n("to_ship"), toReceive: n("to_receive"), qcItems: n("qc_items") },
    accounting: { invDraft: n("inv_draft"), unmatched: n("unmatched"), payPending: n("pay_pending") },
  };
}
