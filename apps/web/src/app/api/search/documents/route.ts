import { z } from "zod";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { searchDocuments } from "@/server/search";

const bodySchema = z.object({ q: z.string().min(1).max(60) });

// Đọc thuần; mọi vai trong tenant tìm được (kết quả chỉ trong tenant của người gọi, lấy từ session — không nhận tenantId từ client).
export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  const { q } = bodySchema.parse(await req.json());
  return { hits: await searchDocuments(m.tenantId, q) };
});
