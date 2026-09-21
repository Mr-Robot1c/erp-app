import { z } from "zod";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { listTasks } from "@/server/tasks";

const schema = z.object({ scope: z.enum(["mine", "all"]).optional() });

/** Việc cần làm của tôi (mặc định) hoặc cả công ty (admin/giám đốc) — xem `server/tasks.ts`. Đọc thuần, mọi vai trong tenant gọi được cho việc CỦA MÌNH. */
export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  const body = schema.parse(await req.json().catch(() => ({})));
  return listTasks(m, body.scope ?? "mine");
});
