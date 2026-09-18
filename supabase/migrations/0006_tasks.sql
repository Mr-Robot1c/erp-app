create table tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null,
  text text not null,
  document_id uuid,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, document_id) references documents(tenant_id, id) on delete cascade
);
alter table tasks enable row level security;
create policy sel_tasks on tasks for select using (tenant_id = my_tenant_id());

create index on tasks(tenant_id, done);
