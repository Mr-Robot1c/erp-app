import { afterEach, describe, expect, it } from "vitest";
import { createTestTenant, createBareUser, admin, sql, apiUrl, PASSWORD, type TestTenant, type BareUser } from "./helper";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** auth.admin.inviteUserByEmail kiểm domain có MX thật — @test.local/@example.com bị từ chối
 * "email_address_invalid" (bắt gặp thật khi viết test này). Domain MX thật (gmail.com) qua được
 * kiểm tra dù local-part không tồn tại; Supabase chỉ validate domain lúc gọi API, không xác minh
 * hộp thư thật, nên an toàn dùng cho test (không có ai nhận được mail). */
function realMxTestEmail(prefix: string) {
  return `t_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@gmail.com`;
}

/** invite tạo user thật qua Supabase (không đặt mật khẩu) — set mật khẩu bằng admin API để giả lập
 * "người được mời bấm link, đặt mật khẩu", rồi đăng nhập được bằng password bình thường. */
async function claimInvite(email: string) {
  const [row] = await sql`select id from auth.users where email = ${email}`;
  if (!row) throw new Error(`Không thấy user vừa được invite: ${email}`);
  const { error } = await admin.auth.admin.updateUserById(row.id as string, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr || !data.session) throw signInErr ?? new Error("signIn thất bại sau khi claim invite");
  return { userId: row.id as string, accessToken: data.session.access_token };
}

describe("mời người + nhận lời mời", () => {
  let tenant: TestTenant;
  let invitedUserId: string | null;
  afterEach(async () => {
    if (invitedUserId) await admin.auth.admin.deleteUser(invitedUserId);
    invitedUserId = null;
    await tenant?.cleanup();
  });

  it("mời email X (role staff) -> X đặt mật khẩu, accept -> membership đúng vai, invite -> accepted", async () => {
    tenant = await createTestTenant({ role: "admin" });
    const { accessToken: adminToken } = await tenant.signIn();
    const email = realMxTestEmail("invite");

    const inv = await post("/api/team/invite", adminToken, { email, role: "staff" });
    expect(inv.json.ok, JSON.stringify(inv.json)).toBe(true);
    expect(inv.json.data.status).toBe("sent");

    const { userId, accessToken: inviteeToken } = await claimInvite(email);
    invitedUserId = userId;

    const acc = await post("/api/team/accept", inviteeToken, {});
    expect(acc.json.ok, JSON.stringify(acc.json)).toBe(true);
    expect(acc.json.data.tenantId).toBe(tenant.tenantId);

    const [membership] = await sql`
      select role from memberships where user_id = ${userId} and tenant_id = ${tenant.tenantId}`;
    expect(membership?.role).toBe("staff");

    const [inviteRow] = await sql`select status from invites where tenant_id = ${tenant.tenantId} and email = ${email}`;
    expect(inviteRow?.status).toBe("accepted");
  });

  it("mời trùng email 2 lần -> duplicate", async () => {
    tenant = await createTestTenant({ role: "admin" });
    const { accessToken } = await tenant.signIn();
    const email = realMxTestEmail("dup");

    const first = await post("/api/team/invite", accessToken, { email, role: "staff" });
    expect(first.json.ok, JSON.stringify(first.json)).toBe(true);

    const second = await post("/api/team/invite", accessToken, { email, role: "sales" });
    expect(second.json.ok).toBe(false);
    expect(second.json.error.code).toBe("duplicate");

    const [row] = await sql`select id from auth.users where email = ${email}`;
    if (row) invitedUserId = row.id as string; // dọn user thật do inviteUserByEmail tạo
  });

  it("accept khi không có lời mời nào -> not_found", async () => {
    const bare = await createBareUser();
    const { accessToken } = await bare.signIn();
    const res = await post("/api/team/accept", accessToken, {});
    expect(res.json.ok).toBe(false);
    expect(res.json.error.code).toBe("not_found");
    await bare.cleanup();
  });
});

describe("đổi vai + xoá thành viên", () => {
  let tenant: TestTenant;
  afterEach(async () => {
    await tenant?.cleanup();
  });

  it("admin đổi vai thành viên khác -> thành công", async () => {
    tenant = await createTestTenant({ role: "admin" });
    const { accessToken } = await tenant.signIn();
    const other = await createBareUser();
    await sql`
      insert into memberships (user_id, tenant_id, role, display_name)
      values (${other.userId}, ${tenant.tenantId}, 'staff', 'Other')`;

    const res = await post("/api/team/set-role", accessToken, { userId: other.userId, role: "sales" });
    expect(res.json.ok, JSON.stringify(res.json)).toBe(true);

    const [row] = await sql`select role from memberships where user_id = ${other.userId}`;
    expect(row?.role).toBe("sales");
    await other.cleanup();
  });

  it("hạ vai/xoá quản trị viên cuối cùng -> state_invalid, không đổi/xoá gì", async () => {
    tenant = await createTestTenant({ role: "admin" });
    const { accessToken } = await tenant.signIn();

    const demote = await post("/api/team/set-role", accessToken, { userId: tenant.userId, role: "staff" });
    expect(demote.json.ok).toBe(false);
    expect(demote.json.error.code).toBe("state_invalid");

    const remove = await post("/api/team/remove", accessToken, { userId: tenant.userId });
    expect(remove.json.ok).toBe(false);
    expect(remove.json.error.code).toBe("state_invalid");

    const [row] = await sql`select role from memberships where user_id = ${tenant.userId}`;
    expect(row?.role).toBe("admin");
  });

  it("xoá thành viên khi có ≥2 admin -> được, còn lại vẫn hoạt động", async () => {
    tenant = await createTestTenant({ role: "admin" });
    const secondAdmin = await createBareUser();
    await sql`
      insert into memberships (user_id, tenant_id, role, display_name)
      values (${secondAdmin.userId}, ${tenant.tenantId}, 'admin', 'Second Admin')`;

    const { accessToken } = await tenant.signIn();
    const res = await post("/api/team/remove", accessToken, { userId: secondAdmin.userId });
    expect(res.json.ok, JSON.stringify(res.json)).toBe(true);

    const rows = await sql`select 1 from memberships where user_id = ${secondAdmin.userId}`;
    expect(rows).toHaveLength(0);
    await secondAdmin.cleanup();
  });
});
