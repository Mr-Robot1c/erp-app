/**
 * VS-1: dọn rác test tích luỹ trên DB dùng chung (dev + CI + Vercel cùng trỏ 1 Supabase project).
 * e2e `ac-00`/`ac-01` tự đăng ký user thật (+ ac-01 tạo tenant thật) qua UI mỗi lần chạy, không tự
 * dọn — chạy CI nhiều lần là rác chồng lên mãi. Script này gom lại + xoá theo ĐÚNG mẫu email/tên
 * do bộ test sinh ra (không suy luận "còn/hết membership" cho email lạ — chỉ xoá thứ khớp mẫu biết
 * chắc là rác test), cộng thêm 1 lớp chặn cứng theo tên/MST/email không bao giờ được đụng.
 *
 * VS-1.1: mặc định CHỈ xoá rác già hơn 2 giờ (tenant + auth user, lọc created_at) để không đua với fixture đang sống;
 * `--all` bỏ lọc tuổi (lần dọn tay có chủ đích). Logic chọn nằm ở cleanup-e2e-lib.ts (có test).
 *
 * Chạy: `npx tsx tests/db/cleanup-e2e.ts --dry-run` (chỉ in danh sách, không xoá) rồi soát,
 * xong bỏ `--dry-run` để xoá thật. Cần `SUPABASE_DB_URL` + `SUPABASE_SERVICE_ROLE_KEY` (đọc từ
 * `.env.local` như các script test khác).
 */
import { existsSync } from "node:fs";
import dotenv from "dotenv";
if (existsSync(".env.local")) dotenv.config({ path: ".env.local" });

async function main() {
  // import ĐỘNG sau khi nạp .env.local: helper.ts đọc biến môi trường ngay lúc module chạy
  // (top-level) — import tĩnh bị hoist lên TRƯỚC dotenv.config() ở trên, chạy với biến rỗng.
  const { admin, purgeTenant, sql } = await import("./helper");

  const { findGarbage } = await import("./cleanup-e2e-lib");

  const dryRun = process.argv.includes("--dry-run");
  const all = process.argv.includes("--all");
  if (all) {
    console.warn("[cleanup-e2e] CẢNH BÁO --all: BỎ lọc tuổi 2 giờ — có thể xoá fixture của test/CI ĐANG chạy. Chỉ dùng cho lần dọn tay có chủ đích khi CHẮC không có run nào đang chạy.");
  } else {
    console.log("[cleanup-e2e] Chỉ dọn rác già hơn 2 giờ (dùng --all để bỏ lọc tuổi).");
  }

  const { tenants, users } = await findGarbage(sql, admin, { all });

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
