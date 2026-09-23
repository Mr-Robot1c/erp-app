import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

// random suffix (không chỉ Date.now()) — nhiều spec chạy song song nhiều worker có thể cùng millisecond.
const email = `e2e-ac01+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
const password = "matkhau-e2e-1";

// VS-1: test này tự đăng ký user + tenant thật qua UI (không qua fixture helper.ts) — tự dọn cả 2 ở
// đây, best-effort (KHÔNG throw ra ngoài — dọn hỏng không được làm đỏ test đã chạy xong).
test.afterAll(async () => {
  try {
    const { sql, admin, purgeTenant } = await import("../db/helper");
    const [row] = await sql`select id from auth.users where email = ${email}`;
    if (row) {
      const [m] = await sql`select tenant_id from memberships where user_id = ${row.id}`;
      if (m) await purgeTenant(m.tenant_id as string);
      await admin.auth.admin.deleteUser(row.id as string);
    }
  } catch (e) {
    console.warn("[ac-01] dọn user/tenant test thất bại (bỏ qua):", e);
  }
});

test("AC-01 đăng ký tài khoản mới -> onboarding -> vào /app thấy tên doanh nghiệp", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#btn-signup");

  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
  await expect(page.locator("#user-email")).toHaveText(email);

  await page.fill("#tenant-name", "Công ty E2E Test");
  await page.fill("#tenant-tax-code", `TX${Date.now()}`);
  await page.selectOption("#tenant-industry", "trade");
  await page.click("#btn-register");

  await expect(page).toHaveURL(/\/app/, { timeout: 20_000 });
  await expect(page.locator("#tenant-title")).toHaveText("Công ty E2E Test");
  await expect(page.locator("#user-role")).toHaveText("Quản trị viên"); // ROLE_LABEL.admin (khung /app/* lô 1.2)
});
