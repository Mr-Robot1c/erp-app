-- GĐ3 lô 3.3 — phải trả nhà cung cấp (playbook/gd3-mua-kho.md). FK KÉP cùng tenant (02 mục C). Chỉ THÊM.

create table payables (                 -- sổ phụ phải trả: 1 dòng cho mỗi hoá đơn mua đã ghi (không phải bút toán)
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid,                     -- VINV
  partner_id uuid not null,
  amount numeric(18,0) not null,
  paid numeric(18,0) not null default 0,
  due_date date,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, document_id) references documents(tenant_id, id),
  foreign key (tenant_id, partner_id) references partners(tenant_id, id)
);
create index on payables(tenant_id, partner_id);

create table payment_allocations (      -- phân bổ phiếu chi (PAY) vào các khoản phải trả
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null,             -- PAY
  payable_id uuid not null,
  amount numeric(18,0) not null,
  note text not null default '',
  foreign key (tenant_id, payment_id) references documents(tenant_id, id) on delete cascade,
  foreign key (tenant_id, payable_id) references payables(tenant_id, id)
);

alter table payables enable row level security;
alter table payment_allocations enable row level security;
create policy sel_payables on payables for select using (tenant_id = my_tenant_id());
create policy sel_payment_alloc on payment_allocations for select using (tenant_id = my_tenant_id());
