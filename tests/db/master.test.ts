import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestTenant, addTenantMember, createWarehouse, apiUrl, sql, type TestTenant, type TenantMember } from "./helper";

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("lô 3.0 — Danh mục: thêm/sửa khách, mặt hàng, kho; xoá dữ liệu mẫu", () => {
  let tenant: TestTenant;
  let acc: TenantMember;
  let sales: TenantMember;
  let adminTok: string;
  let accTok: string;
  let salesTok: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ role: "admin" });
    acc = await addTenantMember(tenant.tenantId, "accountant");
    sales = await addTenantMember(tenant.tenantId, "sales");
    adminTok = (await tenant.signIn()).accessToken;
    accTok = (await acc.signIn()).accessToken;
    salesTok = (await sales.signIn()).accessToken;
  });

  afterAll(async () => {
    await acc?.cleanup();
    await sales?.cleanup();
    await tenant?.cleanup();
  });

  it("đối tác: kế toán tạo + sửa được (tên, loại, hạn mức); mã bất biến; trùng mã → duplicate", async () => {
    const created = await post("/api/master/partners", accTok, { code: "KH-A", name: "Khách A", kind: "customer", creditLimit: 1_000_000 });
    expect(created.json.ok, JSON.stringify(created.json)).toBe(true);
    const id = created.json.data.id as string;

    const dup = await post("/api/master/partners", adminTok, { code: "KH-A", name: "Khác", kind: "customer" });
    expect(dup.json.error.code).toBe("duplicate");

    const upd = await post("/api/master/partners/update", accTok, { id, name: "Khách A (mới)", kind: "both", creditLimit: 5_000_000 });
    expect(upd.json.ok, JSON.stringify(upd.json)).toBe(true);
    const [row] = await sql`select name, kind, credit_limit, code from partners where id = ${id}`;
    expect(row.name).toBe("Khách A (mới)");
    expect(row.kind).toBe("both");
    expect(Number(row.credit_limit)).toBe(5_000_000);

    const sameCode = await post("/api/master/partners/update", accTok, { id, code: "KH-A", name: "Vẫn được" });
    expect(sameCode.json.ok).toBe(true);
    const changeCode = await post("/api/master/partners/update", accTok, { id, code: "KH-B" });
    expect(changeCode.json.error.code).toBe("invalid_argument");
    const [after] = await sql`select code from partners where id = ${id}`;
    expect(after.code).toBe("KH-A");

    const missing = await post("/api/master/partners/update", accTok, { id: randomUUID(), name: "x" });
    expect(missing.json.error.code).toBe("not_found");
  });

  it("mặt hàng: sửa giá/tên được; mã bất biến; đã có tồn thì không đổi loại/đơn vị/theo dõi", async () => {
    const created = await post("/api/master/items", accTok, { code: "SP-1", name: "Sản phẩm 1", kind: "goods", uom: "cái", price: 100_000, cost: 60_000 });
    expect(created.json.ok, JSON.stringify(created.json)).toBe(true);
    const id = created.json.data.id as string;

    const dup = await post("/api/master/items", adminTok, { code: "SP-1", name: "x", kind: "goods" });
    expect(dup.json.error.code).toBe("duplicate");

    const upd = await post("/api/master/items/update", accTok, { id, name: "Sản phẩm 1b", price: 120_000, cost: 70_000, kind: "material", uom: "kg", tracking: "lot" });
    expect(upd.json.ok, JSON.stringify(upd.json)).toBe(true);
    const [row] = await sql`select name, price, cost, kind, uom, tracking from items where id = ${id}`;
    expect([row.name, Number(row.price), Number(row.cost), row.kind, row.uom, row.tracking]).toEqual(["Sản phẩm 1b", 120_000, 70_000, "material", "kg", "lot"]);

    const changeCode = await post("/api/master/items/update", accTok, { id, code: "SP-2" });
    expect(changeCode.json.error.code).toBe("invalid_argument");

    const whId = await createWarehouse(tenant.tenantId, "KM1");
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${id}, ${whId}, 3, 70000)`;
    const structural = await post("/api/master/items/update", accTok, { id, kind: "goods" });
    expect(structural.json.error.code).toBe("invalid_argument");
    const priceOnly = await post("/api/master/items/update", accTok, { id, price: 130_000 });
    expect(priceOnly.json.ok, JSON.stringify(priceOnly.json)).toBe(true);
  });

  it("kho: tạo được, trùng mã → duplicate, mã sai → invalid_argument", async () => {
    const ok = await post("/api/master/warehouses", accTok, { code: "K-NEW", name: "Kho mới" });
    expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    const dup = await post("/api/master/warehouses", adminTok, { code: "K-NEW", name: "Kho khác" });
    expect(dup.json.error.code).toBe("duplicate");
    const bad = await post("/api/master/warehouses", adminTok, { code: "K NEW!", name: "x" });
    expect(bad.json.error.code).toBe("invalid_argument");
  });

  it("xoá dữ liệu mẫu: mẫu chưa dùng biến mất, mẫu đã dùng còn (bỏ cờ mẫu), dữ liệu thật không đụng; chỉ admin", async () => {
    const tid = tenant.tenantId;
    const [unusedP] = await sql`insert into partners (tenant_id, code, name, kind, is_sample) values (${tid}, 'MAU-P1', 'Mẫu chưa dùng', 'customer', true) returning id`;
    const [usedP] = await sql`insert into partners (tenant_id, code, name, kind, is_sample) values (${tid}, 'MAU-P2', 'Mẫu đã dùng', 'customer', true) returning id`;
    await sql`insert into partner_advances (tenant_id, partner_id, amount) values (${tid}, ${usedP.id}, 1000)`;
    const [realP] = await sql`insert into partners (tenant_id, code, name, kind) values (${tid}, 'THAT-P1', 'Khách thật', 'customer') returning id`;
    const [unusedI] = await sql`insert into items (tenant_id, code, name, kind, is_sample) values (${tid}, 'MAU-I1', 'Mẫu chưa dùng', 'goods', true) returning id`;
    const [usedI] = await sql`insert into items (tenant_id, code, name, kind, is_sample) values (${tid}, 'MAU-I2', 'Mẫu có tồn', 'goods', true) returning id`;
    const whId = await createWarehouse(tid, "KM2");
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tid}, ${usedI.id}, ${whId}, 2, 100)`;

    const denied = await post("/api/master/remove-sample", accTok, {});
    expect(denied.status).toBe(403);
    const deniedSales = await post("/api/master/remove-sample", salesTok, {});
    expect(deniedSales.status).toBe(403);

    const res = await post("/api/master/remove-sample", adminTok, {});
    expect(res.json.ok, JSON.stringify(res.json)).toBe(true);
    expect(res.json.data.removedPartners).toBe(1);
    expect(res.json.data.removedItems).toBe(1);

    const alive = async (table: "partners" | "items", id: string) => (await sql`select is_sample from ${sql(table)} where id = ${id}`)[0];
    expect(await alive("partners", unusedP.id)).toBeUndefined();
    expect((await alive("partners", usedP.id))?.is_sample).toBe(false);
    expect((await alive("partners", realP.id))?.is_sample).toBe(false);
    expect(await alive("items", unusedI.id)).toBeUndefined();
    expect((await alive("items", usedI.id))?.is_sample).toBe(false);

    const again = await post("/api/master/remove-sample", adminTok, {});
    expect(again.json.data).toEqual({ removedPartners: 0, removedItems: 0 });
  });
});
