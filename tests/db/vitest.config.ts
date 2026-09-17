import { defineConfig } from "vitest/config";

// Cấu hình riêng cho integration test (cần web server + DB thật). Chạy qua `npm run test:db` (tests/db/run.ts).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
