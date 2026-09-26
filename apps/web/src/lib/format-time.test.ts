import { describe, expect, it } from "vitest";
import { isStaleTask, relTime } from "./format-time";

const NOW = new Date("2026-09-25T12:00:00").getTime();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("relTime", () => {
  it("dưới 1 phút / phút / giờ / quá 24 giờ thì dd/MM/yyyy", () => {
    expect(relTime(ago(0), NOW)).toBe("vừa xong");
    expect(relTime(ago(12), NOW)).toBe("12 phút trước");
    expect(relTime(ago(59), NOW)).toBe("59 phút trước");
    expect(relTime(ago(60), NOW)).toBe("1 giờ trước");
    expect(relTime(ago(23 * 60 + 59), NOW)).toBe("23 giờ trước");
    expect(relTime(ago(24 * 60 + 1), NOW)).toBe("24/09/2026");
  });
});

describe("isStaleTask", () => {
  it("chỉ quá 16 giờ mới là chờ lâu", () => {
    expect(isStaleTask(ago(16 * 60 - 1), NOW)).toBe(false);
    expect(isStaleTask(ago(16 * 60 + 1), NOW)).toBe(true);
  });
});
