import { describe, expect, it } from "vitest";
import { buildChain, typeOfNo, type ChainDoc } from "./doc-chain";

const d = (doc_no: string, doc_type: ChainDoc["doc_type"], refs: string[] = []): ChainDoc => ({ doc_no, doc_type, status: "done", refs });

describe("typeOfNo", () => {
  it("khớp tiền tố dài nhất (HĐM là hoá đơn mua, không phải HĐ)", () => {
    expect(typeOfNo("HĐM-0001")).toBe("VINV");
    expect(typeOfNo("HĐ-0001")).toBe("INV");
    expect(typeOfNo("ĐB-0003")).toBe("SO");
    expect(typeOfNo("XYZ-1")).toBeNull();
  });
});

describe("buildChain", () => {
  const docs = [d("BG-0001", "QUOTE", ["ĐB-0001"]), d("ĐB-0001", "SO", ["BG-0001", "PX-0001", "HĐ-0001"]), d("PX-0001", "DO", ["ĐB-0001"]), d("HĐ-0001", "INV", ["ĐB-0001", "PT-0001"]), d("PT-0001", "RCPT", ["HĐ-0001"])];
  const lookup = (no: string) => docs.find((x) => x.doc_no === no);

  it("từ 1 mắt bất kỳ dựng đủ chuỗi BG→ĐB→PX→HĐ→PT đúng thứ tự, đánh dấu mắt đang xem", () => {
    for (const start of docs) {
      const chain = buildChain(start, lookup);
      expect(chain.map((n) => n.docNo)).toEqual(["BG-0001", "ĐB-0001", "PX-0001", "HĐ-0001", "PT-0001"]);
      expect(chain.filter((n) => n.current).map((n) => n.docNo)).toEqual([start.doc_no]);
    }
  });

  it("ref chưa tải được vẫn thành mắt (suy loại từ tiền tố, không trạng thái); chứng từ không ref -> 1 mắt", () => {
    const chain = buildChain(d("ĐB-0009", "SO", ["YM-0002"]), () => undefined);
    expect(chain).toEqual([
      { docNo: "ĐB-0009", docType: "SO", status: "done", current: true },
      { docNo: "YM-0002", docType: "PR", status: null, current: false },
    ]);
    expect(buildChain(d("BG-5", "QUOTE"), () => undefined)).toHaveLength(1);
  });
});
