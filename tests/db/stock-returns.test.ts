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

describe("điều chuyển, kiểm kê, trả hàng, huỷ (lô 3.5) — AC-25..28", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let whToken: string;
  let accToken: string;
  let buyerToken: string;
  let leadToken: string;
  let customerId: string;
  let supplierId: string;
  let k1: string;
  let k2: string;
  let qc: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const [sales, wh, acc, buyer, lead] = await Promise.all(
      (["sales", "warehouse", "accountant", "purchasing", "dept_lead"] as const).map((r) => addTenantMember(tenant.tenantId, r)),
    );
    members.push(sales, wh, acc, buyer, lead);
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    buyerToken = (await buyer.signIn()).accessToken;
    leadToken = (await lead.signIn()).accessToken;
    customerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    supplierId = await createPartner(tenant.tenantId, "NCC1", { kind: "supplier" });
    k1 = await createWarehouse(tenant.tenantId, "K1");
    k2 = await createWarehouse(tenant.tenantId, "K2");
    qc = await createWarehouse(tenant.tenantId, "QC");
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  const seedStock = (item: string, wh: string, qty: number, cost: number) =>
    sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${item}, ${wh}, ${qty}, ${cost})`;
  const onHandAt = async (item: string, wh: string) =>
    Number((await sql`select coalesce(sum(qty),0) v from stock_moves where tenant_id = ${tenant.tenantId} and item_id = ${item} and warehouse_id = ${wh}`)[0].v);
  const onHandMain = async (item: string) =>
    Number((await sql`select coalesce(sum(m.qty),0) v from stock_moves m join warehouses w on w.id = m.warehouse_id where m.tenant_id = ${tenant.tenantId} and m.item_id = ${item} and w.code <> 'QC'`)[0].v);
  const availableOf = async (item: string) =>
    Number((await sql`select available from v_available where tenant_id = ${tenant.tenantId} and item_id = ${item}`)[0]?.available ?? 0);
  const reservedOf = async (docId: string) =>
    Number((await sql`select coalesce(sum(qty),0) v from reservations where document_id = ${docId}`)[0].v);
  const entryLines = async (docId: string) =>
    (await sql`select l.account_code c, l.debit d, l.credit k from journal_lines l join journal_entries e on e.id = l.entry_id where e.document_id = ${docId} order by l.account_code`).map(
      (x) => [x.c as string, Number(x.d), Number(x.k)],
    );
  const advanceOf = async () => Number((await sql`select amount from partner_advances where tenant_id = ${tenant.tenantId} and partner_id = ${customerId}`)[0]?.amount ?? 0);

  async function orderFor(item: string, qty: number, price: number, terms: "cash" | "credit" = "cash", depositPct = 0) {
    const q = await post("/api/quotes", salesToken, { partnerId: customerId, lines: [{ itemId: item, qty, price }] }, idem());
    expect(q.json.ok, JSON.stringify(q.json)).toBe(true);
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms, depositPct }, idem());
    const c = await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    expect(c.json.data.status, JSON.stringify(c.json)).toBe("confirmed");
    return o.json.data.id as string;
  }

  describe("AC-25 điều chuyển", () => {
    it("chuyển 4 từ K1 sang K2: K1 6, K2 4, tổng 10 không đổi; thiếu tồn / cùng kho / hàng theo lô bị chặn; chỉ vai kho", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 100, cost: 50 });
      await seedStock(x, k1, 10, 50);
      const r = await post("/api/stock/transfer", whToken, { itemId: x, fromWh: k1, toWh: k2, qty: 4 }, idem());
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect(await onHandAt(x, k1)).toBe(6);
      expect(await onHandAt(x, k2)).toBe(4);
      expect(await onHandMain(x)).toBe(10);

      const over = await post("/api/stock/transfer", whToken, { itemId: x, fromWh: k1, toWh: k2, qty: 7 }, idem());
      expect(over.json.error.code).toBe("state_invalid");
      const same = await post("/api/stock/transfer", whToken, { itemId: x, fromWh: k1, toWh: k1, qty: 1 }, idem());
      expect(same.json.error.code).toBe("invalid_argument");
      const lot = await createItem(tenant.tenantId, "LOT", { tracking: "lot" });
      const tracked = await post("/api/stock/transfer", whToken, { itemId: lot, fromWh: k1, toWh: k2, qty: 1 }, idem());
      expect(tracked.json.error.code).toBe("invalid_argument");
      const denied = await post("/api/stock/transfer", salesToken, { itemId: x, fromWh: k1, toWh: k2, qty: 1 }, idem());
      expect(denied.status).toBe(403);
      expect(await onHandMain(x)).toBe(10);
    });
  });

  describe("AC-26 kiểm kê lệch cần duyệt", () => {
    it("sổ 100, đếm 97: phiếu chờ duyệt (tồn chưa đổi) -> kế toán duyệt -> tồn 97, bút toán 642/156 = 3 × giá vốn", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 100, cost: 50 });
      await seedStock(x, k1, 100, 50);
      const r = await post("/api/stock/adjust", whToken, { itemId: x, delta: -3, reason: "Đếm thiếu" }, idem());
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect(r.json.data.status).toBe("pending");
      expect(r.json.data.meta.chain).toEqual(["accountant"]);
      const id = r.json.data.id as string;
      expect(await onHandMain(x)).toBe(100); // trước duyệt tồn chưa đổi
      const [task] = await sql`select role from tasks where document_id = ${id} and not done`;
      expect(task.role).toBe("accountant");

      const bad = await post("/api/approvals/decide", whToken, { docId: id, decision: "approve" });
      expect(bad.json.error.code).toBe("forbidden"); // người lập (kho) không tự duyệt

      const ok = await post("/api/approvals/decide", accToken, { docId: id, decision: "approve" });
      expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
      expect(ok.json.data.status).toBe("done");
      expect(ok.json.data.meta.approvals[0].role).toBe("accountant");
      expect(await onHandMain(x)).toBe(97);
      expect(await entryLines(id)).toEqual([["156", 0, 150], ["642", 150, 0]]);
      expect(ok.json.data.meta.amount).toBe(150);
    });

    it("kiểm kê thừa: cộng tồn, Nợ 156 / Có 642; làm tồn âm bị chặn; thiếu lý do bị chặn", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 100, cost: 50 });
      await seedStock(x, k1, 5, 50);
      const neg = await post("/api/stock/adjust", whToken, { itemId: x, delta: -6, reason: "Sai" }, idem());
      expect(neg.json.error.code).toBe("invalid_argument");
      const noReason = await post("/api/stock/adjust", whToken, { itemId: x, delta: 1, reason: "" }, idem());
      expect(noReason.json.error.code).toBe("invalid_argument");
      const r = await post("/api/stock/adjust", whToken, { itemId: x, delta: 2, reason: "Đếm thừa" }, idem());
      const ok = await post("/api/approvals/decide", accToken, { docId: r.json.data.id, decision: "approve" });
      expect(ok.json.data.status).toBe("done");
      expect(await onHandMain(x)).toBe(7);
      expect(await entryLines(r.json.data.id)).toEqual([["156", 100, 0], ["642", 0, 100]]);
    });
  });

  describe("AC-27 trả hàng bán", () => {
    /** Đơn 10 X giá 1.000.000 (giá vốn 600.000), giao đủ, phát hành hoá đơn; `paid` = thu đủ ngay. */
    async function issuedInvoice(paid: boolean) {
      const x = await createItem(tenant.tenantId, `X${randomUUID().slice(0, 6)}`, { price: 1_000_000, cost: 600_000 });
      await seedStock(x, k1, 12, 600_000);
      const o = await orderFor(x, 10, 1_000_000, paid ? "cash" : "credit");
      const d = await post("/api/orders/deliver", whToken, { orderId: o, lines: [{ lineNo: 1, qty: 10 }] }, idem());
      expect(d.json.ok, JSON.stringify(d.json)).toBe(true);
      const invId = d.json.data.invId as string;
      const i = await post("/api/invoices/issue", accToken, { invoiceId: invId }, idem());
      expect(i.json.ok, JSON.stringify(i.json)).toBe(true);
      if (paid) {
        const r = await post("/api/receipts", accToken, { partnerId: customerId, amount: 11_000_000, method: "bank" }, idem());
        expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      }
      return { x, invId };
    }

    it("hoá đơn 10 X đã thu đủ, khách trả 2 X tốt: nhập lại 2 X, hoá đơn điều chỉnh −2, doanh thu −2tr, 2,2tr thành ứng trước, bút toán đảo giá vốn", async () => {
      const { x, invId } = await issuedInvoice(true);
      const before = await onHandMain(x); // 12 − 10 = 2
      expect(before).toBe(2);

      const r = await post("/api/sales/return", salesToken, { invoiceId: invId, condition: "good", lines: [{ lineNo: 1, qty: 2 }] }, idem());
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      const cn = r.json.data;
      expect(cn.status).toBe("done");
      expect(cn.meta.kind).toBe("credit_note");
      expect(cn.refs).toHaveLength(1);
      const [line] = await sql`select qty from document_lines where document_id = ${cn.id}`;
      expect(Number(line.qty)).toBe(-2);
      expect(await onHandMain(x)).toBe(before + 2);
      expect(await entryLines(cn.id)).toEqual([
        ["131", 0, 2_200_000],
        ["156", 1_200_000, 0],
        ["3331", 200_000, 0],
        ["511", 2_000_000, 0], // revenue_delta = −2 × giá chưa thuế
        ["632", 0, 1_200_000],
      ]);
      expect(await advanceOf()).toBe(2_200_000); // đã thu đủ → toàn bộ giá trị trả thành ứng trước
      const [ln] = await sql`select meta from document_lines where document_id = ${invId}`;
      expect(ln.meta.returned).toBe(2);
      expect((await sql`select 1 from tasks where tenant_id = ${tenant.tenantId} and document_id = ${cn.id}`).length).toBe(0);
    });

    it("trả vượt số đã bán bị chặn (cộng dồn các lần trả); hoá đơn nháp/hoá đơn điều chỉnh không trả được; kho không có quyền", async () => {
      const { invId } = await issuedInvoice(true);
      expect((await post("/api/sales/return", salesToken, { invoiceId: invId, condition: "good", lines: [{ lineNo: 1, qty: 8 }] }, idem())).json.ok).toBe(true);
      const over = await post("/api/sales/return", salesToken, { invoiceId: invId, condition: "good", lines: [{ lineNo: 1, qty: 3 }] }, idem());
      expect(over.json.error.code).toBe("invalid_argument");
      const cnId = (await sql`select id from documents where tenant_id = ${tenant.tenantId} and doc_type = 'INV' and meta->>'kind' = 'credit_note'`)[0].id;
      const onCn = await post("/api/sales/return", salesToken, { invoiceId: cnId, condition: "good", lines: [{ lineNo: 1, qty: 1 }] }, idem());
      expect(onCn.json.error.code).toBe("state_invalid");
      const denied = await post("/api/sales/return", whToken, { invoiceId: invId, condition: "good", lines: [{ lineNo: 1, qty: 1 }] }, idem());
      expect(denied.status).toBe(403);
    });

    it("hoá đơn CHƯA thu: trả 1 X giảm khoản phải thu còn mở (không thành ứng trước); hàng lỗi vào kho chờ kiểm, không tính khả dụng", async () => {
      const { x, invId } = await issuedInvoice(false);
      const [rec0] = await sql`select amount, paid from receivables where document_id = ${invId} and kind = 'invoice'`;
      expect(Number(rec0.amount)).toBe(11_000_000);
      const r = await post("/api/sales/return", salesToken, { invoiceId: invId, condition: "defect", lines: [{ lineNo: 1, qty: 1 }] }, idem());
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      const [rec1] = await sql`select amount, paid from receivables where document_id = ${invId} and kind = 'invoice'`;
      expect(Number(rec1.amount)).toBe(9_900_000);
      expect(await advanceOf()).toBe(0);
      expect(await onHandAt(x, qc)).toBe(1);
      expect(await onHandMain(x)).toBe(2); // hàng lỗi chưa tính vào tồn dùng được
    });
  });

  describe("AC-28 huỷ đơn", () => {
    it("đơn đang giữ 3 X: huỷ -> giữ về 0, khả dụng +3, không phiếu trả; huỷ lần 2 / đơn đã giao bị chặn", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 100_000, cost: 50_000 });
      await seedStock(x, k1, 3, 50_000);
      const o = await orderFor(x, 3, 100_000);
      expect(await reservedOf(o)).toBe(3);
      const before = await availableOf(x);
      expect(before).toBe(0);

      const r = await post("/api/docs/cancel", salesToken, { docId: o });
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect(r.json.data.status).toBe("cancelled");
      expect(await reservedOf(o)).toBe(0);
      expect(await availableOf(x)).toBe(before + 3);
      expect((await sql`select 1 from documents where tenant_id = ${tenant.tenantId} and doc_type in ('DO', 'INV', 'GRN') and meta->>'soId' = ${o}`).length).toBe(0); // không phiếu xuất/trả nào

      const again = await post("/api/docs/cancel", salesToken, { docId: o });
      expect(again.json.error.code).toBe("state_invalid");

      const o2 = await orderFor(x, 1, 100_000);
      const d = await post("/api/orders/deliver", whToken, { orderId: o2, lines: [{ lineNo: 1, qty: 1 }] }, idem());
      expect(d.json.ok, JSON.stringify(d.json)).toBe(true);
      const after = await post("/api/docs/cancel", salesToken, { docId: o2 });
      expect(after.json.error.code).toBe("state_invalid");
    });

    it("đơn thiếu hàng (có yêu cầu mua tự sinh) + đã thu cọc: huỷ -> huỷ luôn yêu cầu mua, đóng việc, cọc thành ứng trước", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 1_000_000, cost: 500_000 });
      await seedStock(x, k1, 1, 500_000);
      const o = await orderFor(x, 2, 1_000_000, "cash", 50); // tổng 2,2tr, cọc 1,1tr; thiếu 1 → sinh YM
      const [pr] = await sql`select id, status from documents where tenant_id = ${tenant.tenantId} and doc_type = 'PR' and meta->>'forSO' = ${o}`;
      expect(pr.status).not.toBe("cancelled");
      const dep = await post("/api/receipts", accToken, { partnerId: customerId, amount: 1_100_000, method: "bank" }, idem());
      expect(dep.json.ok, JSON.stringify(dep.json)).toBe(true);

      const r = await post("/api/docs/cancel", salesToken, { docId: o });
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect((await sql`select status from documents where id = ${pr.id}`)[0].status).toBe("cancelled");
      expect((await sql`select 1 from tasks where tenant_id = ${tenant.tenantId} and document_id in (${pr.id}, ${o}) and not done`).length).toBe(0);
      expect(await reservedOf(o)).toBe(0);
      expect(await advanceOf()).toBe(1_100_000);
      const [dp] = await sql`select amount, paid from receivables where document_id = ${o} and kind = 'deposit'`;
      expect(Number(dp.amount)).toBe(Number(dp.paid)); // không còn nợ cọc
    });

    it("đơn mua chưa nhận huỷ được; đã nhận thì chỉ trả hàng mua; đơn đã hoàn tất không huỷ; vai kế toán không có quyền huỷ", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
      const mkPo = async () => {
        const po = await post("/api/purchase/orders", buyerToken, { supplierId, lines: [{ itemId: x, qty: 10, price: 10_000 }] }, idem());
        return po.json.data.id as string;
      };
      const po1 = await mkPo();
      const c1 = await post("/api/docs/cancel", buyerToken, { docId: po1 });
      expect(c1.json.data.status).toBe("cancelled");

      const po2 = await mkPo();
      await post("/api/purchase/orders/confirm", buyerToken, { poId: po2 });
      await post("/api/approvals/decide", leadToken, { docId: po2, decision: "approve" });
      const rcv = await post("/api/purchase/receive", whToken, { poId: po2, lines: [{ lineNo: 1, qty: 10 }] }, idem());
      expect(rcv.json.ok, JSON.stringify(rcv.json)).toBe(true);
      const c2 = await post("/api/docs/cancel", buyerToken, { docId: po2 });
      expect(c2.json.error.code).toBe("state_invalid");
      const c3 = await post("/api/docs/cancel", accToken, { docId: po2 });
      expect(c3.status).toBe(403);
    });
  });

  describe("trả hàng mua", () => {
    it("nhận 10, hoá đơn 110.000: trả 4 -> kho 6, Nợ 331 / Có 156 = 40.000, phải trả còn 70.000; trả vượt số nhận bị chặn", async () => {
      const x = await createItem(tenant.tenantId, "X", { price: 12_000, cost: 10_000 });
      const po = await post("/api/purchase/orders", buyerToken, { supplierId, lines: [{ itemId: x, qty: 10, price: 10_000 }] }, idem());
      const poId = po.json.data.id as string;
      await post("/api/purchase/orders/confirm", buyerToken, { poId });
      await post("/api/approvals/decide", leadToken, { docId: poId, decision: "approve" });
      await post("/api/purchase/receive", whToken, { poId, lines: [{ lineNo: 1, qty: 10 }] }, idem());
      const inv = await post("/api/purchase/vendor-invoice", accToken, { poId, invoiceNo: "HD-R", lines: [{ lineNo: 1, qty: 10, price: 10_000 }] }, idem());
      expect(inv.json.ok, JSON.stringify(inv.json)).toBe(true);

      const r = await post("/api/purchase/return", buyerToken, { poId, lines: [{ lineNo: 1, qty: 4 }] }, idem());
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect(r.json.data.meta.kind).toBe("debit_note");
      expect(await onHandMain(x)).toBe(6);
      expect(await entryLines(r.json.data.id)).toEqual([["156", 0, 40_000], ["331", 40_000, 0]]);
      const [p] = await sql`select amount from payables where tenant_id = ${tenant.tenantId}`;
      expect(Number(p.amount)).toBe(70_000);

      const over = await post("/api/purchase/return", buyerToken, { poId, lines: [{ lineNo: 1, qty: 7 }] }, idem());
      expect(over.json.error.code).toBe("invalid_argument");
      const denied = await post("/api/purchase/return", salesToken, { poId, lines: [{ lineNo: 1, qty: 1 }] }, idem());
      expect(denied.status).toBe(403);
    });
  });
});
