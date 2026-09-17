import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import type { Role } from "@erp/core";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = "Test@12345";

export const sql = postgres(process.env.SUPABASE_DB_URL!, { prepare: false, max: 3 });

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
      await sql`delete from tenants where id = ${tenantId}`;
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

export function apiUrl(path: string) {
  const base = process.env.TEST_BASE_URL ?? "http://localhost:3100";
  return base + path;
}
