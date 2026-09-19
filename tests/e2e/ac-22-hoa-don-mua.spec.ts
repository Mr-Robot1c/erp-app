import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-22/23 kế toán ghi hoá đơn mua trên UI: đúng giá -> ghi phải trả; lệch giá -> chờ kế toán trưởng", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const buyer = await h.addTenantMember(tenant.tenantId, "purchasing");
  const lead = await h.addTenantMember(tenant.tenantId, "dept_lead");
  const wh = await h.addTenantMember(tenant.tenantId, "warehouse");
  const acc = await h.addTenantMember(tenant.tenantId, "accountant");
  try {
    const supplierId = await h.createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    const itemId = await h.createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
    await h.createWarehouse(tenant.tenantId, "K1");
    const tok = async (m: { signIn: () => Promise<{ accessToken: string }> }) => (await m.signIn()).accessToken;
    const call = async (t: string, path: string, body: unknown, key?: string) =>
      (
        await fetch(h.apiUrl(path), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify(body),
        })
      ).json();
    const po = await call(await tok(buyer), "/api/purchase/orders", { supplierId, lines: [{ itemId, qty: 10, price: 10_000 }] }, crypto.randomUUID());
    await call(await tok(buyer), "/api/purchase/orders/confirm", { poId: po.data.id });
    await call(await tok(lead), "/api/approvals/decide", { docId: po.data.id, decision: "approve" });
    const rcv = await call(await tok(wh), "/api/purchase/receive", { poId: po.data.id, lines: [{ lineNo: 1, qty: 10 }] }, crypto.randomUUID());
    expect(rcv.ok, JSON.stringify(rcv)).toBe(true);

    await page.goto("/login");
    await page.fill("#email", acc.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/buy");
    await page.getByRole("button", { name: /Đơn mua/ }).click();
    await page.locator("tr[data-doc-no]").first().click();
    await page.click("#btn-vinv");
    await expect(page.locator("#vinv-form input.vq")).toBeVisible({ timeout: 30_000 });

    // Lệch giá 5% -> chờ duyệt
    await page.fill("#vinv-form input.vp", "10500");
    await page.fill("#vinv-no", "HD-UI-1");
    await page.click("#btn-confirm-vinv");
    await expect(page.locator("h2 .pill", { hasText: "Chờ duyệt" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Lệch khi đối chiếu", { exact: true })).toBeVisible();
    const [{ n }] = await h.sql`select count(*)::int n from payables where tenant_id = ${tenant.tenantId}`;
    expect(n).toBe(0);
    const [{ t }] = await h.sql`select count(*)::int t from tasks where tenant_id = ${tenant.tenantId} and role = 'chief_accountant' and not done`;
    expect(t).toBe(1);
  } finally {
    await buyer.cleanup();
    await lead.cleanup();
    await wh.cleanup();
    await acc.cleanup();
    await tenant.cleanup();
  }
});
