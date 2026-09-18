import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { Role } from "@erp/core";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "Test@12345";

// idle_timeout: nhiều file test dùng CHUNG client này (fileParallelism:false, cùng worker) — không file nào
// được gọi sql.end() (file khác đang cần), nên để pool TỰ đóng khi rảnh thay vì đóng tay (tránh treo tiến
// trình vitest vô thời hạn, bug thật gặp ở lô 0.2).
export const sql = postgres(process.env.SUPABASE_DB_URL!, { prepare: false, max: 3, idle_timeout: 2 });

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type TestTenant = {
  tenantId: string;
  userId: string;
  email: string;
  signIn: () => Promise<{ client: ReturnType<typeof createClient>; accessToken: string }>;
  setRole: (role: Role) => Promise<void>;
  cleanup: () => Promise<void>;
};

/** Tạo 1 tenant test + 1 user thành viên, tiền tố t_test_ (02-quyet-dinh mục G). */
export async function createTestTenant(opts: { role?: Role } = {}): Promise<TestTenant> {
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `t_test_${rand}@test.local`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser thất bại");
  const userId = userData.user.id;

  const [tenant] = await sql`
    insert into tenants (name, tax_code, industry)
    values (${"Test " + rand}, ${"TX" + rand}, 'default')
    returning id`;
  const tenantId = tenant.id as string;

  await sql`
    insert into memberships (user_id, tenant_id, role, display_name)
    values (${userId}, ${tenantId}, ${opts.role ?? "staff"}, ${"Tester " + rand})`;

  return {
    tenantId,
    userId,
    email,
    async signIn() {
      const client = createClient(SUPABASE_URL, ANON_KEY);
      const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (error || !data.session) throw error ?? new Error("signIn thất bại");
      return { client, accessToken: data.session.access_token };
    },
    async setRole(role: Role) {
      await sql`update memberships set role = ${role} where user_id = ${userId}`;
    },
    async cleanup() {
      // Xoá tenant cascade xuống documents — nếu có chứng từ đã confirm, trg_doc_immutable
      // chặn DELETE trừ khi bật van `app.purge` (xem supabase/migrations/0003_documents.sql).
      await sql.begin(async (t) => {
        await t`set local app.purge = 'on'`;
        await t`delete from tenants where id = ${tenantId}`;
      });
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

export type BareUser = {
  userId: string;
  email: string;
  signIn: () => Promise<{ client: ReturnType<typeof createClient>; accessToken: string }>;
  cleanup: () => Promise<void>;
};

/** Tạo user CHƯA có membership/tenant nào — dùng cho test đăng ký doanh nghiệp (lô 1.1). */
export async function createBareUser(): Promise<BareUser> {
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `t_test_${rand}@test.local`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser thất bại");
  const userId = userData.user.id;

  return {
    userId,
    email,
    async signIn() {
      const client = createClient(SUPABASE_URL, ANON_KEY);
      const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (error || !data.session) throw error ?? new Error("signIn thất bại");
      return { client, accessToken: data.session.access_token };
    },
    async cleanup() {
      // Test có thể đã tự đăng ký tạo tenant — xoá cả tenant đó (van purge) nếu có, rồi xoá user.
      const [m] = await sql`select tenant_id from memberships where user_id = ${userId}`;
      if (m) {
        await sql.begin(async (t) => {
          await t`set local app.purge = 'on'`;
          await t`delete from tenants where id = ${m.tenant_id}`;
        });
      }
      await admin.auth.admin.deleteUser(userId);
    },
  };
}

export async function createPartner(tenantId: string, code: string) {
  const [row] = await sql`
    insert into partners (tenant_id, code, name, kind)
    values (${tenantId}, ${code}, ${"Đối tác " + code}, 'customer')
    returning id`;
  return row.id as string;
}

export async function createItem(tenantId: string, code: string) {
  const [row] = await sql`
    insert into items (tenant_id, code, name, kind)
    values (${tenantId}, ${code}, ${"Mặt hàng " + code}, 'goods')
    returning id`;
  return row.id as string;
}

export async function createWarehouse(tenantId: string, code: string) {
  const [row] = await sql`
    insert into warehouses (tenant_id, code, name)
    values (${tenantId}, ${code}, ${"Kho " + code})
    returning id`;
  return row.id as string;
}

export async function createAccount(tenantId: string, code: string) {
  const [row] = await sql`
    insert into accounts (tenant_id, code, name)
    values (${tenantId}, ${code}, ${"Tài khoản " + code})
    returning id`;
  return row.id as string;
}

export async function createPeriod(tenantId: string, ym: string) {
  const [row] = await sql`
    insert into periods (tenant_id, ym)
    values (${tenantId}, ${ym})
    returning id`;
  return row.id as string;
}

export async function createAuditLog(tenantId: string, action: string) {
  const [row] = await sql`
    insert into audit_log (tenant_id, actor, action, ref, detail)
    values (${tenantId}, 'test', ${action}, '', '')
    returning id`;
  return String(row.id);
}

export async function createDocFixture(tenantId: string, docNo: string) {
  const [row] = await sql`
    insert into documents (tenant_id, doc_type, doc_no)
    values (${tenantId}, 'QUOTE', ${docNo})
    returning id`;
  return row.id as string;
}

export async function createDocLineFixture(tenantId: string, documentId: string) {
  const [row] = await sql`
    insert into document_lines (tenant_id, document_id, line_no, qty, price)
    values (${tenantId}, ${documentId}, 1, 1, 1000)
    returning id`;
  return row.id as string;
}

export async function createDocHistoryFixture(tenantId: string, documentId: string) {
  const [row] = await sql`
    insert into doc_status_history (tenant_id, document_id, to_status)
    values (${tenantId}, ${documentId}, 'draft')
    returning id`;
  return String(row.id);
}

export async function createDocSequenceFixture(tenantId: string, docType: string) {
  await sql`
    insert into doc_sequences (tenant_id, doc_type, last_no) values (${tenantId}, ${docType}, 1)
    on conflict (tenant_id, doc_type) do nothing`;
}

export async function createIdempotencyKeyFixture(tenantId: string, key: string) {
  await sql`
    insert into idempotency_keys (tenant_id, key, endpoint, response)
    values (${tenantId}, ${key}, 'test:fixture', '{}'::jsonb)`;
}

/** Đếm bảng có cột tenant_id trong information_schema — dùng để tự phát hiện bảng mới chưa được
 * isolation.test.ts phủ (lô 0.2b việc 3). */
export async function listTenantScopedTables(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select distinct table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
    order by table_name`;
  return rows.map((r) => r.table_name);
}

export function apiUrl(path: string) {
  const base = process.env.TEST_BASE_URL ?? "http://localhost:3100";
  return base + path;
}
