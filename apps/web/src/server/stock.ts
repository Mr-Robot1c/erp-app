import type { TransactionSql } from "postgres";

/** Khoá các mặt hàng (theo thứ tự id để tránh deadlock) — MỌI thao tác giữ/xuất kho phải gọi đầu giao dịch để
 * tuần tự hoá theo mặt hàng (gd2 mục "Server helpers"; lô 2.3 test song song món cuối). */
export async function lockItems(s: TransactionSql, tenantId: string, itemIds: string[]) {
  const ids = [...new Set(itemIds)].sort();
  if (!ids.length) return;
  await s`select id from items where tenant_id = ${tenantId} and id in ${s(ids)} order by id for update`;
}

export async function onHand(s: TransactionSql, tenantId: string, itemId: string): Promise<number> {
  const [r] = await s<{ v: string }[]>`
    select coalesce(sum(qty), 0) as v from stock_moves where tenant_id = ${tenantId} and item_id = ${itemId}`;
  return Number(r.v);
}

export async function reservedQty(s: TransactionSql, tenantId: string, itemId: string): Promise<number> {
  const [r] = await s<{ v: string }[]>`
    select coalesce(sum(qty), 0) as v from reservations where tenant_id = ${tenantId} and item_id = ${itemId}`;
  return Number(r.v);
}

/** Tồn khả dụng = tồn thực − Σ đang giữ cho các đơn. */
export async function available(s: TransactionSql, tenantId: string, itemId: string): Promise<number> {
  return (await onHand(s, tenantId, itemId)) - (await reservedQty(s, tenantId, itemId));
}

/** Giá vốn bình quân theo các lần nhập (port demo avgCost); chưa có lần nhập nào thì lấy giá vốn danh mục. */
export async function avgCost(s: TransactionSql, tenantId: string, itemId: string): Promise<number> {
  const [r] = await s<{ q: string; v: string }[]>`
    select coalesce(sum(qty), 0) as q, coalesce(sum(qty * unit_cost), 0) as v
    from stock_moves where tenant_id = ${tenantId} and item_id = ${itemId} and qty > 0`;
  if (Number(r.q) > 0) return Math.round(Number(r.v) / Number(r.q));
  const [it] = await s<{ cost: string }[]>`select cost from items where id = ${itemId} and tenant_id = ${tenantId}`;
  return Number(it?.cost ?? 0);
}
