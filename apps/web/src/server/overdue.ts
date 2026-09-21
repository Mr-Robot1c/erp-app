import type { TransactionSql } from "postgres";
import { formatMoney } from "@erp/core";
import { sql } from "./db";

type Overdue = { id: string; partner_id: string; partner_name: string; credit_limit: string; document_id: string | null; doc_no: string | null; open: string; due_date: string };

/** Quét công nợ quá hạn của MỘT doanh nghiệp (S04, lô 4.2, AC-19) — idempotent, chạy hằng ngày:
 * - khoản phải thu (hoá đơn) còn mở và quá hạn → `receivables.overdue = true` (khoản hết nợ/hết hạn → false);
 * - mỗi khoản quá hạn sinh 2 việc nhắc (kinh doanh + kế toán), KHÔNG sinh lại nếu việc cũ chưa đóng;
 * - khách vừa QUÁ HẠN vừa VƯỢT hạn mức (dư nợ còn mở > hạn mức, hạn mức > 0) → `partners.blocked = true` (chặn bán công nợ:
 *   xác nhận đơn công nợ phải qua kế toán trưởng); hết quá hạn hoặc hết vượt → mở chặn. */
export async function sweepTenant(s: TransactionSql, tenantId: string, today: string) {
  await s`update receivables set overdue = false
          where tenant_id = ${tenantId} and overdue and not (kind = 'invoice' and amount - paid > 0 and due_date < ${today})`;
  const rows = await s<Overdue[]>`
    select r.id, r.partner_id, p.name as partner_name, p.credit_limit, r.document_id, d.doc_no, (r.amount - r.paid) as open, to_char(r.due_date, 'YYYY-MM-DD') as due_date
    from receivables r
    join partners p on p.id = r.partner_id and p.tenant_id = r.tenant_id
    left join documents d on d.id = r.document_id and d.tenant_id = r.tenant_id
    where r.tenant_id = ${tenantId} and r.kind = 'invoice' and r.amount - r.paid > 0 and r.due_date < ${today}`;

  let reminders = 0;
  for (const r of rows) {
    await s`update receivables set overdue = true where id = ${r.id}`;
    const label = r.doc_no ?? "số dư đầu kỳ";
    const text = `Nợ quá hạn: ${r.partner_name} — ${label} còn ${formatMoney(Number(r.open))}, hạn ${r.due_date}`;
    for (const role of ["sales", "accountant"] as const) {
      const [exists] = await s`
        select 1 from tasks where tenant_id = ${tenantId} and role = ${role} and text = ${text} and not done limit 1`;
      if (exists) continue;
      await s`insert into tasks (tenant_id, role, text, document_id) values (${tenantId}, ${role}, ${text}, ${r.document_id})`;
      reminders++;
    }
  }

  // Chặn / mở chặn theo từng khách.
  const overduePartners = new Set(rows.map((r) => r.partner_id));
  const candidates = await s<{ id: string; blocked: boolean; credit_limit: string; open: string }[]>`
    select p.id, p.blocked, p.credit_limit,
           coalesce((select sum(amount - paid) from receivables where tenant_id = p.tenant_id and partner_id = p.id and kind = 'invoice'), 0) as open
    from partners p where p.tenant_id = ${tenantId} and (p.blocked or p.id in ${s([...overduePartners, "00000000-0000-0000-0000-000000000000"])})`;
  let blocked = 0;
  let unblocked = 0;
  for (const p of candidates) {
    const shouldBlock = overduePartners.has(p.id) && Number(p.credit_limit) > 0 && Number(p.open) > Number(p.credit_limit);
    if (shouldBlock && !p.blocked) {
      await s`update partners set blocked = true where id = ${p.id}`;
      blocked++;
    } else if (!shouldBlock && p.blocked) {
      await s`update partners set blocked = false where id = ${p.id}`;
      unblocked++;
    }
  }
  return { overdue: rows.length, reminders, blocked, unblocked };
}

/** Quét mọi doanh nghiệp (gọi từ lịch hằng ngày qua `POST /api/jobs/overdue-sweep`). Mỗi tenant một transaction riêng — lỗi một nơi không kéo cả lô. */
export async function sweepAll(today = new Date().toISOString().slice(0, 10), onlyTenantId?: string) {
  const tenants = onlyTenantId ? await sql<{ id: string }[]>`select id from tenants where id = ${onlyTenantId}` : await sql<{ id: string }[]>`select id from tenants`;
  const total = { tenants: tenants.length, overdue: 0, reminders: 0, blocked: 0, unblocked: 0, failed: 0 };
  for (const t of tenants) {
    try {
      const r = await sql.begin((s) => sweepTenant(s, t.id, today));
      total.overdue += r.overdue;
      total.reminders += r.reminders;
      total.blocked += r.blocked;
      total.unblocked += r.unblocked;
    } catch {
      total.failed++;
    }
  }
  return total;
}
