import { AppError, canView, salesOrderStatusLabel, type DocStatus, type Role } from "@erp/core";
import { asObj } from "./json";
import { sql } from "./db";

export type SalesOrderStatus = {
  record_id: string;
  status_code: DocStatus;
  status_label_vi: string;
  fulfillment_status_label_vi?: string;
  updated_at?: string;
};

export type SalesOrderView = SalesOrderStatus & {
  customer: { display_name: string };
  totals: { subtotal_vnd: string; tax_vnd: string; grand_total_vnd: string; currency: "VND" };
  items: Array<{
    product_name: string;
    quantity: string;
    unit: string;
    unit_price_vnd: string;
    line_subtotal_vnd: string;
  }>;
  item_count: number;
  items_truncated: boolean;
  order_date: string;
};

type Queryable = <T extends unknown[]>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;

async function authorizeSalesStaff(tenantId: string, staffUserId: string, db: Queryable) {
  if (!tenantId || !staffUserId) throw new AppError("forbidden", "Bạn không có quyền xem thông tin đơn bán này.");
  const [member] = await db<{ role: Role }[]>`
    select role from memberships where tenant_id = ${tenantId} and user_id = ${staffUserId}`;
  if (!member || !canView(member.role, "sales")) {
    throw new AppError("forbidden", "Bạn không có quyền xem thông tin đơn bán này.");
  }
}

/** Read-only, tenant-scoped projection used by the AI bridge. */
export async function getSalesOrderStatusForStaff(
  tenantId: string,
  staffUserId: string,
  recordId: string,
  db: Queryable = sql as unknown as Queryable,
): Promise<SalesOrderStatus> {
  await authorizeSalesStaff(tenantId, staffUserId, db);

  const [doc] = await db<{ doc_no: string; status: DocStatus; meta: unknown; updated_at: Date | string | null }[]>`
    select d.doc_no, d.status, d.meta,
      (select max(h.at) from doc_status_history h
       where h.tenant_id = d.tenant_id and h.document_id = d.id) as updated_at
    from documents d
    where d.tenant_id = ${tenantId} and d.doc_type = 'SO' and d.doc_no = ${recordId}
    limit 1`;
  if (!doc) throw new AppError("not_found", "Không tìm thấy đơn bán trong doanh nghiệp hiện tại.");

  const deliveredAll = Boolean(asObj<{ deliveredAll?: boolean }>(doc.meta).deliveredAll);
  const result: SalesOrderStatus = {
    record_id: doc.doc_no,
    status_code: doc.status,
    status_label_vi: salesOrderStatusLabel(doc.status, deliveredAll),
  };
  if (deliveredAll) result.fulfillment_status_label_vi = "Đã giao";
  else if (doc.status === "partial") result.fulfillment_status_label_vi = "Đã giao một phần";
  else if (doc.status === "confirmed") result.fulfillment_status_label_vi = "Chờ xuất kho";
  if (doc.updated_at) result.updated_at = new Date(doc.updated_at).toISOString();
  return result;
}

const MAX_AI_ORDER_LINES = 50;

/** Normalized read model for employee questions about the current sales order.
 * Money is calculated by PostgreSQL from numeric columns and returned as integer-decimal strings. */
export async function getSalesOrderForStaff(
  tenantId: string,
  staffUserId: string,
  recordId: string,
  db: Queryable = sql as unknown as Queryable,
): Promise<SalesOrderView> {
  await authorizeSalesStaff(tenantId, staffUserId, db);
  const [doc] = await db<{
    id: string; doc_no: string; doc_date: Date | string; status: DocStatus; meta: unknown;
    customer_name: string; item_count: string; subtotal: string; tax: string; grand_total: string;
    updated_at: Date | string | null;
  }[]>`
    select d.id, d.doc_no, d.doc_date, d.status, d.meta, p.name as customer_name,
      count(l.id)::text as item_count,
      coalesce(sum(round(l.qty * l.price)), 0)::text as subtotal,
      coalesce(sum(round(round(l.qty * l.price) * l.tax_pct / 100)), 0)::text as tax,
      coalesce(sum(round(l.qty * l.price) + round(round(l.qty * l.price) * l.tax_pct / 100)), 0)::text as grand_total,
      (select max(h.at) from doc_status_history h
       where h.tenant_id = d.tenant_id and h.document_id = d.id) as updated_at
    from documents d
    join partners p on p.tenant_id = d.tenant_id and p.id = d.partner_id
    left join document_lines l on l.tenant_id = d.tenant_id and l.document_id = d.id
    where d.tenant_id = ${tenantId} and d.doc_type = 'SO' and d.doc_no = ${recordId}
    group by d.id, d.doc_no, d.doc_date, d.status, d.meta, p.name
    limit 1`;
  if (!doc) throw new AppError("not_found", "Không tìm thấy đơn bán trong doanh nghiệp hiện tại.");

  const lines = await db<{
    product_name: string; quantity: string; unit: string; unit_price: string; line_subtotal: string;
  }[]>`
    select i.name as product_name, l.qty::text as quantity, i.uom as unit,
      l.price::text as unit_price, round(l.qty * l.price)::text as line_subtotal
    from document_lines l
    join items i on i.tenant_id = l.tenant_id and i.id = l.item_id
    where l.tenant_id = ${tenantId} and l.document_id = ${doc.id}
    order by l.line_no
    limit ${MAX_AI_ORDER_LINES}`;

  const deliveredAll = Boolean(asObj<{ deliveredAll?: boolean }>(doc.meta).deliveredAll);
  const result: SalesOrderView = {
    record_id: doc.doc_no,
    order_date: new Date(doc.doc_date).toISOString().slice(0, 10),
    status_code: doc.status,
    status_label_vi: salesOrderStatusLabel(doc.status, deliveredAll),
    customer: { display_name: doc.customer_name },
    totals: {
      subtotal_vnd: doc.subtotal,
      tax_vnd: doc.tax,
      grand_total_vnd: doc.grand_total,
      currency: "VND",
    },
    items: lines.map((line) => ({
      product_name: line.product_name,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_vnd: line.unit_price,
      line_subtotal_vnd: line.line_subtotal,
    })),
    item_count: Number(doc.item_count),
    items_truncated: Number(doc.item_count) > lines.length,
  };
  if (deliveredAll) result.fulfillment_status_label_vi = "Đã giao";
  else if (doc.status === "partial") result.fulfillment_status_label_vi = "Đã giao một phần";
  else if (doc.status === "confirmed") result.fulfillment_status_label_vi = "Chờ xuất kho";
  if (doc.updated_at) result.updated_at = new Date(doc.updated_at).toISOString();
  return result;
}
