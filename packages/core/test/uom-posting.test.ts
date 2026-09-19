import { describe, expect, it } from "vitest";
import { convertQty, isBalanced, postDelivery, postInvoice, postReceipt } from "../src/index";

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
});
