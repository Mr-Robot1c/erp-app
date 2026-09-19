import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ROLES, type Role } from "@erp/core";
import { createTestTenant, addTenantMember, apiUrl, type TestTenant, type TenantMember } from "./helper";

async function post(path: string, token: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** CASES — endpoint hiện có + body hợp lệ + vai được phép. NỐI DÀI ở mọi lô sau (00-luat-thi-cong):
 * thêm endpoint mới thì thêm 1 dòng ở đây. */
const CASES: { name: string; call: (token: string) => Promise<{ status: number; json: any }>; allowed: Role[] }[] = [
  {
    name: "POST /api/master/partners",
    call: (token) => post("/api/master/partners", token, { code: `P${randomUUID().slice(0, 8)}`, name: "x", kind: "customer" }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/master/items",
    call: (token) => post("/api/master/items", token, { code: `I${randomUUID().slice(0, 8)}`, name: "x", kind: "goods" }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/docs/create",
    call: (token) => post("/api/docs/create", token, { docType: "QUOTE" }, { "idempotency-key": randomUUID() }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/docs/set-status",
    call: (token) => post("/api/docs/set-status", token, { docId: randomUUID(), to: "confirmed" }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/team/invite",
    call: (token) => post("/api/team/invite", token, { email: `t_test_${randomUUID().slice(0, 8)}@test.local`, role: "staff" }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/team/set-role",
    call: (token) => post("/api/team/set-role", token, { userId: randomUUID(), role: "staff" }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/team/remove",
    call: (token) => post("/api/team/remove", token, { userId: randomUUID() }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/expenses",
    call: (token) => post("/api/expenses", token, { amount: 100_000, purpose: "CASES 403" }),
    allowed: ROLES.filter((r) => r !== "director"), // director không có action 'exp' (PERMS)
  },
  {
    name: "POST /api/tenant/settings",
    call: (token) =>
      post("/api/tenant/settings", token, { expThreshold: 10_000_000, poThreshold: 20_000_000, tolerancePct: 2, terms: 30 }),
    allowed: ["admin"],
  },
  {
    name: "POST /api/quotes",
    call: (token) =>
      post("/api/quotes", token, { partnerId: randomUUID(), lines: [{ itemId: randomUUID(), qty: 1, price: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "sales_lead", "sales"],
  },
  {
    name: "POST /api/quotes/confirm",
    call: (token) => post("/api/quotes/confirm", token, { quoteId: randomUUID() }),
    allowed: ["admin", "sales_lead", "sales"],
  },
  {
    name: "POST /api/quotes/expire-sweep",
    call: (token) => post("/api/quotes/expire-sweep", token, {}),
    allowed: ["admin"],
  },
  {
    name: "POST /api/quotes/to-order",
    call: (token) =>
      post("/api/quotes/to-order", token, { quoteId: randomUUID(), terms: "cash", depositPct: 0 }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "sales_lead", "sales"],
  },
  {
    name: "POST /api/orders/confirm",
    call: (token) => post("/api/orders/confirm", token, { orderId: randomUUID() }),
    allowed: ["admin", "sales_lead", "sales"],
  },
  {
    name: "POST /api/orders/refulfil",
    call: (token) => post("/api/orders/refulfil", token, { orderId: randomUUID() }),
    allowed: ["admin", "warehouse"],
  },
  {
    name: "POST /api/orders/deliver",
    call: (token) =>
      post("/api/orders/deliver", token, { orderId: randomUUID(), lines: [{ lineNo: 1, qty: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "warehouse"],
  },
  // POST /api/approvals/decide KHÔNG vào bảng này: quyền của nó phụ thuộc trạng thái/lượt của
  // MỘT chứng từ cụ thể (chain[approvals.length] === vai gọi HOẶC admin), không phải 1 danh sách
  // vai tĩnh theo endpoint như các case trên — cùng lý do /api/team/accept cũng không có ở đây.
  // Đã kiểm đầy đủ các nhánh forbidden của nó ở tests/db/approvals.test.ts (tự duyệt, sai lượt).
];

describe("ma trận quyền — CASES 403 (lô 1.2)", () => {
  let tenant: TestTenant;
  const members = new Map<Role, TenantMember>();
  const tokens = new Map<Role, string>();

  beforeAll(async () => {
    tenant = await createTestTenant({ role: "admin" });
    for (const r of ROLES) {
      const m: TenantMember =
        r === "admin"
          ? { userId: tenant.userId, email: tenant.email, role: "admin", signIn: tenant.signIn, cleanup: async () => {} }
          : await addTenantMember(tenant.tenantId, r);
      members.set(r, m);
      const { accessToken } = await m.signIn();
      tokens.set(r, accessToken);
    }
  });

  afterAll(async () => {
    for (const m of members.values()) await m.cleanup();
    await tenant.cleanup();
  });

  for (const c of CASES) {
    it(`${c.name}: đúng vai không bị forbidden, vai khác bị forbidden (403)`, async () => {
      for (const role of ROLES) {
        const token = tokens.get(role)!;
        const res = await c.call(token);
        if (c.allowed.includes(role)) {
          expect(
            res.json.ok || res.json.error?.code !== "forbidden",
            `${role} lẽ ra được phép gọi ${c.name} nhưng bị forbidden`,
          ).toBe(true);
        } else {
          expect(res.json.ok, `${role} lẽ ra bị chặn ở ${c.name} nhưng lại thành công`).toBe(false);
          expect(res.json.error.code).toBe("forbidden");
          expect(res.status).toBe(403);
        }
      }
    });
  }
});
