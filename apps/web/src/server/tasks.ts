import { AppError, type Role } from "@erp/core";
import type { Member } from "./auth";
import { sql } from "./db";
import { asObj } from "./json";

export type TaskScope = "mine" | "all";
export type TaskRow = {
  id: string;
  role: Role;
  text: string;
  documentId: string | null;
  createdAt: string;
  doc: { docNo: string; docType: string; status: string } | null;
  /** Vai hiện tại được Duyệt/Từ chối việc này: việc CỦA vai mình, chứng từ đang chờ duyệt, ĐÚNG lượt của vai mình, và mình không phải người lập. */
  canAct: boolean;
};

/** Vai xem được "Cả công ty" (người điều hành cần toàn cảnh) — vai khác chỉ thấy việc của mình (03 mục C3). */
export const CAN_SEE_ALL: Role[] = ["admin", "director"];

/** Danh sách việc cần làm (UX-1, 03 mục C3). Mặc định `mine`: CHỈ việc có `tasks.role` = vai đang đăng nhập. `all` chỉ admin/director (vai khác → forbidden);
 * ở chế độ này việc của vai khác luôn `canAct = false` (chỉ đọc, không thao tác hộ). Mỗi việc kèm chứng từ liên quan (số, loại, trạng thái) để bấm mở. */
export async function listTasks(m: Member, scope: TaskScope = "mine"): Promise<TaskRow[]> {
  if (scope === "all" && !CAN_SEE_ALL.includes(m.role)) throw new AppError("forbidden", "Chỉ quản trị viên / giám đốc xem được việc cả công ty");
  const rows = await sql<
    {
      id: string;
      role: Role;
      text: string;
      document_id: string | null;
      created_at: string;
      doc_no: string | null;
      doc_type: string | null;
      status: string | null;
      created_by: string | null;
      meta: unknown;
    }[]
  >`
    select t.id, t.role, t.text, t.document_id, t.created_at, d.doc_no, d.doc_type, d.status, d.created_by, d.meta
    from tasks t
    left join documents d on d.id = t.document_id and d.tenant_id = t.tenant_id
    where t.tenant_id = ${m.tenantId} and not t.done ${scope === "mine" ? sql`and t.role = ${m.role}` : sql``}
    order by t.created_at`;
  return rows.map((r) => {
    const meta = r.meta ? asObj<{ chain?: Role[]; approvals?: unknown[] }>(r.meta) : {};
    const turn = meta.chain?.[(meta.approvals ?? []).length];
    return {
      id: r.id,
      role: r.role,
      text: r.text,
      documentId: r.document_id,
      createdAt: new Date(r.created_at).toISOString(),
      doc: r.doc_no ? { docNo: r.doc_no, docType: r.doc_type as string, status: r.status as string } : null,
      canAct: r.role === m.role && r.status === "pending" && turn === m.role && r.created_by !== m.userId,
    };
  });
}
