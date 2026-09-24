import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("UI-2 dark mode: sáng mặc định; bấm toggle -> <html data-theme=dark> + nền body đổi; tải lại vẫn tối (localStorage); bấm lại về sáng", async ({ page }) => {
  test.setTimeout(120_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  try {
    await page.goto("/login");
    await page.fill("#email", tenant.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    // Mặc định SÁNG (không theo prefers-color-scheme): không có data-theme.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    const light = await bodyBg();

    await page.click("#btn-theme");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await bodyBg();
    expect(dark).not.toBe(light);
    expect(await page.evaluate(() => localStorage.getItem("erp-theme"))).toBe("dark");

    // Tải lại: script boot trong layout giữ chế độ tối TRƯỚC khi vẽ.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBg()).toBe(dark);

    await page.click("#btn-theme");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    expect(await bodyBg()).toBe(light);
    expect(await page.evaluate(() => localStorage.getItem("erp-theme"))).toBe("light");
  } finally {
    await tenant.cleanup();
  }
});
