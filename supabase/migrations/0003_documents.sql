-- (a) Khoá phụ (tenant_id, id) trên bảng cha — mọi FK nghiệp vụ từ nay là FK KÉP cùng tenant (luật ở 02 mục C)
alter table partners   add constraint partners_tenant_uk   unique (tenant_id, id);
alter table items      add constraint items_tenant_uk      unique (tenant_id, id);
alter table warehouses add constraint warehouses_tenant_uk unique (tenant_id, id);
alter table accounts   add constraint accounts_tenant_uk   unique (tenant_id, id);

-- (b) memberships: PK (user_id, tenant_id) — sẵn sàng đa DN; LUẬT SẢN PHẨM v1 vẫn "1 tài khoản = 1 DN"
--     giữ bằng unique index dưới đây (nhờ nó my_tenant_id() vẫn trả đúng 1 dòng); khi làm đa DN chỉ cần drop index + thêm chọn DN đang làm việc
alter table memberships drop constraint memberships_pkey;
alter table memberships add primary key (user_id, tenant_id);
create unique index memberships_one_tenant_v1 on memberships(user_id);

-- (c) Chống lặp request (client timeout rồi bấm lại, webhook retry...): server lưu kết quả theo khoá, gặp lại trả y nguyên
create table idempotency_keys (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  endpoint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
alter table idempotency_keys enable row level security;  -- không policy nào: client không đọc/ghi được

create table doc_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_type text not null,
  last_no int not null default 0,
  primary key (tenant_id, doc_type)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_type text not null check (doc_type in ('QUOTE','SO','DO','INV','RCPT','PR','PO','GRN','VINV','PAY','EXP','MO','ADJ')),
  doc_no text not null,
  doc_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft','pending','confirmed','partial','done','cancelled')),
  partner_id uuid,
  ext_id uuid,                          -- đối tượng mở rộng (GĐ6)
  refs jsonb not null default '[]',     -- ["ĐB-0001", ...]
  meta jsonb not null default '{}',     -- terms, deposit, totals, chain, approvals, ...
  created_by uuid, created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, doc_type, doc_no),
  unique (tenant_id, id),               -- để bảng con FK kép về documents
  foreign key (tenant_id, partner_id) references partners(tenant_id, id)
);
create index on documents(tenant_id, doc_type, status);

create table document_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,
  line_no int not null,
  item_id uuid,
  qty numeric(18,3) not null default 0,
  price numeric(18,0) not null default 0,
  tax_pct numeric(5,2) not null default 10,
  meta jsonb not null default '{}',     -- reserved, delivered, received, cost...
  unique (document_id, line_no),
  foreign key (tenant_id, document_id) references documents(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);

create table doc_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null, document_id uuid not null,
  foreign key (tenant_id, document_id) references documents(tenant_id, id) on delete cascade,
  at timestamptz not null default now(), actor text not null default '',
  from_status text, to_status text not null, note text not null default ''
);

-- Bất biến (vá 18/09 sau rà soát): ngoài draft chỉ được đổi status/refs/meta;
-- KHÔNG BAO GIỜ quay về draft từ bất kỳ trạng thái nào; không xoá chứng từ ngoài draft.
-- meta là TRƯỜNG VẬN HÀNH (chain/approvals/delivered...) nên được đổi sau confirm —
-- hệ quả: totals khi đối chiếu/báo cáo phải TÍNH LẠI từ document_lines, không tin meta.totals.
create or replace function trg_doc_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- van xả CÓ KIỂM SOÁT cho xoá cả tenant (cleanup test, đóng tài khoản AC-44, cron dọn GĐ9):
    -- transaction xoá phải `set local app.purge = 'on'` trước; ngoài các đường đó KHÔNG được dùng.
    if current_setting('app.purge', true) = 'on' then return old; end if;
    if old.status <> 'draft' then raise exception 'document_immutable'; end if;
    return old;                       -- draft xoá được (dọn nháp)
  end if;
  if old.status <> 'draft' then
    if new.doc_type is distinct from old.doc_type or new.doc_no is distinct from old.doc_no
       or new.doc_date is distinct from old.doc_date or new.partner_id is distinct from old.partner_id
       or new.tenant_id is distinct from old.tenant_id or new.ext_id is distinct from old.ext_id
       or new.created_by is distinct from old.created_by then
      raise exception 'document_immutable';
    end if;
    if new.status = 'draft' then      -- pending/confirmed/... KHÔNG đường về nháp
      raise exception 'document_immutable';
    end if;
  end if;
  return new;
end $$;
create trigger doc_immutable before update or delete on documents
  for each row execute function trg_doc_immutable();

-- Dòng: chỉ thêm/sửa/xoá khi chứng từ draft; KHÔNG được chuyển dòng sang chứng từ khác.
-- (vá 18/09: kiểm theo chứng từ CŨ khi update/delete — trước đây kiểm theo NEW nên có đường
--  chuyển dòng từ chứng từ confirmed sang một chứng từ draft rồi sửa thoải mái)
create or replace function trg_lines_frozen() returns trigger language plpgsql as $$
declare st text;
begin
  if tg_op = 'UPDATE' and (new.document_id is distinct from old.document_id
       or new.tenant_id is distinct from old.tenant_id or new.line_no is distinct from old.line_no) then
    raise exception 'document_immutable';
  end if;
  select status into st from documents
    where id = case when tg_op = 'INSERT' then new.document_id else old.document_id end;
  if st <> 'draft' then
    if tg_op = 'DELETE' or tg_op = 'INSERT' then raise exception 'document_immutable'; end if;
    if new.item_id is distinct from old.item_id or new.qty is distinct from old.qty
       or new.price is distinct from old.price or new.tax_pct is distinct from old.tax_pct then
      raise exception 'document_immutable';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger lines_frozen before insert or update or delete on document_lines
  for each row execute function trg_lines_frozen();

alter table documents enable row level security;
alter table document_lines enable row level security;
alter table doc_status_history enable row level security;
alter table doc_sequences enable row level security;
create policy sel_documents on documents for select using (tenant_id = my_tenant_id());
create policy sel_doc_lines on document_lines for select using (tenant_id = my_tenant_id());
create policy sel_doc_hist on doc_status_history for select using (tenant_id = my_tenant_id());
