import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-24 kế toán trả nhà cung cấp trên UI: khoản nhỏ chi ngay, khoản vượt ngưỡng chờ kế toán trưởng", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const acc = await h.addTenantMember(tenant.tenantId, "accountant");
  try {
    const supplierId = await h.createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    await h.sql`insert into payables (tenant_id, partner_id, amount, due_date) values (${tenant.tenantId}, ${supplierId}, 50000000, '2026-10-01')`;

    await page.goto("/login");
    await page.fill("#email", acc.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/acc");
    await expect(page.locator("#ap-table")).toContainText("50.000.000");

    await page.goto("/app/buy");
    const pay = async (amount: string) => {
      await page.click("#btn-new-pay");
      await page.click("#partner-picker");
      await page.fill("#partner-picker", "NCC1");
      await page.getByRole("button", { name: /Đối tác NCC1/ }).click();
      await page.fill("#pay-amount", amount);
      await page.click("#btn-save-pay");
    };
    await pay("10000000");
    await expect(page.locator("h2 .pill.done")).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    await pay("40000000");
    await expect(page.locator("h2 .pill.pending")).toBeVisible({ timeout: 30_000 });
    const [{ n }] = await h.sql`select count(*)::int n from tasks where tenant_id = ${tenant.tenantId} and role = 'chief_accountant' and not done`;
    expect(n).toBe(1);
    const [{ paid }] = await h.sql`select paid from payables where tenant_id = ${tenant.tenantId}`;
    expect(Number(paid)).toBe(10_000_000);
  } finally {
    await acc.cleanup();
    await tenant.cleanup();
  }
});
