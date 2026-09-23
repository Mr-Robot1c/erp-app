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
