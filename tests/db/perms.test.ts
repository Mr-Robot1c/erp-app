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
    allowed: ["admin", "accountant"],
  },
  {
    name: "POST /api/master/items",
    call: (token) => post("/api/master/items", token, { code: `I${randomUUID().slice(0, 8)}`, name: "x", kind: "goods" }),
    allowed: ["admin", "accountant"],
  },
  {
    name: "POST /api/master/partners/update",
    call: (token) => post("/api/master/partners/update", token, { id: randomUUID(), name: "x" }),
    allowed: ["admin", "accountant"],
  },
  {
    name: "POST /api/master/items/update",
    call: (token) => post("/api/master/items/update", token, { id: randomUUID(), name: "x" }),
    allowed: ["admin", "accountant"],
  },
  {
    name: "POST /api/master/warehouses",
    call: (token) => post("/api/master/warehouses", token, { code: `K${randomUUID().slice(0, 8)}`, name: "x" }),
    allowed: ["admin", "accountant"],
  },
  {
    name: "POST /api/master/remove-sample",
    call: (token) => post("/api/master/remove-sample", token, {}),
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
  {
    name: "POST /api/invoices/issue",
    call: (token) => post("/api/invoices/issue", token, { invoiceId: randomUUID() }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "accountant", "chief_accountant"],
  },
  {
    name: "POST /api/receipts",
    call: (token) =>
      post("/api/receipts", token, { partnerId: randomUUID(), amount: 1000, method: "cash" }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "accountant", "chief_accountant"],
  },
  {
    name: "POST /api/purchase/orders",
    call: (token) =>
      post("/api/purchase/orders", token, { supplierId: randomUUID(), lines: [{ itemId: randomUUID(), qty: 1, price: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "purchasing"],
  },
  {
    name: "POST /api/purchase/orders/confirm",
    call: (token) => post("/api/purchase/orders/confirm", token, { poId: randomUUID() }),
    allowed: ["admin", "purchasing"],
  },
  {
    name: "POST /api/purchase/receive",
    call: (token) =>
      post("/api/purchase/receive", token, { poId: randomUUID(), lines: [{ lineNo: 1, qty: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "warehouse"],
  },
  {
    name: "POST /api/purchase/pass-qc",
    call: (token) => post("/api/purchase/pass-qc", token, { grnId: randomUUID() }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "warehouse"],
  },
  {
    name: "POST /api/purchase/vendor-invoice",
    call: (token) =>
      post("/api/purchase/vendor-invoice", token, { poId: randomUUID(), invoiceNo: "X", lines: [{ lineNo: 1, qty: 1, price: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "purchasing", "accountant", "chief_accountant"],
  },
  {
    name: "POST /api/purchase/pay",
    call: (token) =>
      post("/api/purchase/pay", token, { supplierId: randomUUID(), amount: 1000, method: "cash" }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "accountant", "chief_accountant"],
  },
  {
    name: "POST /api/stock/transfer",
    call: (token) =>
      post("/api/stock/transfer", token, { itemId: randomUUID(), fromWh: randomUUID(), toWh: randomUUID(), qty: 1 }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "warehouse"],
  },
  {
    name: "POST /api/stock/adjust",
    call: (token) => post("/api/stock/adjust", token, { itemId: randomUUID(), delta: -1, reason: "CASES" }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "warehouse"],
  },
  {
    name: "POST /api/sales/return",
    call: (token) =>
      post("/api/sales/return", token, { invoiceId: randomUUID(), condition: "good", lines: [{ lineNo: 1, qty: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "sales_lead", "sales"],
  },
  {
    name: "POST /api/purchase/return",
    call: (token) => post("/api/purchase/return", token, { poId: randomUUID(), lines: [{ lineNo: 1, qty: 1 }] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "purchasing", "warehouse"],
  },
  {
    name: "POST /api/docs/cancel",
    call: (token) => post("/api/docs/cancel", token, { docId: randomUUID() }),
    allowed: ["admin", "sales_lead", "sales", "purchasing"],
  },
  {
    name: "POST /api/dashboard/queues",
    call: (token) => post("/api/dashboard/queues", token, {}),
    allowed: [...ROLES], // đọc-đếm: mọi vai trong tenant (staff xem chỉ-đọc)
  },
  {
    name: "POST /api/dashboard/summary",
    call: (token) => post("/api/dashboard/summary", token, { ym: "2026-01" }),
    allowed: [...ROLES],
  },
  {
    name: "POST /api/search/documents",
    call: (token) => post("/api/search/documents", token, { q: "BG" }),
    allowed: [...ROLES], // tìm chứng từ toàn cục: mọi vai, kết quả luôn giới hạn theo tenant của session
  },
  {
    name: "POST /api/onboarding/opening-balance",
    call: (token) => post("/api/onboarding/opening-balance", token, { cash: { c111: 1000, c112: 0 } }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "chief_accountant"],
  },
  {
    name: "POST /api/onboarding/remove-sample",
    call: (token) => post("/api/onboarding/remove-sample", token, {}),
    allowed: ["admin", "chief_accountant"],
  },
  {
    name: "POST /api/acc/journal-adjust",
    call: (token) =>
      post("/api/acc/journal-adjust", token, { date: "2000-01-15", memo: "CASES", lines: [["111", 100, 0], ["411", 0, 100]] }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "chief_accountant"],
  },
  {
    name: "POST /api/acc/lock-period",
    call: (token) => post("/api/acc/lock-period", token, { ym: "2099-01" }), // tương lai → invalid_argument cho vai được phép, không khoá thật
    allowed: ["admin", "chief_accountant"],
  },
  {
    name: "POST /api/receipts/match",
    call: (token) => post("/api/receipts/match", token, { receiptId: randomUUID() }, { "idempotency-key": randomUUID() }),
    allowed: ["admin", "accountant", "chief_accountant"],
  },
  {
    name: "POST /api/tasks/list",
    call: (token) => post("/api/tasks/list", token, {}), // scope mặc định = việc của tôi: mọi vai gọi được; scope=all chỉ admin/giám đốc (kiểm ở tasks-list.test.ts)
    allowed: [...ROLES],
  },
  // POST /api/reports/export KHÔNG vào bảng này: trả TỆP .xlsx (không phải JSON) khi thành công — quyền (403 kinh doanh, 401 chưa đăng nhập) kiểm ở tests/db/report.test.ts.
  // POST /api/jobs/overdue-sweep KHÔNG vào bảng này: xác thực bằng token việc định kỳ (header x-job-token), không phải phiên người dùng
  // — đã kiểm ở tests/db/overdue.test.ts (thiếu/sai token → forbidden).
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
