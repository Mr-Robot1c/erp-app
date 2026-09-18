create table invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null,
  status text not null default 'sent' check (status in ('sent','accepted','revoked')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
alter table invites enable row level security;
create policy sel_invites on invites for select using (tenant_id = my_tenant_id());
