import { timingSafeEqual } from "node:crypto";
import { AppError } from "@erp/core";
import { z } from "zod";
import { handle } from "@/server/api";
import { getSalesOrderStatusForStaff } from "@/server/ai-read";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  staff_user_id: z.string().uuid(),
  record_id: z.string().regex(/^[A-Za-zÀ-ỹĐđ0-9_-]{1,40}$/),
});

function validBridgeSecret(req: Request): boolean {
  const expected = process.env.ERP_CHATBOT_SHARED_SECRET ?? process.env.JOB_TOKEN;
  const supplied = req.headers.get("x-erp-chat-secret") ?? "";
  if (!expected || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export const POST = handle(async (req) => {
  if (!validBridgeSecret(req)) throw new AppError("unauthenticated", "Unauthenticated");
  const input = bodySchema.parse(await req.json());
  return getSalesOrderStatusForStaff(input.tenant_id, input.staff_user_id, input.record_id);
});
