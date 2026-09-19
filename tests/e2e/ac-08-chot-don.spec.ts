import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-08 sales chuyển báo giá hợp lệ thành đơn (cọc 30%) và xác nhận -> Đã xác nhận, hiện cọc", async ({ page }) => {
  test.setTimeout(120_000);
  process.env.TEST_BASE_URL = "http://localhost:3000"; // helper gọi API của server e2e
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const sales = await h.addTenantMember(tenant.tenantId, "sales");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1");
    const itemId = await h.createItem(tenant.tenantId, "SP1", { price: 1_000_000 });

    // Báo giá hợp lệ (đúng giá bảng) tạo sẵn qua API bằng đúng tài khoản sales.
    const { accessToken } = await sales.signIn();
    const call = async (path: string, body: unknown, key?: string) =>
      (
        await fetch(h.apiUrl(path), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify(body),
        })
      ).json();
    const q = await call("/api/quotes", { partnerId, lines: [{ itemId, qty: 2, price: 1_000_000 }] }, crypto.randomUUID());
    await call("/api/quotes/confirm", { quoteId: q.data.id });

    await page.goto("/login");
    await page.fill("#email", sales.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 20_000 });

    await page.goto("/app/sales");
    await page.locator("tr[data-doc-no]").first().click();
    await page.click("#btn-to-order");
    await page.selectOption("#order-terms", "cash");
    await page.fill("#order-deposit", "30");
    await page.click("#btn-create-order");

    await expect(page.locator("#btn-confirm-order")).toBeVisible({ timeout: 30_000 });
    await page.click("#btn-confirm-order");
    await expect(page.locator("h2 .pill", { hasText: "Đã xác nhận" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("30%")).toBeVisible();
  } finally {
    await sales.cleanup();
    await tenant.cleanup();
  }
});
