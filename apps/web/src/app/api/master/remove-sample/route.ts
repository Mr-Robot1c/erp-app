import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";
import { removeSampleData } from "@/server/sample";

/** Xoá dữ liệu mẫu (port removeSample demo): đối tác/mặt hàng mẫu CHƯA có chứng từ/tồn tham chiếu thì xoá hẳn;
 * cái đã dùng thì giữ và bỏ cờ mẫu (logic dùng chung ở server/sample.ts). */
export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  return tx(async (s) => {
    const r = await removeSampleData(s, m.tenantId);
    await audit(s, m.tenantId, m.displayName || m.userId, "sample.remove", "", `partners=${r.removedPartners}, items=${r.removedItems}`);
    return r;
  });
});
