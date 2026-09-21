import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createItem, createPartner, createTestTenant, createWarehouse, sql, type TenantMember, type TestTenant } from "./helper";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const idem = () => ({ "idempotency-key": randomUUID() });

describe("nạp số dư đầu kỳ (lô 4.2) — AC-04", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let adminToken: string;
  let chiefToken: string;
  let accToken: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const chief = await addTenantMember(tenant.tenantId, "chief_accountant");
    const acc = await addTenantMember(tenant.tenantId, "accountant");
    members.push(chief, acc);
    adminToken = (await tenant.signIn()).accessToken;
    chiefToken = (await chief.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  /** Danh mục THẬT (mặt hàng, kho, đối tác) + dữ liệu MẪU (cờ is_sample, có tồn đầu mẫu). */
  async function seed() {
    const item = await createItem(tenant.tenantId, "SP001", { price: 100_000, cost: 50_000 });
    await createWarehouse(tenant.tenantId, "K1");
    await createPartner(tenant.tenantId, "KH001", { creditLimit: 100_000_000 });
    await createPartner(tenant.tenantId, "NCC001", { kind: "supplier" });
    const [sItem] = await sql`insert into items (tenant_id, code, name, kind, is_sample) values (${tenant.tenantId}, 'MAU-SP', 'Hàng mẫu', 'goods', true) returning id`;
    await sql`insert into partners (tenant_id, code, name, kind, is_sample) values (${tenant.tenantId}, 'MAU-KH', 'Khách mẫu', 'customer', true)`;
    const [wh] = await sql`select id from warehouses where tenant_id = ${tenant.tenantId} and code = 'K1'`;
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${sItem.id}, ${wh.id}, 9, 1000)`;
    return item;
  }
  const isSampleCount = async () =>
    Number((await sql`select (select count(*) from items where tenant_id = ${tenant.tenantId} and is_sample) + (select count(*) from partners where tenant_id = ${tenant.tenantId} and is_sample) as n`)[0].n);

  it("AC-04 tồn 500tr, phải thu 120tr, tiền 80tr, phải trả 200tr: MỘT bút toán cân, chênh vào 411 = 500tr, dữ liệu mẫu đã xoá", async () => {
    await seed();
    expect(await isSampleCount()).toBe(2);
    const body = {
      date: "2026-09-01",
      stock: [{ itemCode: "SP001", warehouseCode: "K1", qty: 10_000, unitCost: 50_000 }], // 500.000.000
      receivables: [{ partnerCode: "KH001", amount: 120_000_000 }],
      payables: [{ partnerCode: "NCC001", amount: 200_000_000 }],
      cash: { c111: 30_000_000, c112: 50_000_000 },
    };
    const r = await post("/api/onboarding/opening-balance", chiefToken, body, idem());
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);

    // Đúng 1 bút toán đầu kỳ, Σ nợ = Σ có
    const entries = await sql`select id from journal_entries where tenant_id = ${tenant.tenantId}`;
    expect(entries).toHaveLength(1);
    const lines = await sql`select account_code c, debit d, credit k from journal_lines where entry_id = ${entries[0].id} order by account_code`;
    const sum = (f: "d" | "k") => lines.reduce((a, l) => a + Number(l[f]), 0);
    expect(sum("d")).toBe(sum("k"));
    expect(lines.map((l) => [l.c, Number(l.d), Number(l.k)])).toEqual([
      ["111", 30_000_000, 0],
      ["112", 50_000_000, 0],
      ["131", 120_000_000, 0],
      ["156", 500_000_000, 0],
      ["331", 0, 200_000_000],
      ["411", 0, 500_000_000],
    ]);
    // Dữ liệu mẫu (kể cả tồn đầu mẫu) đã xoá; tồn thật đã nạp gắn phiếu ADJ số dư đầu
    expect(await isSampleCount()).toBe(0);
    expect((await sql`select 1 from items where tenant_id = ${tenant.tenantId} and code = 'MAU-SP'`).length).toBe(0);
    const [{ q }] = await sql`select coalesce(sum(qty),0) q from stock_moves where tenant_id = ${tenant.tenantId}`;
    expect(Number(q)).toBe(10_000);
    const [adj] = await sql`select doc_type, status, meta from documents where id = ${r.json.data.docId}`;
    expect([adj.doc_type, adj.status, adj.meta.opening]).toEqual(["ADJ", "done", true]);
    // Khoản phải thu / phải trả vào sổ phụ
    expect(Number((await sql`select amount from receivables where tenant_id = ${tenant.tenantId}`)[0].amount)).toBe(120_000_000);
    expect(Number((await sql`select amount from payables where tenant_id = ${tenant.tenantId}`)[0].amount)).toBe(200_000_000);
  });

  it("chỉ nạp MỘT lần / chỉ khi chưa có chứng từ (conflict); idempotency gửi lại trả kết quả cũ", async () => {
    await seed();
    const key = randomUUID();
    const body = { cash: { c111: 1_000_000, c112: 0 } };
    const a = await post("/api/onboarding/opening-balance", adminToken, body, { "idempotency-key": key });
    expect(a.json.ok, JSON.stringify(a.json)).toBe(true);
    const replay = await post("/api/onboarding/opening-balance", adminToken, body, { "idempotency-key": key });
    expect(replay.json.data.docId).toBe(a.json.data.docId);
    const again = await post("/api/onboarding/opening-balance", adminToken, { cash: { c111: 5, c112: 0 } }, idem());
    expect(again.json.error.code).toBe("conflict");
    const rs = await post("/api/onboarding/remove-sample", adminToken, {});
    expect(rs.json.error.code).toBe("conflict");
    expect((await sql`select 1 from journal_entries where tenant_id = ${tenant.tenantId}`).length).toBe(1);
  });

  it("mã không có trong danh mục / hàng theo lô / tệp rỗng -> invalid_argument, không ghi gì và không xoá mẫu", async () => {
    await seed();
    await createItem(tenant.tenantId, "LOT", { tracking: "lot" });
    const bad = await post(
      "/api/onboarding/opening-balance",
      chiefToken,
      { stock: [{ itemCode: "KHONGCO", warehouseCode: "K9", qty: 1, unitCost: 1 }, { itemCode: "LOT", warehouseCode: "K1", qty: 1, unitCost: 1 }], receivables: [{ partnerCode: "ZZ", amount: 5 }] },
      idem(),
    );
    expect(bad.json.error.code).toBe("invalid_argument");
    expect(bad.json.error.message).toContain("KHONGCO");
    expect(bad.json.error.message).toContain("K9");
    expect(bad.json.error.message).toContain("ZZ");
    expect((await sql`select 1 from journal_entries where tenant_id = ${tenant.tenantId}`).length).toBe(0);
    expect(await isSampleCount()).toBe(2); // giao dịch lỗi được rollback → mẫu còn nguyên
    const empty = await post("/api/onboarding/opening-balance", chiefToken, {}, idem());
    expect(empty.json.error.code).toBe("invalid_argument");
  });

  it("tài sản < nợ: chênh lệch ghi Nợ 411; remove-sample xoá cả tồn đầu mẫu khi chưa có chứng từ; kế toán thường bị chặn", async () => {
    await seed();
    const denied = await post("/api/onboarding/opening-balance", accToken, { cash: { c111: 1, c112: 0 } }, idem());
    expect(denied.status).toBe(403);
    const deniedRs = await post("/api/onboarding/remove-sample", accToken, {});
    expect(deniedRs.status).toBe(403);

    const rs = await post("/api/onboarding/remove-sample", chiefToken, {});
    expect(rs.json.ok, JSON.stringify(rs.json)).toBe(true);
    expect(rs.json.data).toEqual({ removedPartners: 1, removedItems: 1 });
    expect(await isSampleCount()).toBe(0);
    expect(Number((await sql`select coalesce(sum(qty),0) q from stock_moves where tenant_id = ${tenant.tenantId}`)[0].q)).toBe(0);

    const r = await post("/api/onboarding/opening-balance", chiefToken, { payables: [{ partnerCode: "NCC001", amount: 1_000_000 }], cash: { c111: 400_000, c112: 0 } }, idem());
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const lines = await sql`select l.account_code c, l.debit d, l.credit k from journal_lines l join journal_entries e on e.id = l.entry_id where e.tenant_id = ${tenant.tenantId} order by l.account_code`;
    expect(lines.map((l) => [l.c, Number(l.d), Number(l.k)])).toEqual([
      ["111", 400_000, 0],
      ["331", 0, 1_000_000],
      ["411", 600_000, 0], // tài sản 400k < nợ 1tr → chênh Nợ 411
    ]);
  });
});
