import { AppError, canView } from "@erp/core";
import { z } from "zod";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";

const bodySchema = z.object({
  conversation_id: z.string().max(64).optional(),
  message: z.string().trim().min(1).max(4000),
  page_context: z.object({ page_type: z.literal("sales_order_detail"), module: z.literal("sales"), record_id: z.string().regex(/^[A-Za-zÀ-ỹĐđ0-9_-]{1,40}$/) }),
});

export const POST = handle(async (req) => {
  const member = await requireMember(undefined, req);
  if (!canView(member.role, "sales")) throw new AppError("forbidden");
  const input = bodySchema.parse(await req.json());
  const base = process.env.CHATBOT_BACKEND_URL ?? "http://127.0.0.1:8000";
  const secret = process.env.ERP_CHATBOT_SHARED_SECRET ?? process.env.JOB_TOKEN;
  if (!secret) throw new AppError("internal", "ERP chatbot bridge is not configured");
  const response = await fetch(`${base}/api/internal/chat`, { method: "POST", headers: { "content-type": "application/json", "x-erp-chat-secret": secret }, body: JSON.stringify({ ...input, staff_user_id: member.userId, tenant_id: member.tenantId, staff_role: member.role }), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new AppError(response.status === 403 ? "forbidden" : "internal", "AI backend unavailable");
  return data;
});
