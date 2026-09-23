import { z } from "zod";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { getKpis } from "@/server/reports";

const bodySchema = z.object({ ym: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

// CB-1.7b: bọc getKpis() thành API để trang Tổng quan lấy qua client fetch (cache 30s), giống
// /api/dashboard/queues (lô 3.6) — đọc-đếm thuần, mọi vai trong tenant xem được.
export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  const { ym } = bodySchema.parse(await req.json());
  return getKpis(m.tenantId, ym);
});
