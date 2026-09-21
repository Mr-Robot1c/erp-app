import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
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

describe("báo cáo điều hành + Excel (lô 4.4) — AC-34", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let salesToken: string;
  let whToken: string;
  let accToken: string;
  let customerId: string;
  let item: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const [sales, wh, acc] = await Promise.all((["sales", "warehouse", "accountant"] as const).map((r) => addTenantMember(tenant.tenantId, r)));
    members.push(sales, wh, acc);
    salesToken = (await sales.signIn()).accessToken;
    whToken = (await wh.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    customerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
    const k1 = await createWarehouse(tenant.tenantId, "K1");
    item = await createItem(tenant.tenantId, "X", { price: 10_000_000, cost: 5_000_000 });
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${item}, ${k1}, 20, 5000000)`;
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  async function order(price: number, itemId = item) {
    const q = await post("/api/quotes", salesToken, { partnerId: customerId, lines: [{ itemId, qty: 1, price }] }, idem());
    await post("/api/quotes/confirm", salesToken, { quoteId: q.json.data.id });
    const o = await post("/api/quotes/to-order", salesToken, { quoteId: q.json.data.id, terms: "cash", depositPct: 0 }, idem());
    const c = await post("/api/orders/confirm", salesToken, { orderId: o.json.data.id });
    expect(c.json.data.status, JSON.stringify(c.json)).toBe("confirmed");
    return o.json.data.id as string;
  }
  async function deliverAndIssue(orderId: string, deliverDate: string, issueDate: string) {
    const d = await post("/api/orders/deliver", whToken, { orderId, lines: [{ lineNo: 1, qty: 1 }], date: deliverDate }, idem());
    expect(d.json.ok, JSON.stringify(d.json)).toBe(true);
    const i = await post("/api/invoices/issue", accToken, { invoiceId: d.json.data.invId, date: issueDate }, idem());
    expect(i.json.ok, JSON.stringify(i.json)).toBe(true);
    return d.json.data.invId as string;
  }
  /** Doanh thu kỳ = Σ (Có − Nợ) TK 511 — đúng công thức dashboard/báo cáo. */
  async function revenue(ym: string) {
    const { client } = await tenant.signIn();
    const { data } = await client.from("v_account_balance").select("credit, debit").eq("ym", ym).eq("account_code", "511");
    return (data ?? []).reduce((a, r) => a + Number(r.credit) - Number(r.debit), 0);
  }

  it("AC-34 hoá đơn giao & phát hành 30/9 tổng 11tr thuế 10% chưa thu: doanh thu T9 = 10tr (chưa thuế), T10 không tính; đơn huỷ không tính", async () => {
    const o1 = await order(10_000_000);
    await deliverAndIssue(o1, "2026-09-30", "2026-09-30");
    // Đơn 9,9tr (chưa thuế 9tr) xác nhận rồi huỷ — không có bút toán doanh thu
    const itemY = await createItem(tenant.tenantId, "Y", { price: 9_000_000, cost: 4_000_000 }); // giá bảng 9tr → không cần duyệt giá
    const [wh] = await sql`select id from warehouses where tenant_id = ${tenant.tenantId} limit 1`;
    await sql`insert into stock_moves (tenant_id, item_id, warehouse_id, qty, unit_cost) values (${tenant.tenantId}, ${itemY}, ${wh.id}, 5, 4000000)`;
    const cancelled = await order(9_000_000, itemY);
    const c = await post("/api/docs/cancel", salesToken, { docId: cancelled });
    expect(c.json.ok, JSON.stringify(c.json)).toBe(true);

    expect(await revenue("2026-09")).toBe(10_000_000);
    expect(await revenue("2026-10")).toBe(0);
    // Không bút toán doanh thu nào gắn đơn huỷ
    const [{ n }] = await sql`select count(*) n from v_journal where tenant_id = ${tenant.tenantId} and account_code = '511' and doc_no is not null and document_id in (select id from documents where meta->>'soId' = ${cancelled})`;
    expect(Number(n)).toBe(0);
    // Thuế 1tr nằm ở 3331, không lẫn vào doanh thu
    const { client } = await tenant.signIn();
    const { data: tax } = await client.from("v_account_balance").select("credit").eq("ym", "2026-09").eq("account_code", "3331");
    expect(Number(tax![0].credit)).toBe(1_000_000);
  });

  it("ca khác kỳ: giao 30/9, bấm phát hành 01/10 -> doanh thu T9 = 10tr, T10 = 0 (theo ngày GIAO)", async () => {
    const o = await order(10_000_000);
    await deliverAndIssue(o, "2026-09-30", "2026-10-01");
    expect(await revenue("2026-09")).toBe(10_000_000);
    expect(await revenue("2026-10")).toBe(0);
    const [e] = await sql`select to_char(e.entry_date, 'YYYY-MM-DD') d from journal_lines l join journal_entries e on e.id = l.entry_id where l.tenant_id = ${tenant.tenantId} and l.account_code = '511'`;
    expect(e.d).toBe("2026-09-30");
  });

  describe("xuất Excel", () => {
    async function exportXlsx(token: string, body: unknown) {
      const res = await fetch(apiUrl("/api/reports/export"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      return res;
    }
    const load = async (res: Response) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
      return wb;
    };

    it("sổ cái / số dư tài khoản / công nợ phải thu ra tệp .xlsx khớp số trên sổ; sổ cân", async () => {
      const o = await order(10_000_000);
      const invId = await deliverAndIssue(o, "2026-09-30", "2026-09-30");
      const [{ doc_no: invNo }] = await sql`select doc_no from documents where id = ${invId}`;

      const gl = await exportXlsx(accToken, { report: "gl", period: "2026-09" });
      expect(gl.headers.get("content-type")).toContain("spreadsheetml");
      expect(gl.headers.get("content-disposition")).toContain("bao-cao-gl-2026-09.xlsx");
      const ws = (await load(gl)).worksheets[0];
      const rows: { doc: string; acc: string; debit: number; credit: number }[] = [];
      ws.eachRow((row, i) => {
        if (i === 1) return;
        rows.push({ doc: String(row.getCell(2).value ?? ""), acc: String(row.getCell(4).value ?? ""), debit: Number(row.getCell(5).value ?? 0), credit: Number(row.getCell(6).value ?? 0) });
      });
      const data = rows.filter((r) => r.acc);
      expect(data.some((r) => r.doc === invNo && r.acc === "511" && r.credit === 10_000_000)).toBe(true);
      expect(data.reduce((a, r) => a + r.debit, 0)).toBe(data.reduce((a, r) => a + r.credit, 0));
      const total = rows[rows.length - 1];
      expect(total.debit).toBe(total.credit);

      const bal = await exportXlsx(accToken, { report: "balance", period: "2026-09" });
      const wsb = (await load(bal)).worksheets[0];
      let rev = -1;
      wsb.eachRow((row) => {
        if (String(row.getCell(1).value) === "511") rev = Number(row.getCell(5).value);
      });
      expect(rev).toBe(10_000_000);

      const ar = await exportXlsx(accToken, { report: "ar" });
      const wsa = (await load(ar)).worksheets[0];
      const last = wsa.lastRow!;
      expect(String(last.getCell(1).value)).toBe("Cộng");
      expect(Number(last.getCell(5).value)).toBe(11_000_000); // hoá đơn 10tr + thuế 1tr chưa thu
    });

    it("phân quyền + lỗi: kinh doanh bị chặn (403), chưa đăng nhập 401, loại báo cáo lạ / kỳ sai → invalid_argument (JSON)", async () => {
      expect((await exportXlsx(salesToken, { report: "gl", period: "2026-09" })).status).toBe(403);
      const anon = await fetch(apiUrl("/api/reports/export"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: "gl" }) });
      expect(anon.status).toBe(401);
      const bad = await exportXlsx(accToken, { report: "xyz" });
      expect((await bad.json()).error.code).toBe("invalid_argument");
      const badPeriod = await exportXlsx(accToken, { report: "gl", period: "2026-13" });
      expect((await badPeriod.json()).error.code).toBe("invalid_argument");
    });
  });
});
