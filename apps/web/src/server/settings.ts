import type { TransactionSql } from "postgres";
import type { SettingsInput } from "@erp/core";
import type { Member } from "./auth";
import { audit } from "./db";

/** Đổi 4 ngưỡng duyệt (lô 1.4) — CHỈ đè 4 field này, giữ nguyên `settings.accounting` và mọi key
 * khác đã có. Chuỗi duyệt đang đi KHÔNG đổi vì đã snapshot vào meta.chain lúc tạo (AC-05) — hàm
 * này chỉ ảnh hưởng đề xuất tạo SAU thời điểm đổi. */
export async function updateSettings(s: TransactionSql, m: Member, input: SettingsInput) {
  const [updated] = await s`
    update tenants
    set settings = settings || ${s.json(input as never)}
    where id = ${m.tenantId}
    returning settings`;

  await audit(s, m.tenantId, m.displayName || m.userId, "tenant.settings", "", JSON.stringify(input));
  return updated.settings;
}
