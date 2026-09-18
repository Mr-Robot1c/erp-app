import { AppError, can, expenseSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { createExpense } from "@/server/approvals";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  if (!can(m.role, "exp")) throw new AppError("forbidden");
  const body = expenseSchema.parse(await req.json());

  return tx((s) => createExpense(s, m, body));
});
