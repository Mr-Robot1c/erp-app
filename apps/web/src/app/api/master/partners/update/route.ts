import { AppError, partnerUpdateSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit, tx } from "@/server/db";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin", "accountant"], req);
  const body = partnerUpdateSchema.parse(await req.json());

  return tx(async (s) => {
    const [cur] = await s`select id, code from partners where tenant_id = ${m.tenantId} and id = ${body.id} for update`;
    if (!cur) throw new AppError("not_found", "Không có đối tác này");
    if (body.code !== undefined && body.code !== cur.code) throw new AppError("invalid_argument", "Mã không đổi được sau khi tạo");

    const [row] = await s`
      update partners set
        name = coalesce(${body.name ?? null}, name),
        kind = coalesce(${body.kind ?? null}, kind),
        credit_limit = coalesce(${body.creditLimit ?? null}, credit_limit)
      where tenant_id = ${m.tenantId} and id = ${body.id}
      returning *`;
    await audit(s, m.tenantId, m.displayName || m.userId, "partner.update", cur.code as string);
    return row;
  });
});
