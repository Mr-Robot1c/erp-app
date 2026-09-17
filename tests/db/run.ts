import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import dotenv from "dotenv";

// Local: nạp .env.local (root). CI: biến môi trường đã có sẵn từ GitHub Actions.
if (existsSync(".env.local")) dotenv.config({ path: ".env.local" });

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function waitReady(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Mỗi lần gọi có timeout riêng (AbortController) — 1 request treo không được kéo
      // theo cả vòng lặp treo vô thời hạn.
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${BASE_URL}/login`, { signal: controller.signal });
      clearTimeout(t);
      if (res.status) return;
    } catch {
      // web chưa sẵn sàng hoặc request vượt timeout, thử lại
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`web không lên cổng ${PORT} sau ${timeoutMs}ms`);
}

async function main() {
  console.log("[test:db] build web...");
  run("npm", ["run", "build"]);

  console.log(`[test:db] start web trên :${PORT}...`);
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: "apps/web",
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  let exitCode = 1;
  try {
    await waitReady();
    console.log("[test:db] chạy vitest...");
    const r = spawnSync("npx", ["vitest", "run", "--config", "tests/db/vitest.config.ts"], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, TEST_BASE_URL: BASE_URL },
    });
    exitCode = r.status ?? 1;
  } catch (e) {
    console.error(e);
    exitCode = 1;
  } finally {
    server.kill();
  }
  process.exit(exitCode);
}

main();
