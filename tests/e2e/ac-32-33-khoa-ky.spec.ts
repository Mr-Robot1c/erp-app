import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-32/33 kế toán trưởng: khoá kỳ bị chặn bởi phiếu thu chờ khớp tay -> khớp tay -> khoá được -> ghi bút toán vào kỳ đã khoá bị từ chối kèm gợi ý", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const chief = await h.addTenantMember(tenant.tenantId, "chief_accountant");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    const ym = new Date().toISOString().slice(0, 7);
    const [rc] = await h.sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${tenant.tenantId}, 'RCPT', 'PT-9001', 'done', ${partnerId}) returning id`;
    await h.sql`insert into receipt_allocations (tenant_id, receipt_id, receivable_id, amount, note) values (${tenant.tenantId}, ${rc.id}, null, 250000, 'Ứng trước')`;
    await h.sql`insert into partner_advances (tenant_id, partner_id, amount) values (${tenant.tenantId}, ${partnerId}, 250000)`;

    await page.goto("/login");
    await page.fill("#email", chief.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    // Khoá kỳ hiện tại → bị chặn, liệt kê phiếu thu chờ khớp
    await page.goto("/app/acc?view=period");
    page.once("dialog", (d) => void d.accept());
    await page.click(`[data-lock="${ym}"]`);
    await expect(page.locator("#period-blockers")).toContainText("PT-9001", { timeout: 30_000 });
    await expect(page.locator(`tr[data-period="${ym}"]`)).toContainText("Đang mở");

    // Khớp tay (giữ làm tiền ứng trước) ở tab Công nợ → hết chặn
    await page.goto("/app/acc?view=debt");
    await page.click(`[data-match="${rc.id}"]`);
    await expect(page.locator("#unmatched-table")).not.toContainText("PT-9001", { timeout: 30_000 });

    await page.goto("/app/acc?view=period");
    page.once("dialog", (d) => void d.accept());
    await page.click(`[data-lock="${ym}"]`);
    await expect(page.locator("#period-ok")).toBeVisible({ timeout: 30_000 });

    // Ghi bút toán tay vào kỳ đã khoá → từ chối, gợi ý ngày kỳ kế
    await page.goto("/app/acc?view=adjust");
    await page.fill("#adj-memo", "Điều chỉnh thử");
    await page.locator(".adj-acc").nth(0).fill("642");
    await page.locator(".adj-debit").nth(0).fill("100000");
    await page.locator(".adj-acc").nth(1).fill("111");
    await page.locator(".adj-credit").nth(1).fill("100000");
    await page.click("#btn-adjust");
    await expect(page.locator("#adj-err")).toContainText("đã khoá", { timeout: 30_000 });
    await expect(page.locator("#adj-err button")).toBeVisible();
  } finally {
    await chief.cleanup();
    await tenant.cleanup();
  }
});
