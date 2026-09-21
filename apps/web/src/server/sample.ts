import type { TransactionSql } from "postgres";

/** Xoá dữ liệu mẫu (port removeSample demo) — dùng chung cho Danh mục và nạp số dư đầu kỳ.
 * Thử xoá từng dòng trong savepoint: vướng khoá ngoại (23503) = đã dùng thì GIỮ và bỏ cờ mẫu.
 * `purgeOpening`: xoá luôn tồn đầu mẫu (dòng tồn không gắn chứng từ của mặt hàng mẫu) TRƯỚC khi xoá mặt hàng —
 * chỉ dùng khi doanh nghiệp chưa có chứng từ nào (nạp số dư thật thay cho số mẫu). */
export async function removeSampleData(s: TransactionSql, tenantId: string, opts: { purgeOpening?: boolean } = {}) {
  if (opts.purgeOpening) {
    await s`
      delete from stock_moves
      where tenant_id = ${tenantId} and document_id is null
        and item_id in (select id from items where tenant_id = ${tenantId} and is_sample)`;
  }
  let removedPartners = 0;
  let removedItems = 0;
  const partners = await s`select id from partners where tenant_id = ${tenantId} and is_sample`;
  for (const p of partners) {
    try {
      await s.savepoint(async (sp) => {
        await sp`delete from partners where tenant_id = ${tenantId} and id = ${p.id}`;
      });
      removedPartners++;
    } catch (e) {
      if ((e as { code?: string }).code !== "23503") throw e;
    }
  }
  const items = await s`select id from items where tenant_id = ${tenantId} and is_sample`;
  for (const it of items) {
    try {
      await s.savepoint(async (sp) => {
        await sp`delete from items where tenant_id = ${tenantId} and id = ${it.id}`;
      });
      removedItems++;
    } catch (e) {
      if ((e as { code?: string }).code !== "23503") throw e;
    }
  }
  await s`update partners set is_sample = false where tenant_id = ${tenantId} and is_sample`;
  await s`update items set is_sample = false where tenant_id = ${tenantId} and is_sample`;
  return { removedPartners, removedItems };
}
