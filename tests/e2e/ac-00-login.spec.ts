import { test, expect } from "@playwright/test";

const email = `e2e+${Date.now()}@test.local`;
const password = "matkhau-e2e-1";

test("AC-00 đăng ký, đăng xuất, đăng nhập lại được", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#btn-signup");
  await expect(page.locator("#user-email")).toHaveText(email, { timeout: 20_000 });

  await page.click("#btn-signout");
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#btn-signin");
  await expect(page.locator("#user-email")).toHaveText(email, { timeout: 20_000 });
});

test("AC-00b chưa đăng nhập vào /app bị đưa về /login", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});
