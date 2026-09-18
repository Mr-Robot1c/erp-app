import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestTenant, createPartner, apiUrl, sql, type TestTenant } from "./helper";

async function postDoc(token: string, key: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${token}` };
  if (key !== null) headers["idempotency-key"] = key;
  const res = await fetch(apiUrl("/api/docs/create"), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

async function postSetStatus(token: string, body: unknown) {
  const res = await fetch(apiUrl("/api/docs/set-status"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

describe("khung chứng từ — cấp số song song", () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant({ role: "admin" });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("20 lần tạo SO cùng lúc -> 20 số liên tục, không trùng không trống", async () => {
    const { accessToken } = await t.signIn();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postDoc(accessToken, `parallel-${i}-${randomUUID()}`, { docType: "SO" })),
    );
    const nos = results
      .map((r) => {
        expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
        return r.json.data.doc_no as string;
      })
      .sort();
    const expected = Array.from({ length: 20 }, (_, i) => `ĐB-${String(i + 1).padStart(4, "0")}`);
    expect(nos).toEqual(expected);
  });
});

describe("khung chứng từ — bất biến, chuyển trạng thái, FK kép, bypass SQL", () => {
  let a: TestTenant;
  let b: TestTenant;
  let confirmedDocId: string;

  beforeAll(async () => {
    a = await createTestTenant({ role: "admin" });
    b = await createTestTenant({ role: "admin" });
  });

  afterAll(async () => {
    await a.cleanup();
    await b.cleanup();
  });

  it("confirm rồi: UPDATE doc_date bằng SQL bị chặn; xoá dòng bị chặn; update meta vẫn OK", async () => {
    const { accessToken } = await a.signIn();
    const created = await postDoc(accessToken, `create-${randomUUID()}`, {
      docType: "QUOTE",
      lines: [{ qty: 1, price: 100000 }],
    });
    expect(created.json.ok, JSON.stringify(created.json)).toBe(true);
    confirmedDocId = created.json.data.id;

    const confirmed = await postSetStatus(accessToken, { docId: confirmedDocId, to: "confirmed" });
    expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true);

    await expect(sql`update documents set doc_date = '2000-01-01' where id = ${confirmedDocId}`).rejects.toThrow(
      /document_immutable/,
    );

    const [line] = await sql`select id from document_lines where document_id = ${confirmedDocId} limit 1`;
    await expect(sql`delete from document_lines where id = ${line.id}`).rejects.toThrow(/document_immutable/);

    await expect(
      sql`update documents set meta = meta || '{"note":"ok"}'::jsonb where id = ${confirmedDocId}`,
    ).resolves.toBeDefined();
  });

  it("draft -> done thẳng bị state_invalid", async () => {
    const { accessToken } = await a.signIn();
    const created = await postDoc(accessToken, `create-${randomUUID()}`, { docType: "QUOTE" });
    expect(created.json.ok).toBe(true);

    const res = await postSetStatus(accessToken, { docId: created.json.data.id, to: "done" });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("state_invalid");
  });

  it("document tenant B trỏ partner của tenant A -> FK kép chặn (23503)", async () => {
    const partnerIdA = await createPartner(a.tenantId, "PFK1");
    await expect(
      sql`insert into documents (tenant_id, doc_type, doc_no, partner_id)
          values (${b.tenantId}, 'SO', 'TEST-FK-0001', ${partnerIdA})`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("bypass SQL quyền server: về draft / xoá / chuyển dòng sang chứng từ khác đều bị chặn", async () => {
    const { accessToken } = await a.signIn();

    await expect(sql`update documents set status = 'draft' where id = ${confirmedDocId}`).rejects.toThrow(
      /document_immutable/,
    );
    await expect(sql`delete from documents where id = ${confirmedDocId}`).rejects.toThrow(/document_immutable/);

    const otherDraft = await postDoc(accessToken, `create-${randomUUID()}`, { docType: "QUOTE" });
    expect(otherDraft.json.ok).toBe(true);
    const [line] = await sql`select id from document_lines where document_id = ${confirmedDocId} limit 1`;
    await expect(
      sql`update document_lines set document_id = ${otherDraft.json.data.id} where id = ${line.id}`,
    ).rejects.toThrow(/document_immutable/);
  });
});

describe("khung chứng từ — idempotency", () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTestTenant({ role: "admin" });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("(1) gọi 2 lần tuần tự cùng key -> 1 document, response giống hệt", async () => {
    const { accessToken } = await t.signIn();
    const key = `seq-${randomUUID()}`;
    const body = { docType: "QUOTE", lines: [{ qty: 1, price: 1000 }] };

    const r1 = await postDoc(accessToken, key, body);
    const r2 = await postDoc(accessToken, key, body);
    expect(r1.json.ok).toBe(true);
    expect(r2.json).toEqual(r1.json);

    const rows = await sql`select id from documents where tenant_id = ${t.tenantId} and doc_no = ${r1.json.data.doc_no}`;
    expect(rows).toHaveLength(1);
  });

  it("(2) 2 request đồng thời cùng key -> chỉ 1 document được tạo", async () => {
    const { accessToken } = await t.signIn();
    const key = `concurrent-${randomUUID()}`;
    const body = { docType: "QUOTE", lines: [{ qty: 2, price: 2000 }] };

    const [r1, r2] = await Promise.all([postDoc(accessToken, key, body), postDoc(accessToken, key, body)]);
    expect(r1.json.ok).toBe(true);
    expect(r2.json.ok).toBe(true);
    expect(r1.json.data.id).toBe(r2.json.data.id);

    const rows = await sql`select id from documents where tenant_id = ${t.tenantId} and doc_no = ${r1.json.data.doc_no}`;
    expect(rows).toHaveLength(1);
  });

  it("(3) cùng key nhưng body khác -> conflict", async () => {
    const { accessToken } = await t.signIn();
    const key = `mismatch-${randomUUID()}`;

    const r1 = await postDoc(accessToken, key, { docType: "QUOTE", lines: [{ qty: 1, price: 1000 }] });
    expect(r1.json.ok).toBe(true);

    const r2 = await postDoc(accessToken, key, { docType: "QUOTE", lines: [{ qty: 9, price: 9000 }] });
    expect(r2.json.ok).toBe(false);
    expect(r2.json.error.code).toBe("conflict");
  });

  it("(4) lỗi giữa chừng không đốt key -> retry với body đúng vẫn tạo được", async () => {
    const { accessToken } = await t.signIn();
    const key = `midfail-${randomUUID()}`;
    const bogusPartnerId = randomUUID(); // uuid hợp lệ nhưng không tồn tại -> FK kép chặn giữa transaction

    const bad = await postDoc(accessToken, key, { docType: "QUOTE", partnerId: bogusPartnerId });
    expect(bad.json.ok).toBe(false);

    const retry = await postDoc(accessToken, key, { docType: "QUOTE" });
    expect(retry.json.ok, JSON.stringify(retry.json)).toBe(true);
  });

  it("(5) endpoint required, thiếu header Idempotency-Key -> invalid_argument", async () => {
    const { accessToken } = await t.signIn();
    const res = await postDoc(accessToken, null, { docType: "QUOTE" });
    expect(res.json.ok).toBe(false);
    expect(res.json.error.code).toBe("invalid_argument");
  });

  it("(6) đổi key -> tạo document mới", async () => {
    const { accessToken } = await t.signIn();
    const body = { docType: "QUOTE", lines: [{ qty: 1, price: 500 }] };
    const r1 = await postDoc(accessToken, `keyA-${randomUUID()}`, body);
    const r2 = await postDoc(accessToken, `keyB-${randomUUID()}`, body);
    expect(r1.json.ok).toBe(true);
    expect(r2.json.ok).toBe(true);
    expect(r1.json.data.id).not.toBe(r2.json.data.id);
  });
});
