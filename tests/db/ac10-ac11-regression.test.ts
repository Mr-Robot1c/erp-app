import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTenantMember,
  apiUrl,
  createItem,
  createPartner,
  createTestTenant,
  createWarehouse,
  sql,
  type TenantMember,
  type TestTenant,
} from "./helper";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const idem = () => ({ "idempotency-key": randomUUID() });

/**
 * Test hồi quy CỨNG cho bug UAT 22/9 (Fable): "AC-10 vỡ — xác nhận SO với kho thiếu KHÔNG tự sinh PR (YM)".
 * Chẩn đoán ghi trong tien-do-web-erp.md mục "Kế hoạch fix UX-2": SO confirmed nhưng refs chỉ có báo giá gốc,
 * KHÔNG có YM — hệ quả dây theo là AC-11 cũng vỡ (không refulfil được vì không có PR/PO/GRN nào gắn forSO).
 * Test này dựng ĐÚNG kịch bản 19 bước hồi 1 (SO 3 dòng, kho lần lượt 0 / thiếu một phần / đủ) qua API thật
 * (không gọi thẳng hàm core) để bắt được bug ở đúng lớp route → server → fulfil như Fable đã tái hiện.
 */
describe("Hồi quy UX-2: AC-10 tự sinh PR khi xác nhận SO thiếu hàng + AC-11 tự giữ sau nhận hàng (2 nhánh PO)", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let whToken: string;
  let buyerToken: string;
  let leadToken: string;
  let partnerId: string;
  let supplierId: string;
  let whId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const [sales, wh, buyer, lead] = await Promise.all(
      (["sales", "warehouse", "purchasing", "dept_lead"] as const).map((r) => addTenantMember(tenant.tenantId, r)),
    );
    members.push(sales, wh, buyer, lead);
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    buyerToken = (await buyer.signIn()).accessToken;
    leadToken = (await lead.signIn()).accessToken;
    partnerId = await createPartner(tenant.tenantId, "KH-UAT");
    supplierId = await createPartner(tenant.tenantId, "NCC-UAT", { kind: "supplier" });
    whId = await createWarehouse(tenant.tenantId, "K1");
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  const stock = (itemId: string, qty: number) =>
    sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemId}, ${whId}, ${qty}, 100000)`;
  const reservedFor = async (orderId: string, itemId: string) =>
    Number((await sql`select coalesce(sum(qty),0) v from reservations where document_id = ${orderId} and item_id = ${itemId}`)[0].v);
  const prsFor = async (orderId: string) =>
    sql<{ id: string; doc_no: string; qty: string; item_id: string; refs: unknown }[]>`
      select d.id, d.doc_no, d.refs, l.qty, l.item_id from documents d join document_lines l on l.document_id = d.id
      where d.tenant_id = ${tenant.tenantId} and d.doc_type = 'PR' and d.meta->>'forSO' = ${orderId} order by l.line_no`;
  const soRow = async (orderId: string) => (await sql`select refs, status from documents where id = ${orderId}`)[0];

  it("AC-10 CỨNG: SO 3 dòng (kho 0 / thiếu một phần / đủ) → xác nhận qua API thật → PR tự sinh ĐÚNG số thiếu của 2 dòng, refs 2 chiều SO↔PR, dòng đủ không sinh PR", async () => {
    const itemZero = await createItem(tenant.tenantId, "UAT-ZERO", { price: 500_000, cost: 300_000 }); // kho = 0 → thiếu toàn bộ 5
    const itemPartial = await createItem(tenant.tenantId, "UAT-PARTIAL", { price: 200_000, cost: 120_000 }); // kho 3, cần 5 → thiếu 2
    const itemFull = await createItem(tenant.tenantId, "UAT-FULL", { price: 100_000, cost: 60_000 }); // kho 10, cần 4 → đủ
    await stock(itemPartial, 3);
    await stock(itemFull, 10);

    const q = await post(
      "/api/quotes",
      salesToken,
      {
        partnerId,
        lines: [
          { itemId: itemZero, qty: 5, price: 500_000 },
          { itemId: itemPartial, qty: 5, price: 200_000 },
          { itemId: itemFull, qty: 4, price: 100_000 },
        ],
      },
      idem(),
    );
    expect(q.json.ok, JSON.stringify(q.json)).toBe(true);
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    expect(o.json.ok, JSON.stringify(o.json)).toBe(true);
    const orderId = o.json.data.id as string;

    // Đúng bước 5 của kịch bản 19 bước: xác nhận đơn bán qua API thật (route → confirmOrder → afterConfirm → orderAfterConfirm → fulfil).
    const c = await post("/api/orders/confirm", salesToken, { orderId });
    expect(c.json.ok, JSON.stringify(c.json)).toBe(true);
    expect(c.json.data.status).toBe("confirmed");

    // Bug đã báo: refs sau xác nhận CHỈ có báo giá gốc, KHÔNG có YM. Khẳng định refs PHẢI có ít nhất 1 yêu cầu mua.
    const so = await soRow(orderId);
    const soRefs = so.refs as string[];
    expect(soRefs, `SO.refs sau xác nhận: ${JSON.stringify(soRefs)} — phải có YM (PR), không chỉ báo giá gốc`).toContain(q.json.data.doc_no);
    const prs = await prsFor(orderId);
    expect(prs.length, "phải có đúng 1 yêu cầu mua gom cả 2 dòng thiếu hàng").toBeGreaterThan(0);
    expect(soRefs.some((r) => prs.some((pr) => pr.doc_no === r)), "SO.refs phải chứa số YM vừa sinh").toBe(true);

    // Đúng SỐ THIẾU từng dòng: UAT-ZERO thiếu 5, UAT-PARTIAL thiếu 2, UAT-FULL không có dòng nào (đủ hàng).
    const byItem = new Map(prs.flatMap((pr) => pr).map((pr) => [pr.item_id, Number(pr.qty)]));
    expect(byItem.get(itemZero)).toBe(5);
    expect(byItem.get(itemPartial)).toBe(2);
    expect(byItem.has(itemFull)).toBe(false);

    // refs 2 CHIỀU: mỗi PR phải tham chiếu ngược lại đúng số của SO.
    const [soDocNo] = await sql`select doc_no from documents where id = ${orderId}`;
    for (const pr of prs) {
      const [full] = await sql`select refs from documents where id = ${pr.id}`;
      expect(full.refs as string[]).toContain(soDocNo.doc_no as string);
    }

    // Đã giữ được phần có sẵn của dòng thiếu một phần (kho 3, giữ 3) — không chờ nhận hàng mới giữ được phần đang có.
    expect(await reservedFor(orderId, itemPartial)).toBe(3);
    // Dòng đủ hàng: giữ đủ 4, không sinh PR.
    expect(await reservedFor(orderId, itemFull)).toBe(4);
    expect(await reservedFor(orderId, itemZero)).toBe(0);
  });

  it("AC-11 nhánh (a) — PR tự sinh dưới ngưỡng duyệt PO: PO xác nhận thẳng (1 cấp) → nhận hàng → tự refulfil, khả dụng không tăng", async () => {
    const item = await createItem(tenant.tenantId, "UAT-A", { price: 500_000, cost: 300_000 });
    const q = await post("/api/quotes", salesToken, { partnerId, lines: [{ itemId: item, qty: 5, price: 500_000 }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    const orderId = o.json.data.id as string;
    const c = await post("/api/orders/confirm", salesToken, { orderId });
    expect(c.json.ok, JSON.stringify(c.json)).toBe(true);

    const prs = await prsFor(orderId);
    expect(prs).toHaveLength(1);
    const prId = prs[0].id;

    const po = await post("/api/purchase/orders", buyerToken, { supplierId, fromPrId: prId }, idem());
    expect(po.json.ok, JSON.stringify(po.json)).toBe(true);
    const poId = po.json.data.id as string;
    const confirmPo = await post("/api/purchase/orders/confirm", buyerToken, { poId });
    expect(confirmPo.json.ok, JSON.stringify(confirmPo.json)).toBe(true);
    expect(confirmPo.json.data.status).toBe("pending");
    expect(confirmPo.json.data.meta.chain).toEqual(["dept_lead"]); // dưới poThreshold mặc định (20tr) → 1 cấp
    const decide = await post("/api/approvals/decide", leadToken, { docId: poId, decision: "approve" });
    expect(decide.json.data.status).toBe("confirmed");

    const [poMeta] = await sql`select meta from documents where id = ${poId}`;
    expect(poMeta.meta.forSO).toBe(orderId); // forSO đi theo đúng chuỗi YM → ĐM

    const before = Number((await sql`select available from v_available where tenant_id = ${tenant.tenantId} and item_id = ${item}`)[0]?.available ?? 0);
    const receive = await post("/api/purchase/receive", whToken, { poId, lines: [{ lineNo: 1, qty: 5 }] }, idem());
    expect(receive.json.ok, JSON.stringify(receive.json)).toBe(true);
    const after = Number((await sql`select available from v_available where tenant_id = ${tenant.tenantId} and item_id = ${item}`)[0]?.available ?? 0);

    expect(await reservedFor(orderId, item)).toBe(5); // AC-11: hàng về tự giữ cho SO gốc
    expect(after).toBe(before); // khả dụng KHÔNG tăng vì hàng vừa về bị giữ ngay
  });

  it("AC-11 nhánh (b) — PO vượt ngưỡng duyệt (chain 2 cấp trưởng bộ phận + kế toán trưởng): duyệt đủ chuỗi → nhận hàng → vẫn refulfil đúng SO gốc", async () => {
    const item = await createItem(tenant.tenantId, "UAT-B", { price: 25_000_000, cost: 22_000_000 }); // 5 × 25tr = 125tr > ngưỡng 20tr
    const chief = await addTenantMember(tenant.tenantId, "chief_accountant");
    members.push(chief);
    const chiefToken = (await chief.signIn()).accessToken;

    const q = await post("/api/quotes", salesToken, { partnerId, lines: [{ itemId: item, qty: 5, price: 25_000_000 }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    const orderId = o.json.data.id as string;
    const c = await post("/api/orders/confirm", salesToken, { orderId });
    expect(c.json.ok, JSON.stringify(c.json)).toBe(true);
    const prs = await prsFor(orderId);
    expect(prs).toHaveLength(1);

    const po = await post("/api/purchase/orders", buyerToken, { supplierId, fromPrId: prs[0].id }, idem());
    const poId = po.json.data.id as string;
    const confirmPo = await post("/api/purchase/orders/confirm", buyerToken, { poId });
    expect(confirmPo.json.data.meta.chain).toEqual(["dept_lead", "chief_accountant"]); // > ngưỡng → 2 cấp

    await post("/api/approvals/decide", leadToken, { docId: poId, decision: "approve" });
    const decide2 = await post("/api/approvals/decide", chiefToken, { docId: poId, decision: "approve" });
    expect(decide2.json.data.status).toBe("confirmed");
    const [poMeta] = await sql`select meta from documents where id = ${poId}`;
    expect(poMeta.meta.forSO).toBe(orderId); // chain dài hơn không làm mất tham chiếu ngược forSO

    const receive = await post("/api/purchase/receive", whToken, { poId, lines: [{ lineNo: 1, qty: 5 }] }, idem());
    expect(receive.json.ok, JSON.stringify(receive.json)).toBe(true);
    expect(await reservedFor(orderId, item)).toBe(5); // AC-11 vẫn đúng dù PO đi qua chain duyệt 2 cấp
    const [soAfter] = await sql`select status from documents where id = ${orderId}`;
    expect(soAfter.status).toBe("confirmed"); // đã giữ đủ, chưa xuất kho nên chưa done/partial
  });
});
