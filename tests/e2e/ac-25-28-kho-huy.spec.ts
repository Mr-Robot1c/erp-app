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

test("AC-25/26 thủ kho chuyển kho và kiểm kê lệch trên UI: chuyển giữ tổng tồn; kiểm kê lập phiếu chờ duyệt, tồn chưa đổi", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const wh = await h.addTenantMember(tenant.tenantId, "warehouse");
  try {
    const itemId = await h.createItem(tenant.tenantId, "X", { price: 100, cost: 50 });
    const k1 = await h.createWarehouse(tenant.tenantId, "K1");
    const k2 = await h.createWarehouse(tenant.tenantId, "K2");
    await h.sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${k1}, 100, 50)`;

    await login(page, wh.email, h.PASSWORD);
    await page.goto("/app/stock");
    await page.click("#btn-transfer");
    await page.selectOption("#sf-item", itemId);
    await page.selectOption("#sf-from", k1);
    await page.selectOption("#sf-to", k2);
    await page.fill("#sf-qty", "4");
    await page.click("#btn-stock-save");
    await expect(page.locator("#stock-form")).toHaveCount(0, { timeout: 30_000 });
    const at = async (w: string) => Number((await h.sql`select coalesce(sum(qty),0) v from stock_moves where item_id = ${itemId} and warehouse_id = ${w}`)[0].v);
    expect(await at(k1)).toBe(96);
    expect(await at(k2)).toBe(4);

    await page.click("#btn-count");
    await page.selectOption("#sf-item", itemId);
    await page.selectOption("#sf-from", k1);
    await page.fill("#sf-qty", "93"); // sổ 96, đếm 93 -> lệch -3
    await page.fill("#sf-reason", "Đếm thiếu");
    await page.click("#btn-stock-save");
    await expect(page.locator("#sf-note")).toBeVisible({ timeout: 30_000 });
    const [adj] = await h.sql`select status, meta from documents where tenant_id = ${tenant.tenantId} and doc_type = 'ADJ'`;
    expect(adj.status).toBe("pending");
    expect(adj.meta.delta).toBe(-3);
    expect(await at(k1)).toBe(96); // chưa duyệt, tồn chưa đổi
  } finally {
    await wh.cleanup();
    await tenant.cleanup();
  }
});

test("AC-28 nhân viên bán hàng huỷ đơn đang giữ hàng trên UI -> đơn đã huỷ, hàng nhả giữ", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const sales = await h.addTenantMember(tenant.tenantId, "sales");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    const itemId = await h.createItem(tenant.tenantId, "X", { price: 100_000, cost: 50_000 });
    const k1 = await h.createWarehouse(tenant.tenantId, "K1");
    await h.sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${k1}, 3, 50000)`;
    const token = (await sales.signIn()).accessToken;
    const call = async (path: string, body: unknown, key?: string) =>
      (
        await fetch(h.apiUrl(path), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify(body),
        })
      ).json();
    const q = await call("/api/quotes", { partnerId, lines: [{ itemId, qty: 3, price: 100_000 }] }, crypto.randomUUID());
    await call("/api/quotes/confirm", { quoteId: q.data.id });
    const o = await call("/api/quotes/to-order", { quoteId: q.data.id, terms: "cash", depositPct: 0 }, crypto.randomUUID());
    const c = await call("/api/orders/confirm", { orderId: o.data.id });
    expect(c.data.status, JSON.stringify(c)).toBe("confirmed");

    await login(page, sales.email, h.PASSWORD);
    await page.goto("/app/sales");
    await page.getByRole("button", { name: /Đơn bán/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    page.once("dialog", (d) => void d.accept());
    await page.click("#btn-cancel-doc");
    await expect(page.locator("h2 .pill.cancelled")).toBeVisible({ timeout: 30_000 });
    const [{ v }] = await h.sql`select coalesce(sum(qty),0) v from reservations where document_id = ${o.data.id}`;
    expect(Number(v)).toBe(0);
  } finally {
    await sales.cleanup();
    await tenant.cleanup();
  }
});
