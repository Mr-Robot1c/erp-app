import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-21 thủ kho nhận hàng theo đơn mua trên UI -> phiếu nhập, tồn tăng, đợt cuối nhận thiếu báo lệch cho mua hàng", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const buyer = await h.addTenantMember(tenant.tenantId, "purchasing");
  const lead = await h.addTenantMember(tenant.tenantId, "dept_lead");
  const wh = await h.addTenantMember(tenant.tenantId, "warehouse");
  try {
    const supplierId = await h.createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    const itemId = await h.createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    await h.createWarehouse(tenant.tenantId, "K1");

    // Đơn mua 100 đã xác nhận (mua hàng lập, trưởng bộ phận duyệt) bằng API.
    const tok = async (m: { signIn: () => Promise<{ accessToken: string }> }) => (await m.signIn()).accessToken;
    const call = async (t: string, path: string, body: unknown, key?: string) =>
      (
        await fetch(h.apiUrl(path), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify(body),
        })
      ).json();
    const po = await call(await tok(buyer), "/api/purchase/orders", { supplierId, lines: [{ itemId, qty: 100, price: 10_000 }] }, crypto.randomUUID());
    await call(await tok(buyer), "/api/purchase/orders/confirm", { poId: po.data.id });
    await call(await tok(lead), "/api/approvals/decide", { docId: po.data.id, decision: "approve" });

    await page.goto("/login");
    await page.fill("#email", wh.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/buy");
    await page.getByRole("button", { name: /Đơn mua/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    await page.click("#btn-receive");
    await expect(page.locator("#receive-form input.rq")).toBeVisible({ timeout: 30_000 });
    await page.fill("#receive-form input.rq", "95");
    await page.check("#receive-final");
    await page.click("#btn-confirm-receive");

    await expect(page.locator("h2", { hasText: "Phiếu nhập" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Lệch so với đơn")).toBeVisible();
    await expect(page.getByText("-5")).toBeVisible();

    const [{ n }] = await h.sql`select count(*)::int n from tasks where tenant_id = ${tenant.tenantId} and role = 'purchasing' and text like 'Nhập lệch%' and not done`;
    expect(n).toBe(1);
    const [{ v }] = await h.sql`select coalesce(sum(qty),0) v from stock_moves where tenant_id = ${tenant.tenantId} and item_id = ${itemId}`;
    expect(Number(v)).toBe(95);
  } finally {
    await buyer.cleanup();
    await lead.cleanup();
    await wh.cleanup();
    await tenant.cleanup();
  }
});
