import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// `npm test` = unit thuần (packages). Test DB/integration chạy riêng qua `npm run test:db` (tests/db/run.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "@erp/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
  },
});
