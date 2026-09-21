import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createPartner, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

async function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const idem = () => ({ "idempotency-key": randomUUID() });

describe("bút toán điều chỉnh + khoá kỳ (lô 4.3) — AC-32, AC-33", () => {
  let tenant: TestTenant;
  const members: TenantMember[] = [];
  let chiefToken: string;
  let accToken: string;
  let customerId: string;

  beforeEach(async () => {
    members.length = 0;
    tenant = await createTestTenant({ role: "admin" });
    const chief = await addTenantMember(tenant.tenantId, "chief_accountant");
    const acc = await addTenantMember(tenant.tenantId, "accountant");
    members.push(chief, acc);
    chiefToken = (await chief.signIn()).accessToken;
    accToken = (await acc.signIn()).accessToken;
    customerId = await createPartner(tenant.tenantId, "KH1", { creditLimit: 1_000_000_000 });
  });
  afterEach(async () => {
    for (const m of members) await m.cleanup();
    await tenant?.cleanup();
  });

  const adjust = (date: string, memo = "Điều chỉnh", amount = 1_000_000, token = chiefToken) =>
    post("/api/acc/journal-adjust", token, { date, memo, lines: [["642", amount, 0], ["111", 0, amount]] }, idem());
  const lock = (ym: string, token = chiefToken) => post("/api/acc/lock-period", token, { ym });
  const receipt = (body: Record<string, unknown>) => post("/api/receipts", accToken, { partnerId: customerId, method: "bank", ...body }, idem());
  const entriesIn = async (ym: string) =>
    Number((await sql`select count(*) n from journal_entries where tenant_id = ${tenant.tenantId} and to_char(entry_date, 'YYYY-MM') = ${ym}`)[0].n);
  const periodStatus = async (ym: string) => (await sql`select status from periods where tenant_id = ${tenant.tenantId} and ym = ${ym}`)[0]?.status as string | undefined;

  describe("bút toán điều chỉnh tay", () => {
    it("ghi bút toán cân gắn phiếu ADJ có số, truy ngược được; lệch cân / một dòng cả Nợ lẫn Có / mã TK sai bị từ chối; kế toán thường bị chặn", async () => {
      const r = await adjust("2026-09-15", "Phân bổ chi phí trả trước");
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect(r.json.data.doc_type).toBe("ADJ");
      const lines = await sql`select l.account_code c, l.debit d, l.credit k, j.doc_no from journal_lines l join journal_entries e on e.id = l.entry_id join documents j on j.id = e.document_id where e.id = ${r.json.data.entryId} order by l.account_code`;
      expect(lines.map((l) => [l.c, Number(l.d), Number(l.k)])).toEqual([["111", 0, 1_000_000], ["642", 1_000_000, 0]]);
      expect(lines[0].doc_no).toBe(r.json.data.doc_no);

      const unbalanced = await post("/api/acc/journal-adjust", chiefToken, { date: "2026-09-15", memo: "x", lines: [["642", 100, 0], ["111", 0, 90]] }, idem());
      expect(unbalanced.json.error.code).toBe("invalid_argument");
      const both = await post("/api/acc/journal-adjust", chiefToken, { date: "2026-09-15", memo: "x", lines: [["642", 100, 100], ["111", 0, 0]] }, idem());
      expect(both.json.error.code).toBe("invalid_argument");
      const badAcc = await post("/api/acc/journal-adjust", chiefToken, { date: "2026-09-15", memo: "x", lines: [["ab", 100, 0], ["111", 0, 100]] }, idem());
      expect(badAcc.json.error.code).toBe("invalid_argument");
      const one = await post("/api/acc/journal-adjust", chiefToken, { date: "2026-09-15", memo: "x", lines: [["642", 100, 0]] }, idem());
      expect(one.json.error.code).toBe("invalid_argument");
      expect((await adjust("2026-09-15", "x", 5, accToken)).status).toBe(403);
      expect(await entriesIn("2026-09")).toBe(1);
    });
  });

  describe("AC-32 kỳ khoá bất biến", () => {
    it("khoá T9 rồi ghi chứng từ/bút toán ngày 28/9 -> period_locked kèm đề nghị kỳ mở sớm nhất (T10); T9 không có bút toán mới", async () => {
      await adjust("2026-09-10", "Trước khoá");
      const before = await entriesIn("2026-09");
      const l = await lock("2026-09");
      expect(l.json.ok, JSON.stringify(l.json)).toBe(true);
      expect(await periodStatus("2026-09")).toBe("locked");

      const a = await adjust("2026-09-28");
      expect(a.json.error.code).toBe("period_locked");
      expect(a.json.error.suggestedDate).toBe("2026-10-01");
      expect(a.json.error.suggestedPeriod).toBe("2026-10");
      const r = await receipt({ amount: 500_000, date: "2026-09-28" });
      expect(r.json.error.code).toBe("period_locked");
      expect(r.json.error.suggestedPeriod).toBe("2026-10");
      expect(await entriesIn("2026-09")).toBe(before);
      expect((await sql`select 1 from documents where tenant_id = ${tenant.tenantId} and doc_type = 'RCPT'`).length).toBe(0); // rollback cả chứng từ

      // Ghi vào kỳ mở kế tiếp thì được
      const ok = await adjust("2026-10-01", "Ghi lại vào T10");
      expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    });

    it("đề nghị kỳ BỎ QUA các kỳ khoá liên tiếp (T9, T10 khoá → gợi ý T11)", async () => {
      await sql`insert into periods (tenant_id, ym, status) values (${tenant.tenantId}, '2026-09', 'locked'), (${tenant.tenantId}, '2026-10', 'locked')`;
      const a = await adjust("2026-09-28");
      expect(a.json.error.code).toBe("period_locked");
      expect(a.json.error.suggestedPeriod).toBe("2026-11");
      expect(a.json.error.suggestedDate).toBe("2026-11-01");
    });

    it("hàng rào DB: kể cả SQL trực tiếp cũng không ghi/sửa/xoá sổ kỳ đã khoá, và kỳ khoá không mở lại được", async () => {
      const r = await adjust("2026-09-10");
      await lock("2026-09");
      await expect(sql`insert into journal_entries (tenant_id, entry_date, memo) values (${tenant.tenantId}, '2026-09-20', 'lách')`).rejects.toThrow(/period_locked/);
      await expect(sql`update journal_entries set memo = 'sửa' where id = ${r.json.data.entryId}`).rejects.toThrow(/period_locked/);
      await expect(sql`insert into journal_lines (tenant_id, entry_id, account_code, debit, credit) values (${tenant.tenantId}, ${r.json.data.entryId}, '111', 1, 0)`).rejects.toThrow(/period_locked/);
      await expect(sql`delete from journal_lines where entry_id = ${r.json.data.entryId}`).rejects.toThrow(/period_locked/);
      await expect(sql`update periods set status = 'open' where tenant_id = ${tenant.tenantId} and ym = '2026-09'`).rejects.toThrow(/period_locked/);
      await expect(sql`delete from periods where tenant_id = ${tenant.tenantId} and ym = '2026-09'`).rejects.toThrow(/period_locked/);
      expect(await periodStatus("2026-09")).toBe("locked");
    });

    it("khoá lại kỳ đã khoá -> state_invalid; kỳ tương lai / sai định dạng -> invalid_argument; kế toán thường bị chặn", async () => {
      expect((await lock("2026-09")).json.ok).toBe(true);
      expect((await lock("2026-09")).json.error.code).toBe("state_invalid");
      expect((await lock("2099-01")).json.error.code).toBe("invalid_argument");
      expect((await lock("2026-9")).json.error.code).toBe("invalid_argument");
      expect((await lock("2026-08", accToken)).status).toBe(403);
    });
  });

  describe("AC-33 khoá kỳ khi còn hàng chờ bị chặn", () => {
    it("T9 còn 2 phiếu thu chờ khớp tay -> từ chối, liệt kê 2 mục, kỳ vẫn Mở; khớp tay xong 2 phiếu -> khoá được", async () => {
      const r1 = await receipt({ amount: 300_000, date: "2026-09-10" });
      const r2 = await receipt({ amount: 200_000, date: "2026-09-12" });
      expect(r1.json.ok && r2.json.ok, JSON.stringify([r1.json, r2.json])).toBe(true);

      const denied = await lock("2026-09");
      expect(denied.json.error.code).toBe("conflict");
      expect(denied.json.error.blockers).toHaveLength(2);
      expect(denied.json.error.blockers.map((b: { type: string }) => b.type)).toEqual(["unmatched_receipt", "unmatched_receipt"]);
      expect(denied.json.error.blockers.map((b: { docNo: string }) => b.docNo).sort()).toEqual([r1.json.data.doc_no, r2.json.data.doc_no].sort());
      expect(await periodStatus("2026-09")).not.toBe("locked"); // kỳ vẫn Mở

      // Phiếu 1: xác nhận giữ làm tiền ứng trước. Phiếu 2: khớp vào khoản phải thu của khách.
      const keep = await post("/api/receipts/match", accToken, { receiptId: r1.json.data.id }, idem());
      expect(keep.json.ok, JSON.stringify(keep.json)).toBe(true);
      expect(keep.json.data).toMatchObject({ matched: 0, advance: 300_000 });
      const still = await lock("2026-09");
      expect(still.json.error.blockers).toHaveLength(1);

      const [rec] = await sql`insert into receivables (tenant_id, kind, partner_id, amount, due_date) values (${tenant.tenantId}, 'invoice', ${customerId}, 150000, '2026-10-30') returning id`;
      const match = await post("/api/receipts/match", accToken, { receiptId: r2.json.data.id, receivableId: rec.id }, idem());
      expect(match.json.ok, JSON.stringify(match.json)).toBe(true);
      expect(match.json.data).toMatchObject({ matched: 150_000, advance: 50_000 });
      const [{ paid }] = await sql`select paid from receivables where id = ${rec.id}`;
      expect(Number(paid)).toBe(150_000);
      // Tiền ứng trước của khách giảm đúng phần đã khớp: 500k − 150k
      expect(Number((await sql`select amount from partner_advances where tenant_id = ${tenant.tenantId} and partner_id = ${customerId}`)[0].amount)).toBe(350_000);

      // Phiếu 2 còn 50k chưa khớp (khoản phải thu chỉ 150k) → xác nhận nốt phần còn lại thì hết chặn
      const rest = await post("/api/receipts/match", accToken, { receiptId: r2.json.data.id }, idem());
      expect(rest.json.ok, JSON.stringify(rest.json)).toBe(true);
      const ok = await lock("2026-09");
      expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
      expect(await periodStatus("2026-09")).toBe("locked");
    });

    it("chứng từ chờ duyệt và hoá đơn nháp đã giao trong kỳ cũng chặn khoá; hoá đơn nháp giao kỳ sau thì không", async () => {
      await sql`insert into documents (tenant_id, doc_type, doc_no, doc_date, status, partner_id) values (${tenant.tenantId}, 'PO', 'DM-CHO', '2026-09-05', 'pending', ${customerId})`;
      await sql`insert into documents (tenant_id, doc_type, doc_no, doc_date, status, partner_id, meta) values (${tenant.tenantId}, 'INV', 'HD-NHAP', '2026-10-02', 'draft', ${customerId}, '{"deliverDate":"2026-09-30"}'::jsonb)`;
      await sql`insert into documents (tenant_id, doc_type, doc_no, doc_date, status, partner_id, meta) values (${tenant.tenantId}, 'INV', 'HD-KYSAU', '2026-10-02', 'draft', ${customerId}, '{"deliverDate":"2026-10-02"}'::jsonb)`;
      const denied = await lock("2026-09");
      expect(denied.json.error.code).toBe("conflict");
      expect(denied.json.error.blockers.map((b: { type: string; docNo: string }) => `${b.type}:${b.docNo}`)).toEqual(["pending_doc:DM-CHO", "inv_draft:HD-NHAP"]);
      expect(await periodStatus("2026-09")).not.toBe("locked");
    });

    it("khớp tay: khoản không thuộc khách / đã thu đủ / phiếu không còn chờ khớp -> bị từ chối; kế toán được, kho không", async () => {
      const r = await receipt({ amount: 100_000, date: "2026-09-10" });
      const other = await createPartner(tenant.tenantId, "KH2");
      const [foreign] = await sql`insert into receivables (tenant_id, kind, partner_id, amount) values (${tenant.tenantId}, 'invoice', ${other}, 999) returning id`;
      const wrong = await post("/api/receipts/match", accToken, { receiptId: r.json.data.id, receivableId: foreign.id }, idem());
      expect(wrong.json.error.code).toBe("invalid_argument");
      const [paid] = await sql`insert into receivables (tenant_id, kind, partner_id, amount, paid) values (${tenant.tenantId}, 'invoice', ${customerId}, 500, 500) returning id`;
      const full = await post("/api/receipts/match", accToken, { receiptId: r.json.data.id, receivableId: paid.id }, idem());
      expect(full.json.error.code).toBe("state_invalid");
      expect((await post("/api/receipts/match", accToken, { receiptId: r.json.data.id }, idem())).json.ok).toBe(true);
      const again = await post("/api/receipts/match", accToken, { receiptId: r.json.data.id }, idem());
      expect(again.json.error.code).toBe("state_invalid");
    });
  });
});
