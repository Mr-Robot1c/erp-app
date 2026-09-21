-- GĐ4 lô 4.3 — kỳ khoá BẤT BIẾN ở tầng DB (playbook/gd4-ke-toan.md, AC-32). Chỉ THÊM.
-- App đã chặn ở `assertPeriodOpen`/`postEntry`; trigger là hàng rào cuối: kể cả ghi thẳng SQL cũng không sửa được sổ kỳ đã khoá.
-- Van `app.purge` (chỉ dùng dọn dữ liệu test/xoá tenant, như trg_doc_immutable ở 0003).

create or replace function trg_journal_entry_period() returns trigger language plpgsql as $$
declare d date; t uuid;
begin
  if current_setting('app.purge', true) = 'on' then return coalesce(new, old); end if;
  d := coalesce(new.entry_date, old.entry_date);
  t := coalesce(new.tenant_id, old.tenant_id);
  if exists (select 1 from periods where tenant_id = t and ym = to_char(d, 'YYYY-MM') and status = 'locked') then
    raise exception 'period_locked: kỳ % đã khoá', to_char(d, 'YYYY-MM');
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_entry_period before insert or update or delete on journal_entries
  for each row execute function trg_journal_entry_period();

create or replace function trg_journal_line_period() returns trigger language plpgsql as $$
declare d date; t uuid; e uuid;
begin
  if current_setting('app.purge', true) = 'on' then return coalesce(new, old); end if;
  e := coalesce(new.entry_id, old.entry_id);
  t := coalesce(new.tenant_id, old.tenant_id);
  select entry_date into d from journal_entries where id = e;
  if d is not null and exists (select 1 from periods where tenant_id = t and ym = to_char(d, 'YYYY-MM') and status = 'locked') then
    raise exception 'period_locked: kỳ % đã khoá', to_char(d, 'YYYY-MM');
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_line_period before insert or update or delete on journal_lines
  for each row execute function trg_journal_line_period();

-- Kỳ đã khoá không mở lại được (không có đường mở khoá trong app).
create or replace function trg_period_no_unlock() returns trigger language plpgsql as $$
begin
  if current_setting('app.purge', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status = 'locked' then raise exception 'period_locked: kỳ % đã khoá, không xoá được', old.ym; end if;
    return old;
  end if;
  if old.status = 'locked' and new.status <> 'locked' then
    raise exception 'period_locked: kỳ % đã khoá, không mở lại được', old.ym;
  end if;
  return new;
end $$;
create trigger period_no_unlock before update or delete on periods
  for each row execute function trg_period_no_unlock();
