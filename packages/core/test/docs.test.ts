import { describe, it, expect } from "vitest";
import { canTransition, lineTotal, docTotal, docTax } from "../src/docs";
import { STATUSES } from "../src/labels";

describe("canTransition", () => {
  it("draft đi được tới pending/confirmed/cancelled, KHÔNG đi thẳng done", () => {
    expect(canTransition("draft", "pending")).toBe(true);
    expect(canTransition("draft", "confirmed")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
    expect(canTransition("draft", "done")).toBe(false);
    expect(canTransition("draft", "partial")).toBe(false);
  });

  it("KHÔNG BAO GIỜ có đường về draft từ bất kỳ trạng thái nào khác", () => {
    for (const from of STATUSES) {
      if (from === "draft") continue;
      expect(canTransition(from, "draft")).toBe(false);
    }
  });

  it("done và cancelled là trạng thái cuối", () => {
    for (const to of STATUSES) {
      expect(canTransition("done", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });

  it("confirmed đi được tới partial/done/cancelled", () => {
    expect(canTransition("confirmed", "partial")).toBe(true);
    expect(canTransition("confirmed", "done")).toBe(true);
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("confirmed", "pending")).toBe(false);
  });
});

describe("lineTotal / docTotal / docTax", () => {
  it("lineTotal làm tròn đồng", () => {
    expect(lineTotal({ qty: 3, price: 1000 })).toBe(3000);
    expect(lineTotal({ qty: 1.5, price: 999 })).toBe(1499); // 1498.5 -> làm tròn
  });

  it("docTotal cộng dồn các dòng (chưa thuế)", () => {
    const lines = [
      { qty: 2, price: 100000 },
      { qty: 1, price: 50000 },
    ];
    expect(docTotal(lines)).toBe(250000);
  });

  it("docTax tính theo % thuế từng dòng, cộng dồn", () => {
    const lines = [
      { qty: 1, price: 100000, taxPct: 10 },
      { qty: 1, price: 200000, taxPct: 8 },
    ];
    expect(docTax(lines)).toBe(10000 + 16000);
  });

  it("dòng không có taxPct coi như 0% thuế", () => {
    expect(docTax([{ qty: 1, price: 100000 }])).toBe(0);
  });
});
