import { createDocumentSchema } from "@erp/core";
import { handle, withIdempotency } from "@/server/api";
import { requireMember } from "@/server/auth";
import { tx } from "@/server/db";
import { createDocument } from "@/server/documents";

/** Khung chứng từ chung — chỉ dùng nội bộ để test khung (lô 0.3); mỗi loại chứng từ có
 * endpoint nghiệp vụ riêng từ GĐ2 trở đi (validate/luật riêng theo AC). */
export const POST = handle(
  async (req: Request) => {
    const m = await requireMember(["admin"], req);
    const body = createDocumentSchema.parse(await req.json());
    const key = req.headers.get("idempotency-key");

    return tx((s) => withIdempotency(s, m.tenantId, key, "docs.create", body, () => createDocument(s, m, body)));
  },
  { idempotency: "required" },
);
