-- GĐ4 lô 4.1 — sổ cái, số dư, sổ chi tiết đối tác (playbook/gd4-ke-toan.md). Chỉ THÊM.
-- Cả 3 view tạo `security_invoker = true` (luật 02 mục D6): RLS của bảng gốc áp cho NGƯỜI GỌI, client đọc thẳng qua Supabase (luật D1).

create view v_journal with (security_invoker = true) as
  select l.id as line_id, l.tenant_id, e.id as entry_id, e.entry_date, to_char(e.entry_date, 'YYYY-MM') as ym, e.memo,
         e.document_id, d.doc_no, d.doc_type, d.partner_id, l.account_code, l.debit, l.credit
  from journal_lines l
  join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
  left join documents d on d.id = e.document_id and d.tenant_id = e.tenant_id;

-- Phát sinh theo (kỳ, tài khoản). Số dư đầu/cuối kỳ = cộng dồn các kỳ trước/đến kỳ đó (tính ở trang báo cáo).
create view v_account_balance with (security_invoker = true) as
  select tenant_id, ym, account_code, sum(debit) as debit, sum(credit) as credit, sum(debit - credit) as balance
  from v_journal group by tenant_id, ym, account_code;

-- Sổ chi tiết đối tác: phát sinh theo (đối tác, tài khoản) — bút toán có chứng từ gắn đối tác (131 phải thu, 331 phải trả…).
create view v_partner_balance with (security_invoker = true) as
  select tenant_id, partner_id, account_code, sum(debit) as debit, sum(credit) as credit, sum(debit - credit) as balance
  from v_journal where partner_id is not null group by tenant_id, partner_id, account_code;
