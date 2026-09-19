import { describe, it, expect } from "vitest";
import { buildChain } from "../src/index";

const SETTINGS = { expThreshold: 10_000_000 };

describe("buildChain (EXP)", () => {
  it("dưới ngưỡng -> 2 cấp: trưởng bộ phận, kế toán", () => {
    const { chain, skippedSelf } = buildChain("EXP", 800_000, SETTINGS, "staff");
    expect(chain).toEqual(["dept_lead", "accountant"]);
    expect(skippedSelf).toBe(false);
  });

  it("trên ngưỡng -> thêm giám đốc, 3 cấp", () => {
    const { chain } = buildChain("EXP", 15_000_000, SETTINGS, "staff");
    expect(chain).toEqual(["dept_lead", "accountant", "director"]);
  });

  it("người lập là dept_lead -> bỏ cấp tự duyệt (AC-29)", () => {
    const { chain, skippedSelf } = buildChain("EXP", 800_000, SETTINGS, "dept_lead");
    expect(chain).toEqual(["accountant"]);
    expect(skippedSelf).toBe(true);
    expect(chain).not.toContain("dept_lead");
  });

  it("người lập là accountant, trên ngưỡng -> bỏ cấp accountant, còn dept_lead + director", () => {
    const { chain, skippedSelf } = buildChain("EXP", 15_000_000, SETTINGS, "accountant");
    expect(chain).toEqual(["dept_lead", "director"]);
    expect(skippedSelf).toBe(true);
  });

  it("kind khác EXP -> báo lỗi (chưa hỗ trợ)", () => {
    // @ts-expect-error kind chỉ hỗ trợ "EXP" ở lô 1.3, cố tình truyền sai để kiểm hàng rào
    expect(() => buildChain("PO", 1000, SETTINGS, "staff")).toThrow();
  });
});

import { buildPoChain } from "../src/index";

describe("buildPoChain (AC-20)", () => {
  const S = { poThreshold: 20_000_000 };
  it("trên ngưỡng -> 2 cấp; dưới/bằng ngưỡng -> 1 cấp", () => {
    expect(buildPoChain(25_000_000, S, "purchasing").chain).toEqual(["dept_lead", "chief_accountant"]);
    expect(buildPoChain(20_000_000, S, "purchasing").chain).toEqual(["dept_lead"]);
  });
  it("bỏ cấp tự duyệt; chuỗi rỗng thì nâng lên kế toán trưởng", () => {
    expect(buildPoChain(25_000_000, S, "dept_lead").chain).toEqual(["chief_accountant"]);
    expect(buildPoChain(5_000_000, S, "dept_lead").chain).toEqual(["chief_accountant"]);
    expect(buildPoChain(5_000_000, S, "chief_accountant").chain).toEqual(["dept_lead"]);
  });
});
