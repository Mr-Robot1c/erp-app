import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-10 thủ kho thấy tồn/giữ/khả dụng sau khi đơn bán giữ hàng, thiếu thì đơn có tham chiếu yêu cầu mua", async ({ page }) => {
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
    await h.sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${whId}, 3, 500000)`;

    const { accessToken } = await sales.signIn();
    const call = async (path: string, body: unknown, key?: string) =>
      (
        await fetch(h.apiUrl(path), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify(body),
        })
      ).json();
    const q = await call("/api/quotes", { partnerId, lines: [{ itemId, qty: 5, price: 1_000_000 }] }, crypto.randomUUID());
    await call("/api/quotes/confirm", { quoteId: q.data.id });
    const o = await call("/api/quotes/to-order", { quoteId: q.data.id, terms: "cash", depositPct: 0 }, crypto.randomUUID());
    await call("/api/orders/confirm", { orderId: o.data.id }); // cần 5, kho 3 -> giữ 3, PR 2

    await page.goto("/login");
    await page.fill("#email", wh.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 20_000 });

    await page.goto("/app/stock");
    const row = page.locator('tr[data-item-code="X"]');
    await expect(row).toContainText("3"); // tồn 3, đang giữ 3, khả dụng 0
    await expect(row.locator("td").nth(4)).toHaveText("0");

    await page.goto("/app/sales");
    await page.getByRole("button", { name: /Đơn bán/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    await expect(page.locator("#btn-refulfil")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/YM-\d{4}/).first()).toBeVisible(); // tham chiếu yêu cầu mua tự sinh
  } finally {
    await sales.cleanup();
    await wh.cleanup();
    await tenant.cleanup();
  }
});
