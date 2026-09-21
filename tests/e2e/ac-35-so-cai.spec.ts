import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-35 kế toán xem sổ cái, số dư, sổ chi tiết đối tác và bấm số chứng từ mở đúng chi tiết", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const acc = await h.addTenantMember(tenant.tenantId, "accountant");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    const [inv] = await h.sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${tenant.tenantId}, 'INV', 'HD-9001', 'done', ${partnerId}) returning id`;
    const [e] = await h.sql`insert into journal_entries (tenant_id, entry_date, document_id, memo) values (${tenant.tenantId}, current_date, ${inv.id}, 'Doanh thu HD-9001') returning id`;
    await h.sql.begin(async (t) => {
      await t`insert into journal_lines (tenant_id, entry_id, account_code, debit, credit) values (${tenant.tenantId}, ${e.id}, '131', 1100000, 0), (${tenant.tenantId}, ${e.id}, '511', 0, 1100000)`;
    });

    await page.goto("/login");
    await page.fill("#email", acc.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/acc?view=ledger");
    await expect(page.locator("#ledger-table")).toContainText("HD-9001", { timeout: 30_000 });
    await expect(page.locator("#ledger-table tfoot")).toContainText("1.100.000");

    await page.goto("/app/acc?view=balance");
    await expect(page.locator('#balance-table tr[data-account="511"]')).toContainText("1.100.000", { timeout: 30_000 });

    await page.goto(`/app/acc?view=partner&partner=${partnerId}`);
    await expect(page.locator("#partner-ledger-table")).toContainText("HD-9001", { timeout: 30_000 });

    // Bấm số chứng từ → mở chi tiết ở Bán hàng
    await page.locator("#partner-ledger-table a", { hasText: "HD-9001" }).click();
    await expect(page).toHaveURL(/\/app\/sales\?open=HD-9001/, { timeout: 30_000 });
    await expect(page.locator("h2", { hasText: "HD-9001" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await acc.cleanup();
    await tenant.cleanup();
  }
});
