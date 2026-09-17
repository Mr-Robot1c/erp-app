import postgres, { type TransactionSql } from "postgres";

export const sql = postgres(process.env.SUPABASE_DB_URL!, { prepare: false, max: 5 });

export const tx = <T>(fn: (s: TransactionSql) => Promise<T>) => sql.begin(fn);

/** Ghi một dòng nhật ký audit trong cùng transaction đang chạy (02-quyet-dinh, bước server). */
export async function audit(
  s: TransactionSql | typeof sql,
  tenantId: string,
  actor: string,
  action: string,
  ref: string,
  detail = "",
) {
  await s`insert into audit_log (tenant_id, actor, action, ref, detail) values (${tenantId}, ${actor}, ${action}, ${ref}, ${detail})`;
}
