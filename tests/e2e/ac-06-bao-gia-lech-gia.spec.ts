import dotenv from "dotenv";
import { test, expect, type Page } from "@playwright/test";

// Local: nạp .env.local (helper tests/db đọc biến môi trường lúc import). CI: đã có sẵn từ workflow env.
dotenv.config({ path: ".env.local" });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#btn-signin");
  await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 20_000 });
}

test("AC-06 sales lập báo giá thấp hơn giá bảng -> chờ duyệt; trưởng KD thấy nút duyệt và duyệt được", async ({ page }) => {
  test.setTimeout(120_000);
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const sales = await h.addTenantMember(tenant.tenantId, "sales");
  const lead = await h.addTenantMember(tenant.tenantId, "sales_lead");
  try {
    await h.createPartner(tenant.tenantId, "KH1");
    const itemId = await h.createItem(tenant.tenantId, "SP1", { price: 1_000_000 });

    await login(page, sales.email, h.PASSWORD);
    await page.goto("/app/sales");
    await page.click("#btn-new-quote");
    await page.click("#partner-picker");
    await page.fill("#partner-picker", "KH1");
    await page.getByRole("button", { name: /Đối tác KH1/ }).click();
    await page.selectOption("select.li", itemId);
    await page.fill("input.lp", "950000"); // thấp hơn giá bảng 5%
    await page.click("#btn-save-quote");

    await expect(page.locator("#btn-confirm-quote")).toBeVisible({ timeout: 30_000 });
    await page.click("#btn-confirm-quote");
    await expect(page.locator("h2 .pill", { hasText: "Chờ duyệt" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#btn-approve")).toHaveCount(0); // người lập không tự duyệt

    await page.keyboard.press("Escape"); // đóng modal chi tiết (đang che nút đăng xuất)
    await page.click("#btn-signout");
    await expect(page).toHaveURL(/\/login/);

    await login(page, lead.email, h.PASSWORD);
    await page.goto("/app/sales");
    await page.locator("tr[data-doc-no]").first().click();
    await expect(page.locator("#btn-approve")).toBeVisible({ timeout: 30_000 });
    await page.click("#btn-approve");
    await expect(page.locator("h2 .pill", { hasText: "Đã xác nhận" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await sales.cleanup();
    await lead.cleanup();
    await tenant.cleanup();
  }
});
