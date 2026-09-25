import { describe, expect, it } from "vitest";
import { csvFileName, toCsv } from "./csv";

describe("toCsv", () => {
  it("có BOM UTF-8, CRLF, bọc ngoặc kép khi có dấu phẩy/nháy/xuống dòng, giữ tiếng Việt", () => {
    const out = toCsv([["Số", "Khách hàng"], ["BG-0001", 'Công ty "Á, Đông"'], ["BG-0002", "Anh Bình\n(lẻ)"]]);
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out).toBe('\uFEFFSố,Khách hàng\r\nBG-0001,"Công ty ""Á, Đông"""\r\nBG-0002,"Anh Bình\n(lẻ)"\r\n');
  });
});

describe("csvFileName", () => {
  it("bỏ dấu tiếng Việt: <loại>-<ngày>.csv", () => {
    expect(csvFileName("Báo giá", "2026-09-25")).toBe("bao-gia-2026-09-25.csv");
    expect(csvFileName("Phiếu xuất", "2026-09-25")).toBe("phieu-xuat-2026-09-25.csv");
    expect(csvFileName("Đơn bán", "2026-09-25")).toBe("don-ban-2026-09-25.csv");
  });
});
