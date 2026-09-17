import { defineConfig } from "vitest/config";

// `npm test` = unit thuần (packages). Test DB/integration chạy riêng qua `npm run test:db` (tests/db/run.ts).
export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    environment: "node",
  },
});
