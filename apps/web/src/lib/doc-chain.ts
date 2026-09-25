import { DOC_LABEL, type DocStatus, type DocType } from "@erp/core";

/** Thứ tự chuỗi chứng từ (UI-3 3.5): bán BG→ĐB→PX→HĐ→PT, rồi mua YM→ĐM→PN→HĐM→PC; loại khác xếp cuối. */
export const CHAIN_ORDER: DocType[] = ["QUOTE", "SO", "DO", "INV", "RCPT", "PR", "PO", "GRN", "VINV", "PAY"];

export type ChainDoc = { doc_no: string; doc_type: DocType; status: DocStatus; refs: string[] };
export type ChainNode = { docNo: string; docType: DocType | null; status: DocStatus | null; current: boolean };

/** Suy loại từ tiền tố số chứng từ (BG-…, ĐB-…, HĐM-… — khớp tiền tố DÀI nhất) khi chứng từ chưa tải được. */
export function typeOfNo(docNo: string): DocType | null {
  let best: DocType | null = null;
  let len = 0;
  for (const [t, l] of Object.entries(DOC_LABEL) as [DocType, { prefix: string }][]) {
    if (docNo.startsWith(l.prefix + "-") && l.prefix.length > len) {
      best = t;
      len = l.prefix.length;
    }
  }
  return best;
}

/** Dựng chuỗi từ CHÍNH refs sẵn có (không thêm API): đi theo refs của chứng từ đang xem và của các chứng từ đã tải (`lookup`), tối đa 12 mắt. */
export function buildChain(current: ChainDoc, lookup: (docNo: string) => ChainDoc | undefined): ChainNode[] {
  const seen = new Map<string, ChainNode>();
  const queue: string[] = [current.doc_no];
  const docOf = (no: string) => (no === current.doc_no ? current : lookup(no));
  while (queue.length && seen.size < 12) {
    const no = queue.shift() as string;
    if (seen.has(no)) continue;
    const d = docOf(no);
    seen.set(no, { docNo: no, docType: d?.doc_type ?? typeOfNo(no), status: d?.status ?? null, current: no === current.doc_no });
    for (const r of d?.refs ?? []) if (!seen.has(r)) queue.push(r);
  }
  const rank = (n: ChainNode) => {
    const i = n.docType ? CHAIN_ORDER.indexOf(n.docType) : -1;
    return i === -1 ? CHAIN_ORDER.length : i;
  };
  return [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.docNo.localeCompare(b.docNo));
}
