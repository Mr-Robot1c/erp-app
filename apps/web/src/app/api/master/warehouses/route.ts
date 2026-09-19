import { AppError, warehouseSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin", "accountant"], req);
  const body = warehouseSchema.parse(await req.json());

  return tx(async (s) => {
    const dup = await s`select 1 from warehouses where tenant_id = ${m.tenantId} and code = ${body.code}`;
    if (dup.length) throw new AppError("duplicate", "Mã kho đã tồn tại");
    const [row] = await s`insert into warehouses (tenant_id, code, name) values (${m.tenantId}, ${body.code}, ${body.name}) returning *`;
    await audit(s, m.tenantId, m.displayName || m.userId, "warehouse.create", body.code);
    return row;
  });
});
