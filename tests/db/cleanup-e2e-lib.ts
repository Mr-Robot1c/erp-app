/**
 * Chọn rác test để dọn (VS-1 + VS-1.1) — tách khỏi cleanup-e2e.ts (script chạy ngay khi import) để test được.
 * Không import helper.ts: `sql`/`admin` truyền vào, nên file này không đọc biến môi trường lúc nạp.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type postgres from "postgres";

// Mẫu rác biết chắc: helper.ts DB fixture (t_test_<rand>@test.local) + e2e ac-00/ac-01 UI thật
// (e2e-ac00+<ts>-<rand>@test.local, e2e-ac01+<ts>-<rand>@test.local). KHÔNG khớp email nào khác.
export const TEST_EMAIL_RE = /^(t_test_[a-z0-9]+|e2e-[a-z0-9]+\+[a-z0-9-]+)@test\.local$/i;
// Tên tenant rác biết chắc: "Test <rand>" (helper.ts) + "Công ty E2E Test" (ac-01, LUÔN đúng chữ này).
export const TEST_TENANT_NAME_RE = /^(Test [a-z0-9]+|Công ty E2E Test)$/i;

// Danh sách bảo vệ CỨNG — không bao giờ xoá dù có (nhầm) khớp mẫu ở trên.
export const PROTECTED_TAX_CODES = new Set(["0109990001"]); // Công ty Demo
export const PROTECTED_TENANT_NAMES = new Set(["Công ty Demo", "Công ty TNHH ABC"]);
export const PROTECTED_EMAILS = new Set([
  "admin@demo.vn", "giamdoc@demo.vn", "tkd@demo.vn", "tbp@demo.vn", "kd@demo.vn",
  "kho@demo.vn", "mua@demo.vn", "kt@demo.vn", "ktt@demo.vn",
]);

/** Chỉ xoá rác già hơn ngần này (VS-1.1): fixture của test/CI đang chạy — kể cả run KHÁC hoặc lần chạy tay lúc CI chạy — không bao giờ bị xoá giữa chừng. */
export const MIN_AGE_MS = 2 * 60 * 60 * 1000;

export type GarbageTenant = { id: string; name: string; tax_code: string | null; created_at: Date };
export type GarbageUser = { id: string; email: string; created_at: string };

export async function findGarbage(
  sql: postgres.Sql,
  admin: SupabaseClient,
  opts: { all?: boolean; now?: Date } = {},
): Promise<{ tenants: GarbageTenant[]; users: GarbageUser[] }> {
  const cutoff = (opts.now ?? new Date()).getTime() - MIN_AGE_MS;
  const oldEnough = (createdAt: Date | string) => opts.all === true || new Date(createdAt).getTime() < cutoff;

  const tenantRows = await sql<GarbageTenant[]>`select id, name, tax_code, created_at from tenants order by created_at`;
  const tenants = tenantRows.filter(
    (t) =>
      TEST_TENANT_NAME_RE.test(t.name) &&
      !PROTECTED_TENANT_NAMES.has(t.name) &&
      !PROTECTED_TAX_CODES.has(t.tax_code ?? "") &&
      oldEnough(t.created_at),
  );

  const users: GarbageUser[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) break;
    for (const u of data.users) {
      const email = u.email ?? "";
      if (TEST_EMAIL_RE.test(email) && !PROTECTED_EMAILS.has(email.toLowerCase()) && oldEnough(u.created_at)) {
        users.push({ id: u.id, email, created_at: u.created_at });
      }
    }
    if (data.users.length < 200) break;
  }
  return { tenants, users };
}
