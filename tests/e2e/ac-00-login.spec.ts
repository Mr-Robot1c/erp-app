import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

// random suffix (không chỉ Date.now()) — nhiều spec chạy song song nhiều worker có thể cùng millisecond,
// trùng email làm signUp báo "đã đăng ký" (gặp thật khi thêm ac-01 chạy cùng lúc).
const email = `e2e-ac00+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
const password = "matkhau-e2e-1";

// VS-1: test này tự đăng ký user thật qua UI (không qua fixture helper.ts) — tự dọn ngay ở đây thay
// vì để tích rác, best-effort (KHÔNG throw ra ngoài — dọn hỏng không được làm đỏ test đã chạy xong).
test.afterAll(async () => {
  try {
    const { sql, admin } = await import("../db/helper");
    const [row] = await sql`select id from auth.users where email = ${email}`;
    if (row) await admin.auth.admin.deleteUser(row.id as string);
  } catch (e) {
    console.warn("[ac-00] dọn user test thất bại (bỏ qua):", e);
  }
});

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
