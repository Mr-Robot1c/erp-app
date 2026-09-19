import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-12 thủ kho xuất kho trên UI -> đơn 'Đã giao', tự sinh hoá đơn nháp, tồn giảm", async ({ page }) => {
  test.setTimeout(120_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const sales = await h.addTenantMember(tenant.tenantId, "sales");
  const wh = await h.addTenantMember(tenant.tenantId, "warehouse");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1");
    const itemId = await h.createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
    const whId = await h.createWarehouse(tenant.tenantId, "K1");
    await h.sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${whId}, 10, 500000)`;

    const { accessToken } = await sales.signIn();
    const call = async (path: string, body: unknown, key?: string) =>
      (
        await fetch(h.apiUrl(path), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify(body),
        })
      ).json();
    const q = await call("/api/quotes", { partnerId, lines: [{ itemId, qty: 4, price: 1_000_000 }] }, crypto.randomUUID());
    await call("/api/quotes/confirm", { quoteId: q.data.id });
    const o = await call("/api/quotes/to-order", { quoteId: q.data.id, terms: "cash", depositPct: 0 }, crypto.randomUUID());
    await call("/api/orders/confirm", { orderId: o.data.id });

    await page.goto("/login");
    await page.fill("#email", wh.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 20_000 });

    await page.goto("/app/sales");
    await page.getByRole("button", { name: /Đơn bán/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    await page.click("#btn-deliver");
    await page.fill("#deliver-form input.dq", "4");
    await page.fill("#deliver-form input[placeholder^='Người ký nhận']", "Anh Bình");
    await page.click("#btn-confirm-deliver");

    // Sau khi xuất, hoá đơn nháp tự sinh được mở ra.
    await expect(page.locator("h2", { hasText: "Hoá đơn bán" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("h2 .pill", { hasText: "Nháp" })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Đơn bán/ }).click();
    await expect(page.locator("tr[data-doc-no] .pill", { hasText: "Đã giao" })).toBeVisible();

    await page.goto("/app/stock");
    await expect(page.locator('tr[data-item-code="X"] td').nth(2)).toHaveText("6");
  } finally {
    await sales.cleanup();
    await wh.cleanup();
    await tenant.cleanup();
  }
});
