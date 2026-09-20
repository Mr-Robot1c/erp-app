import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { getQueues } from "@/server/queues";

// Đọc-đếm thuần (không ghi) nên không cần idempotency; mọi vai đã đăng nhập trong tenant đều xem được (staff xem chỉ-đọc).
export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  return getQueues(m.tenantId);
});
