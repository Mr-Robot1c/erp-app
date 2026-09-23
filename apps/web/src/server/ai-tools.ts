import { AppError } from "@erp/core";
import { authorizeStaffMember, type Queryable } from "./ai-bridge";
import { sql } from "./db";

export type StockStatus = {
  item: { code: string; name: string };
  on_hand: number;
  reserved: number;
  available: number;
  warehouses: Array<{ code: string; qty: number }>;
};

/** Read-only, tenant-scoped stock lookup for the AI bridge (CB-2.2). `on_hand`/`available`
 * exclude kho QC (chờ kiểm, chưa dùng được) — same rule as `v_available` / the Kho screen. */
export async function getStockStatusForStaff(
  tenantId: string,
  staffUserId: string,
  itemCode: string,
  db: Queryable = sql as unknown as Queryable,
): Promise<StockStatus> {
  await authorizeStaffMember(tenantId, staffUserId, db);

  const [item] = await db<{ id: string; code: string; name: string }[]>`
    select id, code, name from items
    where tenant_id = ${tenantId} and upper(code) = upper(${itemCode})
    limit 1`;
  if (!item) throw new AppError("not_found", "Không tìm thấy mã hàng trong hệ thống.");

  const [avail] = await db<{ on_hand: string; reserved: string; available: string }[]>`
    select on_hand, reserved, available from v_available
    where tenant_id = ${tenantId} and item_id = ${item.id}`;

  const warehouses = await db<{ code: string; qty: string }[]>`
    select w.code, o.qty from v_on_hand o
    join warehouses w on w.id = o.warehouse_id and w.tenant_id = o.tenant_id
    where o.tenant_id = ${tenantId} and o.item_id = ${item.id} and o.qty <> 0
    order by w.code`;

  return {
    item: { code: item.code, name: item.name },
    on_hand: Number(avail?.on_hand ?? 0),
    reserved: Number(avail?.reserved ?? 0),
    available: Number(avail?.available ?? 0),
    warehouses: warehouses.map((w) => ({ code: w.code, qty: Number(w.qty) })),
  };
}

type ItemKind = "goods" | "service" | "material" | "finished";

export type ItemsListRow = { code: string; name: string; kind: string; on_hand: number; available: number };
export type ItemsList = { items: ItemsListRow[]; total_matching: number; truncated: boolean };

const ITEMS_LIST_LIMIT = 20;

/** Read-only item search for the AI bridge (CB-2.2): free-text (name/code), optional kind filter,
 * optional "tồn dưới N" filter on `on_hand` (physical stock, matches the Kho screen's "Tồn" column
 * — not `available`, which also nets out reservations the asker usually doesn't mean). */
export async function getItemsListForStaff(
  tenantId: string,
  staffUserId: string,
  opts: { query?: string; kind?: ItemKind; lowStockThreshold?: number },
  db: Queryable = sql as unknown as Queryable,
): Promise<ItemsList> {
  await authorizeStaffMember(tenantId, staffUserId, db);
  const like = opts.query?.trim() ? `%${opts.query.trim()}%` : null;

  const rows = await db<{ code: string; name: string; kind: string; on_hand: string; available: string }[]>`
    select i.code, i.name, i.kind, coalesce(a.on_hand, 0) as on_hand, coalesce(a.available, 0) as available
    from items i
    left join v_available a on a.tenant_id = i.tenant_id and a.item_id = i.id
    where i.tenant_id = ${tenantId}
      ${opts.kind ? sql`and i.kind = ${opts.kind}` : sql``}
      ${like ? sql`and (i.name ilike ${like} or i.code ilike ${like})` : sql``}
      ${opts.lowStockThreshold != null ? sql`and coalesce(a.on_hand, 0) < ${opts.lowStockThreshold}` : sql``}
    order by i.name`;

  return {
    items: rows.slice(0, ITEMS_LIST_LIMIT).map((r) => ({
      code: r.code, name: r.name, kind: r.kind, on_hand: Number(r.on_hand), available: Number(r.available),
    })),
    total_matching: rows.length,
    truncated: rows.length > ITEMS_LIST_LIMIT,
  };
}

type DebtKind = "receivable" | "payable";
export type PartnerDebt = {
  partner: { code: string; name: string };
  kind: DebtKind;
  total_open: number;
  aging: { not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  recent: Array<{ doc_no: string | null; due_date: string | null; open_amount: number }>;
};

type DebtRow = { doc_no: string | null; due_date: string | null; open_amount: string; days_overdue: number | null };

/** Read-only partner debt lookup for the AI bridge (CB-2.2): tổng công nợ còn mở + phân theo tuổi nợ
 * (chưa đến hạn / 1–30 / 31–60 / 61–90 / >90 ngày quá hạn) + 5 chứng từ gần nhất còn mở. Bucket khớp
 * cách hiển thị "Tuổi nợ" ở màn Công nợ (`server/overdue.ts`). */
export async function getPartnerDebtForStaff(
  tenantId: string,
  staffUserId: string,
  partnerCode: string,
  kind: DebtKind,
  db: Queryable = sql as unknown as Queryable,
): Promise<PartnerDebt> {
  await authorizeStaffMember(tenantId, staffUserId, db);

  const [partner] = await db<{ id: string; code: string; name: string }[]>`
    select id, code, name from partners where tenant_id = ${tenantId} and upper(code) = upper(${partnerCode}) limit 1`;
  if (!partner) throw new AppError("not_found", "Không tìm thấy mã đối tác trong hệ thống.");

  const rows =
    kind === "receivable"
      ? await db<DebtRow[]>`
          select d.doc_no, to_char(r.due_date, 'YYYY-MM-DD') as due_date, (r.amount - r.paid) as open_amount,
            case when r.due_date is null then null else (current_date - r.due_date) end as days_overdue
          from receivables r left join documents d on d.tenant_id = r.tenant_id and d.id = r.document_id
          where r.tenant_id = ${tenantId} and r.partner_id = ${partner.id} and r.amount - r.paid > 0
          order by coalesce(r.due_date, current_date) desc, r.created_at desc`
      : await db<DebtRow[]>`
          select d.doc_no, to_char(p.due_date, 'YYYY-MM-DD') as due_date, (p.amount - p.paid) as open_amount,
            case when p.due_date is null then null else (current_date - p.due_date) end as days_overdue
          from payables p left join documents d on d.tenant_id = p.tenant_id and d.id = p.document_id
          where p.tenant_id = ${tenantId} and p.partner_id = ${partner.id} and p.amount - p.paid > 0
          order by coalesce(p.due_date, current_date) desc, p.created_at desc`;

  const aging = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let totalOpen = 0;
  for (const r of rows) {
    const open = Number(r.open_amount);
    totalOpen += open;
    const days = r.days_overdue;
    if (days == null || days <= 0) aging.not_due += open;
    else if (days <= 30) aging.d1_30 += open;
    else if (days <= 60) aging.d31_60 += open;
    else if (days <= 90) aging.d61_90 += open;
    else aging.d90_plus += open;
  }

  return {
    partner: { code: partner.code, name: partner.name },
    kind,
    total_open: totalOpen,
    aging,
    recent: rows.slice(0, 5).map((r) => ({ doc_no: r.doc_no, due_date: r.due_date, open_amount: Number(r.open_amount) })),
  };
}
