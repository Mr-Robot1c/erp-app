import { describe, it, expect } from "vitest";
import { can, canView, PERMS, ROLES } from "../src/index";

describe("PERMS / can / canView", () => {
  it("mọi vai đều có entry trong PERMS", () => {
    for (const r of ROLES) expect(PERMS[r]).toBeDefined();
  });

  it("admin luôn được mọi action/view, kể cả action không liệt kê", () => {
    expect(can("admin", "lock")).toBe(true);
    expect(canView("admin", "set")).toBe(true);
  });

  it("staff không được duyệt (approve), chỉ có exp/adv", () => {
    expect(can("staff", "approve")).toBe(false);
    expect(can("staff", "exp")).toBe(true);
    expect(can("staff", "adv")).toBe(true);
  });

  it("sales_lead được duyệt, sales thường thì không", () => {
    expect(can("sales_lead", "approve")).toBe(true);
    expect(can("sales", "approve")).toBe(false);
  });

  it("chief_accountant được khoá kỳ (lock), accountant thường thì không", () => {
    expect(can("chief_accountant", "lock")).toBe(true);
    expect(can("accountant", "lock")).toBe(false);
  });

  it("director xem được mọi view nhưng chỉ hành động approve/reject", () => {
    expect(canView("director", "acc")).toBe(true);
    expect(can("director", "quote")).toBe(false);
    expect(can("director", "approve")).toBe(true);
  });
});
