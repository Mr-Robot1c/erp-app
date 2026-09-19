import { AppError, itemSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin", "accountant"], req);
  const body = itemSchema.parse(await req.json());

  return tx(async (s) => {
    const dup = await s`select 1 from items where tenant_id = ${m.tenantId} and code = ${body.code}`;
    if (dup.length) throw new AppError("duplicate", "Mã mặt hàng đã tồn tại");

    const [row] = await s`
      insert into items (tenant_id, code, name, kind, uom, price, cost, tracking, uom_factors)
      values (${m.tenantId}, ${body.code}, ${body.name}, ${body.kind}, ${body.uom}, ${body.price}, ${body.cost}, ${body.tracking}, ${s.json(body.uomFactors as never)})
      returning *`;

    await audit(s, m.tenantId, m.displayName || m.userId, "item.create", body.code);
    return row;
  });
});
