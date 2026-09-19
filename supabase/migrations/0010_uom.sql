-- Đơn vị tính quy đổi (AC-43, lô 2.4): { "thùng": 12 } = 1 thùng bằng 12 đơn vị gốc của mặt hàng.
alter table items add column uom_factors jsonb not null default '{}';
