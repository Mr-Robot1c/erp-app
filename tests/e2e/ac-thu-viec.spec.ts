import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("thẻ việc: Tổng quan có 3 thẻ đếm đúng, thẻ của vai đứng đầu; bấm dòng 'Hoá đơn chờ phát hành' nhảy đúng tab + pill", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const acc = await h.addTenantMember(tenant.tenantId, "accountant");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1");
    await h.sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${tenant.tenantId}, 'INV', 'HD-T1', 'draft', ${partnerId}), (${tenant.tenantId}, 'INV', 'HD-T2', 'draft', ${partnerId}), (${tenant.tenantId}, 'QUOTE', 'BG-T1', 'pending', ${partnerId})`;

    await page.goto("/login");
    await page.fill("#email", acc.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app");
    await expect(page.locator("#queue-cards [data-queue]")).toHaveCount(3);
    await expect(page.locator("#queue-cards [data-queue]").first()).toHaveAttribute("data-queue", "accounting"); // vai kế toán → thẻ kế toán đứng đầu
    await expect(page.locator('[data-queue="accounting"] [data-total]')).toHaveText("2");
    await expect(page.locator('[data-queue="sales"] [data-total]')).toHaveText("1");
    await expect(page.locator('[data-queue="accounting"] [data-row="Hoá đơn chờ phát hành"] [data-n]')).toHaveText("2");

    await page.locator('[data-queue="accounting"] [data-row="Hoá đơn chờ phát hành"] a').click();
    await expect(page).toHaveURL(/\/app\/sales\?tab=INV&status=draft/, { timeout: 30_000 });
    await expect(page.locator("tr[data-doc-no]")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Hoá đơn \(2\)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Nháp \(2\)$/ })).toBeVisible();
    // Đầu màn Bán hàng chỉ có thẻ Kinh doanh + Kho
    await expect(page.locator("#queue-cards [data-queue]")).toHaveCount(2);
  } finally {
    await acc.cleanup();
    await tenant.cleanup();
  }
});
