import { describe, expect, it } from "vitest";
import { getSalesOrderStatusForStaff } from "./ai-read";

function fakeDb(member: object | null, doc: object | null, lines: object[] = []) {
  return async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("from memberships")) return member ? [member] : [];
    if (query.includes("from documents")) return doc ? [doc] : [];
    if (query.includes("from document_lines")) return lines;
    throw new Error("unexpected query");
  };
}

describe("tenant-scoped AI sales-order read", () => {
  it("returns the real ERP status projection without sensitive fields", async () => {
    const result = await getSalesOrderStatusForStaff(
      "tenant-a", "user-a", "ĐB-0003",
      fakeDb({ role: "sales" }, {
        doc_no: "ĐB-0003", status: "confirmed", meta: { deliveredAll: false },
        updated_at: "2026-09-22T10:00:00Z", partner_id: "hidden", totals: 99,
      }) as never,
    );
    expect(result).toEqual({
      record_id: "ĐB-0003", status_code: "confirmed", status_label_vi: "Đã xác nhận",
      fulfillment_status_label_vi: "Chờ xuất kho", updated_at: "2026-09-22T10:00:00.000Z",
    });
    expect(result).not.toHaveProperty("partner_id");
  });

  it("uses actual delivery semantics", async () => {
    const result = await getSalesOrderStatusForStaff("tenant-a", "user-a", "ĐB-0003",
      fakeDb({ role: "warehouse" }, { doc_no: "ĐB-0003", status: "confirmed", meta: { deliveredAll: true }, updated_at: null }) as never);
    expect(result.status_label_vi).toBe("Đã giao");
    expect(result.fulfillment_status_label_vi).toBe("Đã giao");
  });

  it.each([
    [null, { doc_no: "ĐB-0003", status: "confirmed", meta: {} }, "forbidden"],
    [{ role: "staff" }, { doc_no: "ĐB-0003", status: "confirmed", meta: {} }, "forbidden"],
    [{ role: "sales" }, null, "not_found"],
  ])("denies missing membership, unauthorized role, and wrong-tenant/unknown records", async (member, doc, code) => {
    await expect(getSalesOrderStatusForStaff("tenant-a", "user-a", "ĐB-9999", fakeDb(member, doc) as never))
      .rejects.toMatchObject({ code });
  });

  it("rejects missing trusted tenant before querying", async () => {
    await expect(getSalesOrderStatusForStaff("", "user-a", "ĐB-0003", fakeDb(null, null) as never))
      .rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("normalized sales-order AI view", () => {
  it("returns authoritative totals, minimal customer and safe lines", async () => {
    const { getSalesOrderForStaff } = await import("./ai-read");
    const result = await getSalesOrderForStaff("tenant-a", "user-a", "ĐB-0003", fakeDb(
      { role: "sales" },
      {
        id: "doc-a", doc_no: "ĐB-0003", doc_date: "2026-09-21", status: "confirmed",
        meta: { deliveredAll: false, privateNote: "hidden" }, customer_name: "Công ty Khách A",
        item_count: "1", subtotal: "10000000", tax: "1000000", grand_total: "11000000", updated_at: null,
      },
      [{ product_name: "Máy lọc nước TEST", quantity: "5.000", unit: "cái", unit_price: "2000000", line_subtotal: "10000000", cost: "hidden" }],
    ) as never);
    expect(result.totals).toEqual({ subtotal_vnd: "10000000", tax_vnd: "1000000", grand_total_vnd: "11000000", currency: "VND" });
    expect(result.customer).toEqual({ display_name: "Công ty Khách A" });
    expect(result.items[0]).toEqual({ product_name: "Máy lọc nước TEST", quantity: "5.000", unit: "cái", unit_price_vnd: "2000000", line_subtotal_vnd: "10000000" });
    expect(JSON.stringify(result)).not.toContain("privateNote");
    expect(result.fulfillment_status_label_vi).toBe("Chờ xuất kho");
  });

  it("does not confuse confirmed/waiting warehouse with delivered", async () => {
    const { getSalesOrderForStaff } = await import("./ai-read");
    const base = { id: "d", doc_no: "ĐB-1", doc_date: "2026-09-21", customer_name: "A", item_count: "0", subtotal: "0", tax: "0", grand_total: "0", updated_at: null };
    const waiting = await getSalesOrderForStaff("t", "u", "ĐB-1", fakeDb({ role: "sales" }, { ...base, status: "confirmed", meta: { deliveredAll: false } }) as never);
    const delivered = await getSalesOrderForStaff("t", "u", "ĐB-1", fakeDb({ role: "sales" }, { ...base, status: "confirmed", meta: { deliveredAll: true } }) as never);
    expect(waiting.fulfillment_status_label_vi).toBe("Chờ xuất kho");
    expect(waiting.status_label_vi).toBe("Đã xác nhận");
    expect(delivered.fulfillment_status_label_vi).toBe("Đã giao");
  });

  it("treats a same-number order in another tenant as not found", async () => {
    const { getSalesOrderForStaff } = await import("./ai-read");
    await expect(getSalesOrderForStaff("tenant-a", "user-a", "ĐB-0003", fakeDb({ role: "sales" }, null) as never))
      .rejects.toMatchObject({ code: "not_found" });
  });
});
