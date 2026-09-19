import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";

/** Xoá dữ liệu mẫu (port removeSample demo): đối tác/mặt hàng mẫu CHƯA có chứng từ/tồn tham chiếu thì xoá hẳn;
 * cái đã dùng thì giữ và bỏ cờ mẫu. Thử xoá từng dòng trong savepoint — vướng khoá ngoại (23503) = đã dùng. */
export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);

  return tx(async (s) => {
    let removedPartners = 0;
    let removedItems = 0;
    const partners = await s`select id from partners where tenant_id = ${m.tenantId} and is_sample`;
    for (const p of partners) {
      try {
        await s.savepoint(async (sp) => {
          await sp`delete from partners where tenant_id = ${m.tenantId} and id = ${p.id}`;
        });
        removedPartners++;
      } catch (e) {
        if ((e as { code?: string }).code !== "23503") throw e;
      }
    }
    const items = await s`select id from items where tenant_id = ${m.tenantId} and is_sample`;
    for (const it of items) {
      try {
        await s.savepoint(async (sp) => {
          await sp`delete from items where tenant_id = ${m.tenantId} and id = ${it.id}`;
        });
        removedItems++;
      } catch (e) {
        if ((e as { code?: string }).code !== "23503") throw e;
      }
    }
    await s`update partners set is_sample = false where tenant_id = ${m.tenantId} and is_sample`;
    await s`update items set is_sample = false where tenant_id = ${m.tenantId} and is_sample`;
    await audit(s, m.tenantId, m.displayName || m.userId, "sample.remove", "", `partners=${removedPartners}, items=${removedItems}`);
    return { removedPartners, removedItems };
  });
});
