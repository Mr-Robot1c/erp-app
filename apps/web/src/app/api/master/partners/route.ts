import { AppError, partnerSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"]);
  const body = partnerSchema.parse(await req.json());

  return tx(async (s) => {
    const dup = await s`select 1 from partners where tenant_id = ${m.tenantId} and code = ${body.code}`;
    if (dup.length) throw new AppError("duplicate", "Mã đối tác đã tồn tại");

    const [row] = await s`
      insert into partners (tenant_id, code, name, kind, credit_limit)
      values (${m.tenantId}, ${body.code}, ${body.name}, ${body.kind}, ${body.creditLimit})
      returning *`;

    await audit(s, m.tenantId, m.displayName || m.userId, "partner.create", body.code);
    return row;
  });
});
