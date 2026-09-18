import { defineConfig } from "vitest/config";

// Cấu hình riêng cho integration test (cần web server + DB thật). Chạy qua `npm run test:db` (tests/db/run.ts).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    // CI (GitHub Actions) chậm/độ trễ mạng tới Supabase cao hơn máy dev; test cấp số song song
    // (20 request, serialize trên khoá dòng doc_sequences) từng timeout ở 30s trên CI dù máy dev ~11s.
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
