import dotenv from "dotenv";
import { test, expect, type Page } from "@playwright/test";

dotenv.config({ path: ".env.local" });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#btn-signin");
  await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 20_000 });
}
async function logout(page: Page) {
  await page.keyboard.press("Escape");
  await page.click("#btn-signout");
  await expect(page).toHaveURL(/\/login/);
}

test("AC-12/15/17 chuỗi trọn vòng 3 vai: sales lập→đơn, kho xuất, kế toán phát hành + thu đủ -> đơn 'Đã thực hiện'", async ({ page }) => {
  test.setTimeout(240_000);
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const sales = await h.addTenantMember(tenant.tenantId, "sales");
  const wh = await h.addTenantMember(tenant.tenantId, "warehouse");
  const acc = await h.addTenantMember(tenant.tenantId, "accountant");
  try {
    await h.createPartner(tenant.tenantId, "KH1");
    const itemId = await h.createItem(tenant.tenantId, "SP1", { price: 1_000_000, cost: 500_000 });
    const whId = await h.createWarehouse(tenant.tenantId, "K1");
    await h.sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${whId}, 5, 500000)`;

    // 1) Sales: báo giá đúng giá bảng -> gửi khách -> chuyển đơn -> xác nhận.
    await login(page, sales.email, h.PASSWORD);
    await page.goto("/app/sales");
    await page.click("#btn-new-quote");
    await page.click("#partner-picker");
    await page.fill("#partner-picker", "KH1");
    await page.getByRole("button", { name: /Đối tác KH1/ }).click();
    await page.selectOption("select.li", itemId);
    await page.click("#btn-save-quote");
    await page.click("#btn-confirm-quote");
    await expect(page.locator("h2 .pill", { hasText: "Đã xác nhận" })).toBeVisible({ timeout: 30_000 });
    await page.click("#btn-to-order");
    await page.click("#btn-create-order");
    await page.click("#btn-confirm-order");
    await expect(page.locator("h2 .pill", { hasText: "Đã xác nhận" })).toBeVisible({ timeout: 30_000 });
    await logout(page);

    // 2) Kho: xuất đủ 1.
    await login(page, wh.email, h.PASSWORD);
    await page.goto("/app/sales");
    await page.getByRole("button", { name: /Đơn bán/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    await page.click("#btn-deliver");
    await expect(page.locator("#deliver-form input.dq")).toBeVisible({ timeout: 30_000 }); // dòng giữ hàng đã tải xong
    await page.click("#btn-confirm-deliver");
    await expect(page.locator("h2", { hasText: "Hoá đơn bán" })).toBeVisible({ timeout: 30_000 });
    await logout(page);

    // 3) Kế toán: phát hành hoá đơn nháp rồi thu đủ.
    await login(page, acc.email, h.PASSWORD);
    await page.goto("/app/sales");
    await page.getByRole("button", { name: /Hoá đơn/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    await page.click("#btn-issue");
    await expect(page.locator("h2 .pill", { hasText: "Đã thực hiện" })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    await page.click("#btn-new-receipt");
    await page.click("#partner-picker");
    await page.fill("#partner-picker", "KH1");
    await page.getByRole("button", { name: /Đối tác KH1/ }).click();
    await page.fill("#receipt-amount", "1100000"); // 1tr + thuế 10%
    await page.fill("#receipt-ref", "GD-E2E-1");
    await page.click("#btn-save-receipt");
    await expect(page.locator("h2", { hasText: "Phiếu thu" })).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Đơn bán/ }).click();
    await expect(page.locator("tr[data-doc-no] .pill", { hasText: "Đã thực hiện" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await sales.cleanup();
    await wh.cleanup();
    await acc.cleanup();
    await tenant.cleanup();
  }
});
