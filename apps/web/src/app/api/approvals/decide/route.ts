import { approvalDecisionSchema } from "@erp/core";
import { handle } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { decideApproval } from "@/server/approvals";

export const POST = handle(async (req: Request) => {
  const m = await requireMember(undefined, req);
  const body = approvalDecisionSchema.parse(await req.json());

  return tx((s) => decideApproval(s, m, body.docId, body.decision, body.reason));
});
