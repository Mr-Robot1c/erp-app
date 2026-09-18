import { afterEach, describe, expect, it } from "vitest";
import { createTestTenant, createBareUser, apiUrl, sql, type TestTenant, type BareUser } from "./helper";

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("mời người + nhận lời mời", () => {
  let tenant: TestTenant;
  let invitee: BareUser;
  afterEach(async () => {
    await invitee?.cleanup();
    await tenant?.cleanup();
  });

  it("mời email X (role staff) -> X đăng nhập, accept -> membership đúng vai, invite -> accepted", async () => {
    tenant = await createTestTenant({ role: "admin" });
    invitee = await createBareUser();
    const { accessToken: adminToken } = await tenant.signIn();

    const inv = await post("/api/team/invite", adminToken, { email: invitee.email, role: "staff" });
    expect(inv.json.ok, JSON.stringify(inv.json)).toBe(true);
    expect(inv.json.data.status).toBe("sent");

    const { accessToken: inviteeToken } = await invitee.signIn();
    const acc = await post("/api/team/accept", inviteeToken, {});
    expect(acc.json.ok, JSON.stringify(acc.json)).toBe(true);
    expect(acc.json.data.tenantId).toBe(tenant.tenantId);

    const [membership] = await sql`
      select role from memberships where user_id = ${invitee.userId} and tenant_id = ${tenant.tenantId}`;
    expect(membership?.role).toBe("staff");

    const [inviteRow] = await sql`select status from invites where tenant_id = ${tenant.tenantId} and email = ${invitee.email}`;
    expect(inviteRow?.status).toBe("accepted");
  });

  it("mời trùng email 2 lần -> duplicate", async () => {
    tenant = await createTestTenant({ role: "admin" });
    const { accessToken } = await tenant.signIn();
    const email = `t_test_dup_${Math.random().toString(36).slice(2, 8)}@test.local`;

    const first = await post("/api/team/invite", accessToken, { email, role: "staff" });
    expect(first.json.ok).toBe(true);

    const second = await post("/api/team/invite", accessToken, { email, role: "sales" });
    expect(second.json.ok).toBe(false);
    expect(second.json.error.code).toBe("duplicate");
  });

  it("accept khi không có lời mời nào -> not_found", async () => {
    invitee = await createBareUser();
    const { accessToken } = await invitee.signIn();
    const res = await post("/api/team/accept", accessToken, {});
    expect(res.json.ok).toBe(false);
    expect(res.json.error.code).toBe("not_found");
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
