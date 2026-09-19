import { defineConfig } from "vitest/config";

// Cấu hình riêng cho integration test (cần web server + DB thật). Chạy qua `npm run test:db` (tests/db/run.ts).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    // CI (GitHub Actions) chậm/độ trễ mạng tới Supabase cao hơn máy dev; test cấp số song song
    // (20 request, serialize trên khoá dòng doc_sequences) từng timeout ở 30s trên CI dù máy dev ~11s.
    // Lô 2.4+: các ca trọn vòng (báo giá → đơn → xuất → hoá đơn → thu) gọi 8–10 API, mỗi API 20–40 truy vấn qua pooler
    // Singapore: ~80s trên CI, quá 60s cũ (đã đo ở CI chạy 35431888212) -> 240s.
    testTimeout: 240000,
    hookTimeout: 240000,
    fileParallelism: false,
  },
});
