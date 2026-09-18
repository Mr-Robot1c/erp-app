import type { TransactionSql } from "postgres";
import { AppError, buildTenantSeed, type IndustryTemplate, type RegisterTenantInput } from "@erp/core";
import { audit } from "./db";

/** Đăng ký doanh nghiệp: tenant + membership admin + dữ liệu mẫu theo template — TRONG một transaction. */
export async function registerTenant(
  s: TransactionSql,
  userId: string,
  email: string,
  input: RegisterTenantInput,
) {
  const [existingMembership] = await s`select 1 from memberships where user_id = ${userId}`;
  if (existingMembership) throw new AppError("conflict", "Tài khoản đã thuộc một doanh nghiệp");

  const [templateRow] = await s`
    select code, name, ext_label, payload from industry_templates where code = ${input.industry}`;
  if (!templateRow) throw new AppError("invalid_argument", "Mẫu ngành không hợp lệ");
  const template: IndustryTemplate = {
    code: templateRow.code as string,
    name: templateRow.name as string,
    extLabel: templateRow.ext_label as string | null,
    payload: templateRow.payload,
  };

  const dup = await s`select 1 from tenants where tax_code = ${input.taxCode}`;
  if (dup.length) throw new AppError("duplicate", "Mã số thuế đã đăng ký");

  const [tenant] = await s`
    insert into tenants (name, tax_code, industry)
    values (${input.name}, ${input.taxCode}, ${input.industry})
    returning *`;

  const displayName = email.split("@")[0] || email;
  await s`
    insert into memberships (user_id, tenant_id, role, display_name)
    values (${userId}, ${tenant.id}, 'admin', ${displayName})`;

  const seed = buildTenantSeed(template, input.withSample);

  for (const it of seed.items) {
    await s`
      insert into items (tenant_id, code, name, kind, uom, price, cost, bom, is_sample)
      values (
        ${tenant.id}, ${it.code}, ${it.name}, ${it.kind}, ${it.uom}, ${it.price}, ${it.cost},
        ${it.bom ? JSON.stringify(it.bom) : null}::jsonb, ${it.isSample}
      )`;
  }
  for (const p of seed.partners) {
    await s`
      insert into partners (tenant_id, code, name, kind, credit_limit, is_sample)
      values (${tenant.id}, ${p.code}, ${p.name}, ${p.kind}, ${p.creditLimit}, ${p.isSample})`;
  }
  for (const w of seed.warehouses) {
    await s`insert into warehouses (tenant_id, code, name) values (${tenant.id}, ${w.code}, ${w.name})`;
  }
  for (const a of seed.accounts) {
    await s`insert into accounts (tenant_id, code, name) values (${tenant.id}, ${a.code}, ${a.name})`;
  }

  await audit(s, tenant.id as string, displayName, "tenant.register", input.taxCode, template.name);

  return { tenantId: tenant.id as string };
}
