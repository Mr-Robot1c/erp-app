import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { getActivity } from "@/server/activity";

// Đọc thuần; mọi vai trong tenant xem được feed của tenant mình. "mine" chỉ chứng từ do CHÍNH người gọi lập.
export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  return getActivity(m);
});
