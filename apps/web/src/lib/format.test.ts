import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";

describe("formatDate", () => {
  it("hiển thị dd/MM/yyyy theo Asia/Ho_Chi_Minh, không lệch ngày", () => {
    expect(formatDate(new Date("2026-09-24T05:00:00Z"))).toBe("24/09/2026");
    expect(formatDate("2026-09-24")).toBe("24/09/2026");
    expect(formatDate("2026-09-24T20:00:00Z")).toBe("25/09/2026");
  });

  it("trả dấu trống chuẩn cho dữ liệu không hợp lệ", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("hiển thị giờ Việt Nam với phút đủ hai chữ số", () => {
    expect(formatDateTime("2026-09-24T20:05:00Z")).toBe("25/09/2026 03:05");
  });
});
