/** Giờ tương đối cho feed/việc: <1 phút "vừa xong", <1 giờ "n phút trước", <24 giờ "n giờ trước", còn lại dd/mm. */
export function relTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return "vừa xong";
  if (min < 60) return `${min} phút trước`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} giờ trước`;
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Mốc "chờ lâu" của việc cần làm: quá 16 giờ (mốc AC-31 sẵn có). Chỉ để hiển thị. */
export const STALE_TASK_HOURS = 16;
export function isStaleTask(iso: string, now: number = Date.now()): boolean {
  return now - new Date(iso).getTime() > STALE_TASK_HOURS * 3_600_000;
}
