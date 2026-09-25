/** CSV cho Excel (UI-3 3.6): BOM UTF-8 để tiếng Việt không vỡ, CRLF, bọc ngoặc kép khi có dấu phẩy/nháy/xuống dòng. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Tên tệp không dấu: "Báo giá" + 2026-09-25 -> "bao-gia-2026-09-25.csv". */
export function csvFileName(label: string, date: string): string {
  const slug = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "chung-tu"}-${date}.csv`;
}

export function downloadCsv(fileName: string, rows: (string | number)[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
