import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenantMember, apiUrl, createTestTenant, sql, type TenantMember, type TestTenant } from "./helper";

async function post(path: string, token: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

type T = { id: string; role: string; text: string; documentId: string | null; doc: { docNo: string; docType: string; status: string } | null; canAct: boolean };

describe("Việc cần làm — lọc theo vai đăng nhập (UX-1, 03 mục C3)", () => {
  let tenant: TestTenant;
  let other: TestTenant;
  const members: Record<string, TenantMember> = {};
  const tok: Record<string, string> = {};
  let soId: string;
  let soNo: string;
  let expId: string;

  const list = async (who: string, scope?: "mine" | "all") => post("/api/tasks/list", tok[who], scope ? { scope } : {});
  const rows = async (who: string, scope?: "mine" | "all") => (await list(who, scope)).json.data as T[];

  beforeAll(async () => {
    tenant = await createTestTenant({ role: "admin" });
    other = await createTestTenant({ role: "admin" });
    tok.admin = (await tenant.signIn()).accessToken;
    for (const role of ["warehouse", "accountant", "sales", "director", "dept_lead", "staff"] as const) {
      members[role] = await addTenantMember(tenant.tenantId, role);
      tok[role] = (await members[role].signIn()).accessToken;
    }
    const t = tenant.tenantId;
    const [so] = await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${t}, 'SO', 'ĐB-T001', 'confirmed') returning id, doc_no`;
    soId = so.id as string;
    soNo = so.doc_no as string;
    const [inv] = await sql`insert into documents (tenant_id, doc_type, doc_no, status) values (${t}, 'INV', 'HD-T001', 'draft') returning id`;
    await sql`insert into tasks (tenant_id, role, text, document_id) values
      (${t}, 'warehouse', 'Xuất kho ĐB-T001', ${soId}),
      (${t}, 'accountant', 'Phát hành hoá đơn HD-T001', ${inv.id}),
      (${t}, 'accountant', 'Nợ quá hạn: khách A', null),
      (${t}, 'sales', 'Chăm sóc khách A', null)`;
    await sql`insert into tasks (tenant_id, role, text, done) values (${t}, 'warehouse', 'Việc đã xong', true)`;
    // Việc của doanh nghiệp KHÁC không được lẫn vào
    await sql`insert into tasks (tenant_id, role, text) values (${other.tenantId}, 'warehouse', 'Việc của công ty khác')`;
    // Luồng duyệt thật: nhân viên đề xuất chi 15tr → chuỗi trưởng bộ phận → kế toán → giám đốc; việc đầu của trưởng bộ phận
    const exp = await post("/api/expenses", tok.staff, { amount: 15_000_000, purpose: "Mua thiết bị" });
    expect(exp.json.ok, JSON.stringify(exp.json)).toBe(true);
    expId = exp.json.data.id as string;
  });

  afterAll(async () => {
    for (const m of Object.values(members)) await m.cleanup();
    await tenant?.cleanup();
    await other?.cleanup();
  });

  it("Thủ kho chỉ thấy việc role=warehouse (việc chưa xong của công ty mình); mỗi việc trả kèm đúng chứng từ để bấm mở", async () => {
    const r = await rows("warehouse");
    expect(r).toHaveLength(1);
    expect(r[0].role).toBe("warehouse");
    expect(r[0].text).toBe("Xuất kho ĐB-T001");
    expect(r[0].documentId).toBe(soId);
    expect(r[0].doc).toEqual({ docNo: soNo, docType: "SO", status: "confirmed" });
    expect(r[0].canAct).toBe(false); // việc kho không phải bước duyệt
  });

  it("Kế toán chỉ thấy việc kế toán (2 việc, một việc không gắn chứng từ); kinh doanh chỉ thấy việc kinh doanh; nhân viên không thấy việc nào", async () => {
    const acc = await rows("accountant");
    expect(acc.map((t) => t.role)).toEqual(["accountant", "accountant"]);
    expect(acc.map((t) => t.text).sort()).toEqual(["Nợ quá hạn: khách A", "Phát hành hoá đơn HD-T001"]);
    expect(acc.find((t) => t.text.startsWith("Nợ quá hạn"))!.doc).toBeNull();
    expect(acc.find((t) => t.text.startsWith("Phát hành"))!.doc).toMatchObject({ docNo: "HD-T001", docType: "INV" });
    expect((await rows("sales")).map((t) => t.text)).toEqual(["Chăm sóc khách A"]);
    expect(await rows("staff")).toEqual([]);
  });

  it("chế độ 'Cả công ty' chỉ admin/giám đốc: vai thường xin scope=all -> forbidden (403); admin/giám đốc thấy đủ việc mọi vai và TẤT CẢ chỉ-đọc", async () => {
    for (const who of ["warehouse", "accountant", "sales", "dept_lead", "staff"]) {
      const r = await list(who, "all");
      expect(r.status, who).toBe(403);
      expect(r.json.error.code).toBe("forbidden");
    }
    for (const who of ["admin", "director"]) {
      const all = await rows(who, "all");
      expect(all).toHaveLength(5); // 1 kho + 2 kế toán + 1 kinh doanh + 1 trưởng bộ phận (đề xuất chi); không có việc đã xong / của công ty khác
      expect(new Set(all.map((t) => t.role))).toEqual(new Set(["warehouse", "accountant", "sales", "dept_lead"]));
      expect(all.every((t) => t.canAct === false), `${who} không thao tác hộ vai khác`).toBe(true);
    }
  });

  it("mặc định của admin/giám đốc là việc CỦA TÔI (chưa có việc mang vai đó → rỗng), không đổ việc vai khác ra", async () => {
    expect(await rows("admin")).toEqual([]);
    expect(await rows("director")).toEqual([]);
    expect(await rows("admin", "mine")).toEqual([]);
  });

  it("nút Duyệt/Từ chối (canAct) chỉ khi đúng vai tới lượt: trưởng bộ phận true, người lập không tự duyệt; duyệt xong việc chuyển sang kế toán", async () => {
    const lead = await rows("dept_lead");
    expect(lead).toHaveLength(1);
    expect(lead[0].doc).toMatchObject({ docType: "EXP", status: "pending" });
    expect(lead[0].documentId).toBe(expId);
    expect(lead[0].canAct).toBe(true);
    // Kế toán chưa tới lượt: chưa có việc duyệt nào cho kế toán ngoài 2 việc cũ, và các việc cũ không có nút
    expect((await rows("accountant")).every((t) => t.canAct === false)).toBe(true);

    const ok = await post("/api/approvals/decide", tok.dept_lead, { docId: expId, decision: "approve" });
    expect(ok.json.ok, JSON.stringify(ok.json)).toBe(true);
    expect(await rows("dept_lead")).toEqual([]); // việc của mình đã đóng
    const acc = await rows("accountant");
    const approve = acc.find((t) => t.documentId === expId)!;
    expect(approve.doc).toMatchObject({ docType: "EXP", status: "pending" });
    expect(approve.canAct).toBe(true); // tới lượt kế toán
    // Admin ở chế độ Cả công ty vẫn chỉ-đọc dù việc này đang chờ
    const all = await rows("admin", "all");
    expect(all.find((t) => t.documentId === expId)!.canAct).toBe(false);
  });

  it("người lập không bị giao việc duyệt của chính mình: kế toán lập đề xuất → chuỗi bỏ cấp kế toán, kế toán không có việc/nút nào trên đề xuất đó", async () => {
    const mine = await post("/api/expenses", tok.accountant, { amount: 15_000_000, purpose: "Kế toán tự lập" });
    expect(mine.json.ok, JSON.stringify(mine.json)).toBe(true);
    expect(mine.json.data.meta.chain).not.toContain("accountant");
    const acc = await rows("accountant");
    expect(acc.filter((x) => x.documentId === mine.json.data.id)).toHaveLength(0);
  });
});
