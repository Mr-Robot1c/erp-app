import { describe, expect, it } from "vitest";
import { isBalanced, parseOpeningCsv, postOpeningBalance } from "../src/index";

describe("số dư đầu kỳ (lô 4.2)", () => {
  it("bút toán đầu kỳ cân; chênh lệch vào 411 (Có khi tài sản > nợ, Nợ khi ngược lại)", () => {
    const l = postOpeningBalance({ stockByAccount: { "156": 500 }, receivable: 120, payable: 200, c111: 30, c112: 50 });
    expect(isBalanced(l)).toBe(true);
    expect(l.find((x) => x[0] === "411")).toEqual(["411", 0, 500]);
    const neg = postOpeningBalance({ stockByAccount: {}, receivable: 0, payable: 100, c111: 40, c112: 0 });
    expect(isBalanced(neg)).toBe(true);
    expect(neg.find((x) => x[0] === "411")).toEqual(["411", 60, 0]);
  });

  it("đọc CSV: 4 loại dòng, bỏ tiêu đề / dòng trống / ghi chú #, số có dấu chấm ngăn cách", () => {
    const { data, errors } = parseOpeningCsv(
      ["loai,ma,kho,so_luong,gia_von,so_tien", "# ghi chú", "ton,SP1,K1,10,50.000,", "", "phai_thu,KH1,,,,1.200.000", "phai_tra,NCC1,,,,300000", "tien,111,,,,5000", "tien,112,,,,7000", "tien,111,,,,1000"].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(data.stock).toEqual([{ itemCode: "SP1", warehouseCode: "K1", qty: 10, unitCost: 50_000 }]);
    expect(data.receivables).toEqual([{ partnerCode: "KH1", amount: 1_200_000 }]);
    expect(data.payables).toEqual([{ partnerCode: "NCC1", amount: 300_000 }]);
    expect(data.cash).toEqual({ c111: 6_000, c112: 7_000 });
  });

  it("đọc CSV: báo lỗi kèm số dòng cho loại lạ, số lượng sai, mã tiền sai", () => {
    const { errors } = parseOpeningCsv(["loai,ma,kho,so_luong,gia_von,so_tien", "xyz,A,,,,1", "ton,SP1,K1,0,10,", "tien,113,,,,5", "phai_thu,,,,,5"].join("\n"));
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("Dòng 2");
    expect(errors[1]).toContain("Dòng 3");
    expect(errors[2]).toContain("Dòng 4");
    expect(errors[3]).toContain("Dòng 5");
  });
});
