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

test("UX-1 Việc cần làm: thủ kho chỉ thấy việc kho + badge đúng + bấm dòng mở chứng từ; admin có chip Cả công ty (chỉ đọc)", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const wh = await h.addTenantMember(tenant.tenantId, "warehouse");
  try {
    const partnerId = await h.createPartner(tenant.tenantId, "KH1");
    const [so] = await h.sql`insert into documents (tenant_id, doc_type, doc_no, status, partner_id) values (${tenant.tenantId}, 'SO', 'ĐB-9001', 'confirmed', ${partnerId}) returning id`;
    await h.sql`insert into tasks (tenant_id, role, text, document_id) values
      (${tenant.tenantId}, 'warehouse', 'Xuất kho ĐB-9001', ${so.id}),
      (${tenant.tenantId}, 'accountant', 'Việc của kế toán không liên quan kho', null)`;

    // Thủ kho
    await login(page, wh.email, h.PASSWORD);
    await page.goto("/app/tasks");
    await expect(page.locator("#task-list li")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#task-list li").first()).toHaveAttribute("data-task-role", "warehouse");
    await expect(page.getByText("Việc của kế toán không liên quan kho")).toHaveCount(0);
    await expect(page.locator("#task-chips")).toHaveCount(0); // vai thường không có chip Cả công ty
    await expect(page.locator("#task-badge")).toHaveText("1"); // badge sidebar = việc CỦA TÔI
    await expect(page.getByRole("button", { name: "Duyệt", exact: true })).toHaveCount(0);

    // Bấm dòng → mở chứng từ liên quan trong modal
    await page.locator("#task-list li button").first().click();
    await expect(page.locator("h2", { hasText: "ĐB-9001" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#task-open-module")).toHaveAttribute("href", /\/app\/sales\?open=/);
    await page.keyboard.press("Escape");

    // Admin: mặc định Của tôi (rỗng), chip Cả công ty cho toàn cảnh, mọi việc chỉ-đọc
    await page.click("#btn-signout");
    await expect(page).toHaveURL(/\/login/);
    await login(page, tenant.email, h.PASSWORD);
    await page.goto("/app/tasks");
    await expect(page.locator("#task-chips")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#tasks-empty")).toHaveText("Không có việc nào đang chờ bạn.");
    await expect(page.locator("#task-badge")).toHaveCount(0); // admin không có việc mang vai admin
    await page.click('[data-chip="all"]');
    await expect(page.locator("#task-list li")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Duyệt", exact: true })).toHaveCount(0);
  } finally {
    await wh.cleanup();
    await tenant.cleanup();
  }
});
