# Core

Module thuần TypeScript. `src/labels.ts` định nghĩa nhãn/vai/loại dùng chung; `src/errors.ts` định nghĩa lỗi; `src/schemas.ts` chứa validation; `src/index.ts` là public entrypoint. Đối chiếu file trước khi sử dụng export.

Không import web, React, Supabase hoặc kết nối DB. Logic mới chỉ thêm theo AC của lô đang làm. Test thuần đặt trong `test/` và chạy qua `npm run test` ở repo root.

Bản đồ và giới hạn hiện tại: [cấu trúc thực tế](../../../docs/app-map/08-app-structure-real.md).
