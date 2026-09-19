import { AppError, can, cancelDocSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { cancelDocument } from "@/server/cancel";
import { tx } from "@/server/db";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  if (!can(m.role, "cancel")) throw new AppError("forbidden");
  const body = cancelDocSchema.parse(await req.json());
  return tx((s) => cancelDocument(s, m, body.docId));
});
