import { setStatusSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { setStatus } from "@/server/documents";

/** Khung chứng từ chung — chỉ dùng nội bộ để test khung (lô 0.3). */
export const POST = handle(async (req: Request) => {
  const m = await requireMember(["admin"], req);
  const body = setStatusSchema.parse(await req.json());

  return tx((s) => setStatus(s, m, body.docId, body.to, body.note ?? ""));
});
