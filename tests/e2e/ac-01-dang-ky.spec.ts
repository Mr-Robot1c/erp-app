import { test, expect } from "@playwright/test";

// random suffix (không chỉ Date.now()) — nhiều spec chạy song song nhiều worker có thể cùng millisecond.
const email = `e2e-ac01+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
const password = "matkhau-e2e-1";

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
  await expect(page.locator("#user-role")).toHaveText("admin");
});
