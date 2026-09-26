const DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

type DateInput = Date | string | number;

function dateParts(value: DateInput, withTime: boolean): Record<string, string> | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** Ngày dành cho người đọc. Dữ liệu máy/input date vẫn giữ ISO yyyy-MM-dd. */
export function formatDate(value: DateInput): string {
  const p = dateParts(value, false);
  return p ? `${p.day}/${p.month}/${p.year}` : "—";
}

/** Ngày giờ dành cho lịch sử/audit, cố định theo giờ Việt Nam để SSR và browser không lệch nhau. */
export function formatDateTime(value: DateInput): string {
  const p = dateParts(value, true);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : "—";
}
