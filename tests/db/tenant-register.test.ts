import { afterEach, describe, expect, it } from "vitest";
import { createBareUser, apiUrl, sql, type BareUser } from "./helper";

async function register(token: string, body: unknown) {
  const res = await fetch(apiUrl("/api/tenant/register"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function randomTaxCode() {
  return `TX${Math.random().toString(36).slice(2, 10)}`;
}

describe("AC-01 đăng ký doanh nghiệp có dữ liệu mẫu", () => {
  let u: BareUser;
  afterEach(async () => {
    await u?.cleanup();
  });

  it("AC-01 đăng ký ok -> tenant mới, membership admin, danh mục mẫu is_sample=true", async () => {
    u = await createBareUser();
    const { accessToken } = await u.signIn();
    const taxCode = randomTaxCode();

    const res = await register(accessToken, { name: "Công ty Test A", taxCode, industry: "trade", withSample: true });
    expect(res.json.ok, JSON.stringify(res.json)).toBe(true);
    const tenantId = res.json.data.tenantId as string;

    const [membership] = await sql`
      select role from memberships where user_id = ${u.userId} and tenant_id = ${tenantId}`;
    expect(membership?.role).toBe("admin");

    const items = await sql`select is_sample from items where tenant_id = ${tenantId}`;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.is_sample === true)).toBe(true);

    const partners = await sql`select is_sample from partners where tenant_id = ${tenantId}`;
    expect(partners.length).toBeGreaterThan(0);
    expect(partners.every((p) => p.is_sample === true)).toBe(true);

    const accounts = await sql`select code from accounts where tenant_id = ${tenantId}`;
    expect(accounts.length).toBeGreaterThan(0);

    const warehouses = await sql`select code from warehouses where tenant_id = ${tenantId}`;
    expect(warehouses.map((w) => w.code)).toEqual(["K1"]);
  });

  it("AC-01 withSample=false -> không có đối tác mẫu", async () => {
    u = await createBareUser();
    const { accessToken } = await u.signIn();
    const taxCode = randomTaxCode();

    const res = await register(accessToken, {
      name: "Công ty Test B",
      taxCode,
      industry: "default",
      withSample: false,
    });
    expect(res.json.ok).toBe(true);

    const partners = await sql`select 1 from partners where tenant_id = ${res.json.data.tenantId}`;
    expect(partners).toHaveLength(0);
  });
});

describe("AC-02 mã số thuế trùng bị từ chối", () => {
  let u1: BareUser;
  let u2: BareUser;
  afterEach(async () => {
    await u1?.cleanup();
    await u2?.cleanup();
  });

  it("AC-02 MST đã tồn tại -> duplicate, không tạo tenant mới", async () => {
    u1 = await createBareUser();
    u2 = await createBareUser();
    const taxCode = randomTaxCode();

    const first = await register((await u1.signIn()).accessToken, {
      name: "DN 1",
      taxCode,
      industry: "default",
      withSample: false,
    });
    expect(first.json.ok).toBe(true);

    const second = await register((await u2.signIn()).accessToken, {
      name: "DN 2",
      taxCode,
      industry: "default",
      withSample: false,
    });
    expect(second.json.ok).toBe(false);
    expect(second.json.error.code).toBe("duplicate");

    const rows = await sql`select count(*)::int as n from tenants where tax_code = ${taxCode}`;
    expect(rows[0].n).toBe(1);
  });
});

describe("đăng ký lại khi đã có doanh nghiệp", () => {
  let u: BareUser;
  afterEach(async () => {
    await u?.cleanup();
  });

  it("user đã có membership gọi /api/tenant/register lần 2 -> conflict", async () => {
    u = await createBareUser();
    const { accessToken } = await u.signIn();

    const first = await register(accessToken, {
      name: "DN 1",
      taxCode: randomTaxCode(),
      industry: "default",
      withSample: false,
    });
    expect(first.json.ok).toBe(true);

    const second = await register(accessToken, {
      name: "DN 2",
      taxCode: randomTaxCode(),
      industry: "default",
      withSample: false,
    });
    expect(second.json.ok).toBe(false);
    expect(second.json.error.code).toBe("conflict");
  });
});
