import { AppError, itemUpdateSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin", "accountant"], req);
  const body = itemUpdateSchema.parse(await req.json());

  return tx(async (s) => {
    const [cur] = await s`select id, code, kind, uom, tracking from items where tenant_id = ${m.tenantId} and id = ${body.id} for update`;
    if (!cur) throw new AppError("not_found", "Không có mặt hàng này");
    if (body.code !== undefined && body.code !== cur.code) throw new AppError("invalid_argument", "Mã không đổi được sau khi tạo");

    // Đổi loại / đơn vị / cách theo dõi khi đã có tồn hoặc chứng từ sẽ làm lệch sổ kho → chặn.
    const structural =
      (body.kind !== undefined && body.kind !== cur.kind) ||
      (body.uom !== undefined && body.uom !== cur.uom) ||
      (body.tracking !== undefined && body.tracking !== cur.tracking);
    if (structural) {
      const used = await s`
        select 1 from stock_moves where tenant_id = ${m.tenantId} and item_id = ${body.id}
        union all
        select 1 from document_lines where tenant_id = ${m.tenantId} and item_id = ${body.id}
        limit 1`;
      if (used.length) throw new AppError("invalid_argument", "Mặt hàng đã có giao dịch — không đổi được loại, đơn vị, cách theo dõi");
    }

    const [row] = await s`
      update items set
        name = coalesce(${body.name ?? null}, name),
        kind = coalesce(${body.kind ?? null}, kind),
        uom = coalesce(${body.uom ?? null}, uom),
        price = coalesce(${body.price ?? null}, price),
        cost = coalesce(${body.cost ?? null}, cost),
        tracking = coalesce(${body.tracking ?? null}, tracking),
        uom_factors = coalesce(${body.uomFactors ? s.json(body.uomFactors as never) : null}, uom_factors)
      where tenant_id = ${m.tenantId} and id = ${body.id}
      returning *`;
    await audit(s, m.tenantId, m.displayName || m.userId, "item.update", cur.code as string);
    return row;
  });
});
