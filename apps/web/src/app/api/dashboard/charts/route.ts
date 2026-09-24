import { z } from "zod";
import { canView } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { getCharts } from "@/server/dashboard-charts";

const bodySchema = z.object({ months: z.union([z.literal(1), z.literal(3), z.literal(6)]).default(3) });

// Đọc thuần. Đếm chứng từ: mọi vai trong tenant. Doanh thu 6 tháng (số tiền): chỉ vai xem được Kế toán, vai khác nhận revenue = null.
export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  const { months } = bodySchema.parse(await req.json());
  return getCharts(m.tenantId, months, canView(m.role, "acc"));
});
