# ERP app — AI-Simple core

Git root là thư mục này. Tài liệu canonical nằm ở `../docs/`, theo quyết định kỹ thuật hiện có; không sao chép thành một bộ spec khác trong repo.

## Context tối thiểu

- [Hướng dẫn workspace](../AGENTS.md).
- [Luật thi công](../docs/plans/playbook/00-luat-thi-cong.md), [tiến độ](../docs/plans/tien-do-web-erp.md), [quyết định kỹ thuật](../docs/plans/playbook/02-quyet-dinh-ky-thuat.md).
- [App-map](../docs/app-map/README.md) → tài liệu của module đang sửa.
- Trong `apps/web`, đọc `apps/web/AGENTS.md` và tài liệu Next.js cục bộ theo hướng dẫn đó trước khi viết code.
- Nếu chỉ clone repo và thiếu `../docs/`, báo thiếu context trước khi sửa nghiệp vụ; không suy đoán AC hoặc tạo bản thay thế.

## Ranh giới và invariants

- `packages/core` chứa nghiệp vụ/schema/nhãn dùng chung; không import Next.js, React, Supabase hoặc DB vào đó.
- Client ghi qua API server; xác thực và tenant lấy từ membership phía server. Tenant do client gửi không phải nguồn quyền.
- Tiền dùng VND nguyên trong logic, `numeric` trong DB. Nhãn loại/vai canonical ở `packages/core/src/labels.ts`.
- Migration đã áp dụng chỉ được nối tiếp bằng file mới. Quy tắc FK cùng tenant, chứng từ bất biến và idempotency phải theo playbook của lô; xem app-map để biết phần nào chưa triển khai.
- DB dev, CI và Vercel hiện dùng chung một Supabase project theo playbook. Không suy luận rằng tên “dev” có nghĩa là dữ liệu dùng một lần.
- Không đưa secret vào log, docs hoặc Git. Danh sách thư viện và biến môi trường theo quyết định kỹ thuật.

## Kiểm tra và đồng bộ

Chạy lệnh từ repo này:

| Mục đích | Lệnh |
|---|---|
| Baseline / kiểm tra code cục bộ | `npm run check` |
| Chạy web | `npm run dev` |
| Build | `npm run build` |
| Tách tenant / API + DB | `npm run test:db` — có tạo/xoá dữ liệu test trên DB cấu hình |
| Hành vi trình duyệt | `npm run e2e` — cần cấu hình môi trường |

`check` gồm lint, typecheck, unit; không thay thế DB integration hoặc E2E. Chọn thêm kiểm tra đúng thay đổi, ghi rõ phần chưa chạy.

| Thay đổi | Tài liệu / kiểm tra đi kèm |
|---|---|
| Core, validation, API | `../docs/app-map/08-app-structure-real.md`; unit hoặc integration phù hợp |
| Schema, RLS, tenant | `../docs/app-map/03-database-and-auth.md`; isolation + test nghiệp vụ liên quan |
| Hành vi sản phẩm | AC trong `../docs/app-map/02-erp-chuan-ba-spec.md`; test AC tương ứng |
| Hoàn tất lô | `../docs/plans/tien-do-web-erp.md`; đủ kiểm tra trong playbook rồi mới tick |

Kiểm tra diff trước bàn giao. Không stage file ngoài scope. Quy tắc commit của lô nghiệp vụ nằm trong playbook; yêu cầu áp dụng skill không tự mở một lô mới hoặc yêu cầu push/deploy.
