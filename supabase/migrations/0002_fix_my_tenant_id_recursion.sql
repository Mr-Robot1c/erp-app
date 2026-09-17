-- 0001_core.sql định nghĩa my_tenant_id() chạy với quyền người gọi -> SELECT của nó trên
-- bảng memberships lại bị chính RLS của memberships chặn (policy gọi lại my_tenant_id()),
-- gây đệ quy vô hạn -> Postgres lỗi "54001 stack depth limit exceeded" ở MỌI bảng.
-- Sửa: security definer + search_path cố định để hàm bỏ qua RLS khi tự tra cứu tenant của
-- chính người gọi (mẫu chuẩn của Supabase cho loại hàm này).
create or replace function my_tenant_id() returns uuid
language sql stable security definer set search_path = public as
  $$ select tenant_id from memberships where user_id = auth.uid() $$;
