-- Vá lỗi ghi jsonb (phát hiện lô 2.1): code server từng ghi `${JSON.stringify(x)}::jsonb` qua driver
-- `postgres`, driver mã hoá lần nữa -> cột jsonb chứa CHUỖI JSON thay vì object (documents.meta,
-- idempotency_keys.response), và `meta || <chuỗi>` biến thành mảng. Code đã đổi sang `s.json(x)`;
-- migration này sửa dữ liệu cũ về đúng object. Chỉ chạm dòng sai kiểu.
update documents set meta = (meta #>> '{}')::jsonb where jsonb_typeof(meta) = 'string';
update documents set meta = ((meta->>0)::jsonb) || ((meta->>1)::jsonb) where jsonb_typeof(meta) = 'array';
update tenants set settings = ((settings->>0)::jsonb) || ((settings->>1)::jsonb) where jsonb_typeof(settings) = 'array';
update tenants set settings = (settings #>> '{}')::jsonb where jsonb_typeof(settings) = 'string';
update idempotency_keys set response = (response #>> '{}')::jsonb where jsonb_typeof(response) = 'string';
