-- GĐ2 — bán → thu: tồn kho, giữ hàng, phải thu, tiền ứng, bút toán (playbook/gd2-ban-thu.md).
-- FK KÉP cùng tenant (02 mục C). Chỉ THÊM, không sửa file cũ.

create table stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  move_date date not null default current_date,
  item_id uuid not null,
  warehouse_id uuid not null,
  qty numeric(18,3) not null,           -- + nhập, − xuất
  unit_cost numeric(18,0) not null default 0,
  document_id uuid,
  lot_no text, serial_no text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, item_id) references items(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id),
  foreign key (tenant_id, document_id) references documents(tenant_id, id)
);
create index on stock_moves(tenant_id, item_id);

create table reservations (             -- giữ hàng cho đơn: tồn khả dụng = on_hand − Σreservations
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,            -- SO
  line_no int not null,
  item_id uuid not null,
  qty numeric(18,3) not null check (qty > 0),
  unique (document_id, line_no),
  foreign key (tenant_id, document_id) references documents(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create index on reservations(tenant_id, item_id);

create table receivables (              -- khoản phải thu / cọc
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  kind text not null check (kind in ('invoice','deposit','renewal')),
  document_id uuid,                     -- INV hoặc SO (cọc)
  partner_id uuid not null,
  amount numeric(18,0) not null,
  paid numeric(18,0) not null default 0,
  due_date date,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, document_id) references documents(tenant_id, id),
  foreign key (tenant_id, partner_id) references partners(tenant_id, id)
);
create index on receivables(tenant_id, partner_id);

create table receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null,             -- RCPT
  receivable_id uuid,
  amount numeric(18,0) not null,
  note text not null default '',
  foreign key (tenant_id, receipt_id) references documents(tenant_id, id) on delete cascade,
  foreign key (tenant_id, receivable_id) references receivables(tenant_id, id)
);

create table partner_advances (         -- tiền ứng trước theo đối tác
  tenant_id uuid not null,
  partner_id uuid not null,
  amount numeric(18,0) not null default 0,
  primary key (tenant_id, partner_id),
  foreign key (tenant_id, partner_id) references partners(tenant_id, id)
);

create table bank_txns (                -- chống ghi trùng giao dịch ngân hàng
  tenant_id uuid not null,
  bank_ref text not null,
  receipt_id uuid not null,
  primary key (tenant_id, bank_ref),
  foreign key (tenant_id, receipt_id) references documents(tenant_id, id)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entry_date date not null,
  document_id uuid,
  memo text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, document_id) references documents(tenant_id, id)
);
create table journal_lines (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  entry_id uuid not null,
  account_code text not null,
  debit numeric(18,0) not null default 0,
  credit numeric(18,0) not null default 0,
  check (debit >= 0 and credit >= 0),
  foreign key (tenant_id, entry_id) references journal_entries(tenant_id, id) on delete cascade
);

-- Bút toán cân: constraint trigger deferred kiểm Σdebit = Σcredit theo entry lúc COMMIT.
create or replace function trg_entry_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric; eid uuid;
begin
  eid := coalesce(new.entry_id, old.entry_id);
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from journal_lines where entry_id = eid;
  if d <> c then raise exception 'journal_unbalanced'; end if;
  return null;
end $$;
create constraint trigger entry_balanced after insert or update or delete on journal_lines
  deferrable initially deferred for each row execute function trg_entry_balanced();

-- RLS: client CHỈ đọc dữ liệu tenant mình; ghi qua API server (quyền cao).
alter table stock_moves enable row level security;
alter table reservations enable row level security;
alter table receivables enable row level security;
alter table receipt_allocations enable row level security;
alter table partner_advances enable row level security;
alter table bank_txns enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
create policy sel_stock_moves on stock_moves for select using (tenant_id = my_tenant_id());
create policy sel_reservations on reservations for select using (tenant_id = my_tenant_id());
create policy sel_receivables on receivables for select using (tenant_id = my_tenant_id());
create policy sel_receipt_alloc on receipt_allocations for select using (tenant_id = my_tenant_id());
create policy sel_partner_adv on partner_advances for select using (tenant_id = my_tenant_id());
create policy sel_bank_txns on bank_txns for select using (tenant_id = my_tenant_id());
create policy sel_journal_entries on journal_entries for select using (tenant_id = my_tenant_id());
create policy sel_journal_lines on journal_lines for select using (tenant_id = my_tenant_id());

-- View tồn (02 mục D6): security_invoker = true để RLS của bảng gốc áp cho NGƯỜI GỌI.
create view v_on_hand with (security_invoker = true) as
  select tenant_id, item_id, warehouse_id, sum(qty) as qty, sum(qty * unit_cost) as value
  from stock_moves group by tenant_id, item_id, warehouse_id;

create view v_available with (security_invoker = true) as
  select o.tenant_id, o.item_id, o.qty as on_hand,
         coalesce(r.reserved, 0) as reserved, o.qty - coalesce(r.reserved, 0) as available
  from (select tenant_id, item_id, sum(qty) as qty from stock_moves group by tenant_id, item_id) o
  left join (select tenant_id, item_id, sum(qty) as reserved from reservations group by tenant_id, item_id) r
    on r.tenant_id = o.tenant_id and r.item_id = o.item_id;
