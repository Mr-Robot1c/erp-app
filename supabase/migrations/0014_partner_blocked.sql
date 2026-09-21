-- GĐ4 lô 4.2 — chặn bán công nợ + đánh dấu khoản quá hạn (playbook/gd4-ke-toan.md). Chỉ THÊM.
alter table partners add column blocked boolean not null default false;      -- vừa quá hạn vừa vượt hạn mức → chặn bán công nợ (job quét hằng ngày)
alter table receivables add column overdue boolean not null default false;   -- khoản phải thu quá hạn còn mở (job quét hằng ngày)
