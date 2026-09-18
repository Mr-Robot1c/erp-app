-- Thêm chế độ kế toán vào settings (lô 1.4) — đọc-only ở /app/settings, để sẵn chỗ đổi sau.
-- Cập nhật default cho tenant MỚI + backfill tenant đã có (không đè 4 ngưỡng đang có).
alter table tenants alter column settings set default
  '{"expThreshold":10000000,"poThreshold":20000000,"tolerancePct":2,"terms":30,"accounting":{"regime":"TT133","version":"2016"}}';

update tenants set settings = settings || '{"accounting":{"regime":"TT133","version":"2016"}}'::jsonb
where not (settings ? 'accounting');
