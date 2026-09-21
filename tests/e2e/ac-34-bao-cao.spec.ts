import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-34 Tổng quan có thẻ KPI tiền đúng số từ sổ, bấm thẻ ra sổ nguồn, xuất Excel tải được; vai kinh doanh không thấy số tiền", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const acc = await h.addTenantMember(tenant.tenantId, "accountant");
  const sales = await h.addTenantMember(tenant.tenantId, "sales");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1");
    const [inv] = await h.sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${tenant.tenantId}, 'INV', 'HD-7001', 'done', ${partnerId}) returning id`;
    const [e] = await h.sql`insert into journal_entries (tenant_id, entry_date, document_id, memo) values (${tenant.tenantId}, current_date, ${inv.id}, 'Doanh thu HD-7001') returning id`;
    await h.sql.begin(async (t) => {
      await t`insert into journal_lines (tenant_id, entry_id, account_code, debit, credit) values
        (${tenant.tenantId}, ${e.id}, '131', 11000000, 0), (${tenant.tenantId}, ${e.id}, '511', 0, 10000000), (${tenant.tenantId}, ${e.id}, '3331', 0, 1000000)`;
    });
    await h.sql`insert into receivables (tenant_id, kind, document_id, partner_id, amount, due_date, overdue) values (${tenant.tenantId}, 'invoice', ${inv.id}, ${partnerId}, 11000000, '2020-01-01', true)`;

    await page.goto("/login");
    await page.fill("#email", acc.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app");
    await expect(page.locator('[data-kpi="revenue"] [data-value]')).toHaveText(/10\.000\.000/, { timeout: 30_000 });
    await expect(page.locator('[data-kpi="ar"] [data-value]')).toHaveText(/11\.000\.000/);
    await expect(page.locator('[data-kpi="overdue"] [data-value]')).toHaveText("1");

    // Bấm thẻ doanh thu → sổ cái đã lọc TK 511 của kỳ
    await page.locator('[data-kpi="revenue"]').click();
    await expect(page).toHaveURL(/view=ledger.*account=511/, { timeout: 30_000 });
    await expect(page.locator("#ledger-table")).toContainText("HD-7001", { timeout: 30_000 });

    // Xuất Excel sổ cái
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-export="gl"]')]);
    expect(download.suggestedFilename()).toMatch(/^bao-cao-gl-\d{4}-\d{2}\.xlsx$/);

    // Kinh doanh: chỉ thấy thẻ việc, không thấy số tiền
    await page.click("#btn-signout");
    await expect(page).toHaveURL(/\/login/);
    await page.fill("#email", sales.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });
    await page.goto("/app");
    await expect(page.locator('[data-kpi="tasks"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-kpi="revenue"]')).toHaveCount(0);
  } finally {
    await acc.cleanup();
    await sales.cleanup();
    await tenant.cleanup();
  }
});
