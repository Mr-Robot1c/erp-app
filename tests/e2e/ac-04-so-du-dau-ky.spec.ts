import dotenv from "dotenv";
import { test, expect } from "@playwright/test";

dotenv.config({ path: ".env.local" });

test("AC-04 kế toán trưởng nạp số dư đầu kỳ từ nội dung CSV: xem trước đúng, nạp xong có MỘT bút toán cân, mẫu bị xoá", async ({ page }) => {
  test.setTimeout(180_000);
  process.env.TEST_BASE_URL = "http://localhost:3000";
  const h = await import("../db/helper");
  const tenant = await h.createTestTenant({ role: "admin" });
  const chief = await h.addTenantMember(tenant.tenantId, "chief_accountant");
  try {
    await h.createItem(tenant.tenantId, "SP001", { price: 100_000, cost: 50_000 });
    await h.createWarehouse(tenant.tenantId, "K1");
    await h.createPartner(tenant.tenantId, "KH001", { creditLimit: 100_000_000 });
    await h.createPartner(tenant.tenantId, "NCC001", { kind: "supplier" });
    await h.sql`insert into partners (tenant_id, code, name, kind, is_sample) values (${tenant.tenantId}, 'MAU', 'Khách mẫu', 'customer', true)`;

    await page.goto("/login");
    await page.fill("#email", chief.email);
    await page.fill("#password", h.PASSWORD);
    await page.click("#btn-signin");
    await expect(page.locator("#tenant-title")).toBeVisible({ timeout: 30_000 });

    await page.goto("/app/acc?view=opening");
    await expect(page.locator("#opening-form")).toBeVisible({ timeout: 30_000 });
    // Dòng sai → báo lỗi kèm số dòng, nút nạp bị khoá
    await page.fill("#opening-text", "loai,ma,kho,so_luong,gia_von,so_tien\nxyz,A,,,,1");
    await expect(page.locator("#opening-errors")).toContainText("Dòng 2");
    await expect(page.locator("#btn-opening")).toBeDisabled();

    await page.fill(
      "#opening-text",
      ["loai,ma,kho,so_luong,gia_von,so_tien", "ton,SP001,K1,100,50000,", "phai_thu,KH001,,,,20000000", "phai_tra,NCC001,,,,15000000", "tien,111,,,,5000000", "tien,112,,,,30000000"].join("\n"),
    );
    await expect(page.locator("#opening-preview")).toContainText("5.000.000"); // tồn 100 × 50.000
    await expect(page.locator("#opening-preview")).toContainText("45.000.000"); // vốn chủ = 5tr + 20tr + 35tr − 15tr
    page.once("dialog", (d) => void d.accept());
    await page.click("#btn-opening");
    await expect(page.locator("#opening-done")).toBeVisible({ timeout: 30_000 });

    const entries = await h.sql`select id from journal_entries where tenant_id = ${tenant.tenantId}`;
    expect(entries).toHaveLength(1);
    const [{ d, k }] = await h.sql`select sum(debit) d, sum(credit) k from journal_lines where entry_id = ${entries[0].id}`;
    expect(Number(d)).toBe(Number(k));
    expect((await h.sql`select 1 from partners where tenant_id = ${tenant.tenantId} and is_sample`).length).toBe(0);

    // Nạp xong → màn báo đã khoá
    await page.goto("/app/acc?view=opening");
    await expect(page.locator("#opening-locked")).toBeVisible({ timeout: 30_000 });
  } finally {
    await chief.cleanup();
    await tenant.cleanup();
  }
});
