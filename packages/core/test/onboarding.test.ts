import { describe, it, expect } from "vitest";
import { buildTenantSeed, type IndustryTemplate } from "../src/onboarding";

const TRADE_TEMPLATE: IndustryTemplate = {
  code: "trade",
  name: "Thương mại – phân phối",
  extLabel: "Cửa hàng",
  payload: {
    extKey: "store",
    extSamples: ["Cửa hàng Quận 1", "Cửa hàng Thủ Đức"],
    items: [
      { code: "HH001", name: "Máy bơm nước", uom: "cái", cost: 700000, price: 1000000, kind: "goods" },
      { code: "DV001", name: "Dịch vụ lắp đặt", uom: "lần", cost: 0, price: 500000, kind: "service" },
    ],
    accounts: [{ code: "111", name: "Tiền mặt" }],
  },
};

const DEFAULT_TEMPLATE: IndustryTemplate = {
  code: "default",
  name: "Thương mại – dịch vụ (mặc định)",
  extLabel: null,
  payload: { extKey: null, extSamples: [], items: [], accounts: [] },
};

describe("buildTenantSeed", () => {
  it("luôn tạo kho K1 và chép đủ bộ tài khoản của mẫu", () => {
    const seed = buildTenantSeed(TRADE_TEMPLATE, false);
    expect(seed.warehouses).toEqual([
      { code: "K1", name: "Kho chính" },
      { code: "QC", name: "Kho chờ kiểm" },
    ]);
    expect(seed.accounts).toEqual([{ code: "111", name: "Tiền mặt" }]);
  });

  it("mọi mặt hàng của mẫu đều is_sample = true", () => {
    const seed = buildTenantSeed(TRADE_TEMPLATE, false);
    expect(seed.items).toHaveLength(2);
    for (const it of seed.items) expect(it.isSample).toBe(true);
  });

  it("withSample=false: không có đối tác mẫu, không có tồn đầu", () => {
    const seed = buildTenantSeed(TRADE_TEMPLATE, false);
    expect(seed.partners).toHaveLength(0);
    expect(seed.openingMoves).toHaveLength(0);
  });

  it("withSample=true: 3 đối tác mẫu KH1/KH2/NCC1, tồn đầu 6 cho hàng hoá (không cho dịch vụ)", () => {
    const seed = buildTenantSeed(TRADE_TEMPLATE, true);
    expect(seed.partners.map((p) => p.code)).toEqual(["KH1", "KH2", "NCC1"]);
    expect(seed.openingMoves).toEqual([{ itemCode: "HH001", warehouseCode: "K1", qty: 6, cost: 700000 }]);
  });

  it("mẫu có extKey: sinh đủ đối tượng mở rộng theo extSamples, mã nối số thứ tự", () => {
    const seed = buildTenantSeed(TRADE_TEMPLATE, false);
    expect(seed.extObjects).toEqual([
      { code: "store1", name: "Cửa hàng Quận 1", isSample: true },
      { code: "store2", name: "Cửa hàng Thủ Đức", isSample: true },
    ]);
  });

  it("mẫu default (extKey null): không có đối tượng mở rộng", () => {
    const seed = buildTenantSeed(DEFAULT_TEMPLATE, false);
    expect(seed.extObjects).toHaveLength(0);
  });
});
