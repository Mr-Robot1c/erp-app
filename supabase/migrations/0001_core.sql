create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_code text not null unique,
  industry text not null default 'default',
  settings jsonb not null default '{"expThreshold":10000000,"poThreshold":20000000,"tolerancePct":2,"terms":30}',
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null check (role in ('admin','director','sales_lead','sales','warehouse','purchasing','dept_lead','accountant','chief_accountant','staff')),
  display_name text not null default '',
  created_at timestamptz not null default now()
);
create index on memberships(tenant_id);

create table partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  kind text not null check (kind in ('customer','supplier','both')),
  credit_limit numeric(18,0) not null default 0,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  kind text not null check (kind in ('goods','service','material','finished')),
  uom text not null default 'cái',
  price numeric(18,0) not null default 0,
  cost numeric(18,0) not null default 0,
  tracking text not null default 'none' check (tracking in ('none','lot','serial')),
  bom jsonb, is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  unique (tenant_id, code)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  unique (tenant_id, code)
);

create table periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ym char(7) not null,               -- 'YYYY-MM'
  status text not null default 'open' check (status in ('open','locked')),
  unique (tenant_id, ym)
);

create table audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  at timestamptz not null default now(),
  user_id uuid, actor text not null default '',
  action text not null, ref text not null default '', detail text not null default ''
);
create index on audit_log(tenant_id, at desc);

-- RLS: client chỉ ĐỌC dữ liệu tenant mình; ghi = 0 policy (đi qua server, service key bypass)
create or replace function my_tenant_id() returns uuid language sql stable as
  $$ select tenant_id from memberships where user_id = auth.uid() $$;

do $$ declare t text;
begin
  foreach t in array array['tenants','memberships','partners','items','warehouses','accounts','periods','audit_log'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy sel_tenants on tenants for select using (id = my_tenant_id());
create policy sel_memberships on memberships for select using (tenant_id = my_tenant_id());
create policy sel_partners on partners for select using (tenant_id = my_tenant_id());
create policy sel_items on items for select using (tenant_id = my_tenant_id());
create policy sel_warehouses on warehouses for select using (tenant_id = my_tenant_id());
create policy sel_accounts on accounts for select using (tenant_id = my_tenant_id());
create policy sel_periods on periods for select using (tenant_id = my_tenant_id());
create policy sel_audit on audit_log for select using (tenant_id = my_tenant_id());
