import dotenv from "dotenv";
import { test, expect, type Page } from "@playwright/test";

dotenv.config({ path: ".env.local" });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#btn-signin");
  await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });
}

test("AC-20 mua hàng lập đơn mua trên UI -> xác nhận chờ duyệt; trưởng bộ phận duyệt ở Việc cần làm -> đơn đã xác nhận", async ({ page }) => {
  test.setTimeout(180_000);
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const buyer = await h.addTenantMember(tenant.tenantId, "purchasing");
  const lead = await h.addTenantMember(tenant.tenantId, "dept_lead");
  try {
    await h.createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    const itemId = await h.createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });

    await login(page, buyer.email, h.PASSWORD);
    await page.goto("/app/buy");
    await page.click("#btn-new-po");
    await page.click("#partner-picker");
    await page.fill("#partner-picker", "NCC1");
    await page.getByRole("button", { name: /Đối tác NCC1/ }).click();
    await page.selectOption("select.li", itemId);
    await page.click("#btn-save-po");

    await expect(page.locator("#btn-confirm-po")).toBeVisible({ timeout: 30_000 });
    await page.click("#btn-confirm-po");
    await expect(page.locator("h2 .pill", { hasText: "Chờ duyệt" })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.click("#btn-signout");
    await expect(page).toHaveURL(/\/login/);

    await login(page, lead.email, h.PASSWORD);
    await page.goto("/app/tasks");
    await expect(page.getByText(/Duyệt đơn mua/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Duyệt", exact: true }).click();
    await expect(page.getByText("Không có việc nào đang chờ.")).toBeVisible({ timeout: 30_000 });

    const [po] = await h.sql`select status, meta from documents where tenant_id = ${tenant.tenantId} and doc_type = 'PO'`;
    expect(po.status).toBe("confirmed");
    expect(po.meta.eta).toBeTruthy();
  } finally {
    await buyer.cleanup();
    await lead.cleanup();
    await tenant.cleanup();
  }
});
