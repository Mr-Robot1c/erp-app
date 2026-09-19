import { describe, expect, it } from "vitest";
import { convertQty, isBalanced, postDelivery, postInvoice, postReceipt, postVendorInvoice } from "../src/index";

describe("AC-43 convertQty", () => {
  it("2 thùng (1 thùng = 12 cái) -> 24 cái; tồn 30 - 24 = 6", () => {
    const base = convertQty(2, "thùng", "cái", { thùng: 12 });
    expect(base).toBe(24);
    expect(30 - base).toBe(6);
  });
  it("không truyền đơn vị hoặc đúng đơn vị gốc -> giữ nguyên", () => {
    expect(convertQty(5, undefined, "cái")).toBe(5);
    expect(convertQty(5, "cái", "cái", { thùng: 12 })).toBe(5);
  });
  it("đơn vị lạ -> báo lỗi", () => {
    expect(() => convertQty(1, "pallet", "cái", { thùng: 12 })).toThrow();
  });
});

describe("posting — mọi bút toán cân", () => {
  it("DO, INV, RCPT", () => {
    expect(isBalanced(postDelivery(6_000_000))).toBe(true);
    expect(isBalanced(postInvoice(10_000_000, 1_000_000))).toBe(true);
    expect(isBalanced(postReceipt(8_500_000, "bank"))).toBe(true);
    expect(postInvoice(10_000_000, 1_000_000)[0]).toEqual(["131", 11_000_000, 0]);
  });

  it("hoá đơn mua: chỉ ghi chênh + thuế, Có 331 khớp phải trả, luôn cân", () => {
    // Ví dụ có thuế trong playbook: GRN 1.000.000; hoá đơn 1.005.000 + VAT 100.500 → Nợ 156 5.000, Nợ 133 100.500 / Có 331 105.500.
    const l = postVendorInvoice({ adjByAccount: { "156": 5_000 }, serviceNet: 0, tax: 100_500 });
    expect(l).toEqual([["156", 5_000, 0], ["133", 100_500, 0], ["331", 0, 105_500]]);
    expect(isBalanced(l)).toBe(true);
    // Hoá đơn rẻ hơn giá tạm: Có 156; dịch vụ ghi đủ vào 642.
    const cheaper = postVendorInvoice({ adjByAccount: { "156": -3_000 }, serviceNet: 200_000, tax: 20_000 });
    expect(isBalanced(cheaper)).toBe(true);
    expect(cheaper.find((x) => x[0] === "331")).toEqual(["331", 0, 217_000]);
    // Chênh âm lớn hơn thuế → Nợ 331.
    const neg = postVendorInvoice({ adjByAccount: { "156": -50_000 }, serviceNet: 0, tax: 0 });
    expect(neg).toEqual([["156", 0, 50_000], ["331", 50_000, 0]]);
    expect(isBalanced(neg)).toBe(true);
  });
});
