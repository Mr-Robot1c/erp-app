/**
 * VS-1: dọn rác test tích luỹ trên DB dùng chung (dev + CI + Vercel cùng trỏ 1 Supabase project).
 * e2e `ac-00`/`ac-01` tự đăng ký user thật (+ ac-01 tạo tenant thật) qua UI mỗi lần chạy, không tự
 * dọn — chạy CI nhiều lần là rác chồng lên mãi. Script này gom lại + xoá theo ĐÚNG mẫu email/tên
 * do bộ test sinh ra (không suy luận "còn/hết membership" cho email lạ — chỉ xoá thứ khớp mẫu biết
 * chắc là rác test), cộng thêm 1 lớp chặn cứng theo tên/MST/email không bao giờ được đụng.
 *
 * Chạy: `npx tsx tests/db/cleanup-e2e.ts --dry-run` (chỉ in danh sách, không xoá) rồi soát,
 * xong bỏ `--dry-run` để xoá thật. Cần `SUPABASE_DB_URL` + `SUPABASE_SERVICE_ROLE_KEY` (đọc từ
 * `.env.local` như các script test khác).
 */
import { existsSync } from "node:fs";
import dotenv from "dotenv";
if (existsSync(".env.local")) dotenv.config({ path: ".env.local" });

// Mẫu rác biết chắc: helper.ts DB fixture (t_test_<rand>@test.local) + e2e ac-00/ac-01 UI thật
// (e2e-ac00+<ts>-<rand>@test.local, e2e-ac01+<ts>-<rand>@test.local). KHÔNG khớp email nào khác.
const TEST_EMAIL_RE = /^(t_test_[a-z0-9]+|e2e-[a-z0-9]+\+[a-z0-9-]+)@test\.local$/i;
// Tên tenant rác biết chắc: "Test <rand>" (helper.ts) + "Công ty E2E Test" (ac-01, LUÔN đúng chữ này).
const TEST_TENANT_NAME_RE = /^(Test [a-z0-9]+|Công ty E2E Test)$/i;

// Danh sách bảo vệ CỨNG — không bao giờ xoá dù có (nhầm) khớp mẫu ở trên.
const PROTECTED_TAX_CODES = new Set(["0109990001"]); // Công ty Demo
const PROTECTED_TENANT_NAMES = new Set(["Công ty Demo", "Công ty TNHH ABC"]);
const PROTECTED_EMAILS = new Set([
  "admin@demo.vn", "giamdoc@demo.vn", "tkd@demo.vn", "tbp@demo.vn", "kd@demo.vn",
  "kho@demo.vn", "mua@demo.vn", "kt@demo.vn", "ktt@demo.vn",
]);

async function main() {
  // import ĐỘNG sau khi nạp .env.local: helper.ts đọc biến môi trường ngay lúc module chạy
  // (top-level) — import tĩnh bị hoist lên TRƯỚC dotenv.config() ở trên, chạy với biến rỗng.
  const { admin, purgeTenant, sql } = await import("./helper");

  const dryRun = process.argv.includes("--dry-run");

  const tenantRows = await sql<{ id: string; name: string; tax_code: string | null }[]>`
    select id, name, tax_code from tenants order by created_at`;
  const tenants = tenantRows.filter(
    (t) => TEST_TENANT_NAME_RE.test(t.name) && !PROTECTED_TENANT_NAMES.has(t.name) && !PROTECTED_TAX_CODES.has(t.tax_code ?? ""),
  );

  const users: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) break;
    for (const u of data.users) {
      const email = u.email ?? "";
      if (TEST_EMAIL_RE.test(email) && !PROTECTED_EMAILS.has(email.toLowerCase())) users.push({ id: u.id, email });
    }
    if (data.users.length < 200) break;
  }

  console.log(`[cleanup-e2e] Tenant rác khớp mẫu: ${tenants.length}`);
  for (const t of tenants.slice(0, 30)) console.log(`  - ${t.id}  ${t.name}  MST=${t.tax_code ?? ""}`);
  if (tenants.length > 30) console.log(`  ... còn ${tenants.length - 30} tenant nữa`);

  console.log(`[cleanup-e2e] User rác khớp mẫu: ${users.length}`);
  for (const u of users.slice(0, 30)) console.log(`  - ${u.id}  ${u.email}`);
  if (users.length > 30) console.log(`  ... còn ${users.length - 30} user nữa`);

  if (dryRun) {
    console.log("[cleanup-e2e] --dry-run: KHÔNG xoá gì. Bỏ cờ này để xoá thật.");
    return;
  }

  let tenantsDeleted = 0;
  for (const t of tenants) {
    await purgeTenant(t.id);
    tenantsDeleted++;
  }
  let usersDeleted = 0;
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) {
      console.error(`[cleanup-e2e] Xoá user ${u.email} lỗi: ${error.message}`);
      continue;
    }
    usersDeleted++;
  }

  console.log(`[cleanup-e2e] ĐÃ XOÁ: ${tenantsDeleted} tenant, ${usersDeleted} user.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
