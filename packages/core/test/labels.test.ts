import { describe, it, expect } from "vitest";
import { formatDocNo, formatMoney, DOC_TYPES, DOC_LABEL, ROLES, ROLE_LABEL } from "../src/labels";

describe("labels", () => {
  it("formatDocNo đệm 4 số", () => {
    expect(formatDocNo("SO", 1)).toBe("ĐB-0001");
    expect(formatDocNo("VINV", 123)).toBe("HĐM-0123");
    expect(formatDocNo("QUOTE", 10000)).toBe("BG-10000");
  });
  it("mọi doc type có prefix và tên", () => {
    for (const t of DOC_TYPES) {
      expect(DOC_LABEL[t].prefix.length).toBeGreaterThan(0);
      expect(DOC_LABEL[t].name.length).toBeGreaterThan(0);
    }
  });
  it("mọi vai có nhãn", () => {
    for (const r of ROLES) expect(ROLE_LABEL[r].length).toBeGreaterThan(0);
  });
  it("formatMoney kiểu vi-VN", () => {
    expect(formatMoney(11000000)).toBe("11.000.000 đ");
  });
});
