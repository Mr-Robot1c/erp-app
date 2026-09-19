-- Kho chờ kiểm (lô 3.2): mặt hàng cần kiểm nhập vào kho mã QC, chỉ tính vào tồn khả dụng sau khi đạt (pass-qc).
alter table items add column inspect boolean not null default false;

-- Mỗi doanh nghiệp có kho QC (tenant mới được seed ở onboarding).
insert into warehouses (tenant_id, code, name)
select id, 'QC', 'Kho chờ kiểm' from tenants
on conflict (tenant_id, code) do nothing;

-- Tồn khả dụng KHÔNG tính kho QC.
create or replace view v_available with (security_invoker = true) as
  select o.tenant_id, o.item_id, o.qty as on_hand,
         coalesce(r.reserved, 0) as reserved, o.qty - coalesce(r.reserved, 0) as available
  from (select m.tenant_id, m.item_id, sum(m.qty) as qty
        from stock_moves m join warehouses w on w.id = m.warehouse_id and w.tenant_id = m.tenant_id
        where w.code <> 'QC' group by m.tenant_id, m.item_id) o
  left join (select tenant_id, item_id, sum(qty) as reserved from reservations group by tenant_id, item_id) r
    on r.tenant_id = o.tenant_id and r.item_id = o.item_id;
