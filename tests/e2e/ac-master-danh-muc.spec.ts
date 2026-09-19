import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("Danh mục: admin thêm khách + mặt hàng thật trên UI -> lập báo giá chọn được mặt hàng vừa thêm; mã trùng báo lỗi tiếng Việt", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  try {
    await page.goto("/login");
    await page.fill("#email", tenant.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/master");
    // Khách hàng
    await page.click("#btn-add");
    await page.fill("#f-code", "KH-THAT");
    await page.fill("#f-name", "Công ty Khách Thật");
    await page.fill("#f-credit", "50000000");
    await page.click("#btn-save");
    await expect(page.locator('tr[data-code="KH-THAT"]')).toBeVisible({ timeout: 30_000 });

    // Trùng mã -> lỗi tiếng Việt, form còn mở
    await page.click("#btn-add");
    await page.fill("#f-code", "KH-THAT");
    await page.fill("#f-name", "Trùng");
    await page.click("#btn-save");
    await expect(page.locator("#master-err")).toContainText("đã tồn tại", { timeout: 30_000 });
    await page.getByRole("button", { name: "Huỷ" }).click();

    // Mặt hàng
    await page.click('button[data-tab="items"]');
    await page.click("#btn-add");
    await page.fill("#f-code", "SP-THAT");
    await page.fill("#f-name", "Sản phẩm Thật");
    await page.fill("#f-price", "250000");
    await page.fill("#f-cost", "150000");
    await page.click("#btn-save");
    await expect(page.locator('tr[data-code="SP-THAT"]')).toBeVisible({ timeout: 30_000 });

    // Sửa giá: mã không sửa được
    await page.locator('tr[data-code="SP-THAT"]').click();
    await expect(page.locator("#f-code")).toBeDisabled();
    await page.fill("#f-price", "300000");
    await page.click("#btn-save");
    await expect(page.locator('tr[data-code="SP-THAT"]')).toContainText("300.000", { timeout: 30_000 });

    // Kho
    await page.click('button[data-tab="warehouses"]');
    await page.click("#btn-add");
    await page.fill("#f-code", "KHO-THAT");
    await page.fill("#f-name", "Kho Thật");
    await page.click("#btn-save");
    await expect(page.locator('tr[data-code="KHO-THAT"]')).toBeVisible({ timeout: 30_000 });

    // Lập báo giá bằng mặt hàng vừa thêm
    await page.goto("/app/sales");
    await page.click("#btn-new-quote");
    await page.click("#partner-picker");
    await page.fill("#partner-picker", "KH-THAT");
    await page.getByRole("button", { name: /Công ty Khách Thật/ }).click();
    const [{ id: itemId }] = await h.sql`select id from items where tenant_id = ${tenant.tenantId} and code = 'SP-THAT'`;
    await page.selectOption("select.li", itemId);
    await expect(page.locator("input.lp")).toHaveValue("300000");
    await page.click("#btn-save-quote");
    await expect(page.locator("#btn-confirm-quote")).toBeVisible({ timeout: 30_000 });
  } finally {
    await tenant.cleanup();
  }
});
