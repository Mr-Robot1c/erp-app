import { ROLE_LABEL, type Role } from "@erp/core";
import { auditLabel } from "@/lib/audit-labels";
import type { Member } from "./auth";
import { sql } from "./db";
import { asObj } from "./json";

export type ActivityItem = {
  id: string;
  at: string;
  actor: string;
  label: string;
  ref: string;
  doc: { docType: string; status: string; deliveredAll: boolean } | null;
};
export type MyDoc = { docNo: string; docType: string; status: string; deliveredAll: boolean; waitingFor: string | null };
export type Activity = { activity: ActivityItem[]; mine: MyDoc[] };

/** Feed "Hoạt động gần đây" (UI-3 3.1) + "Chứng từ tôi lập đang xử lý" (3.2): 1 round-trip. MỌI truy vấn lọc `tenant_id` tường minh
 * (kết nối server bỏ qua RLS); "mine" thêm `created_by` = người gọi (lấy từ session, không nhận từ client). */
export async function getActivity(m: Member): Promise<Activity> {
  const rows = await sql<
    { id: string; at: string; actor: string; action: string; ref: string; doc_type: string | null; status: string | null; delivered_all: string | null }[]
  >`
    select a.id, a.at, a.actor, a.action, a.ref, d.doc_type, d.status, d.delivered_all
    from audit_log a
    left join lateral (
      select doc_type, status, meta->>'deliveredAll' as delivered_all from documents
      where tenant_id = a.tenant_id and doc_no = a.ref limit 1
    ) d on true
    where a.tenant_id = ${m.tenantId}
    order by a.at desc, a.id desc
    limit 10`;

  const mineRows = await sql<{ doc_no: string; doc_type: string; status: string; meta: unknown }[]>`
    select doc_no, doc_type, status, meta from documents
    where tenant_id = ${m.tenantId} and created_by = ${m.userId} and status in ('draft', 'pending', 'confirmed', 'partial')
    order by created_at desc
    limit 5`;

  return {
    activity: rows.map((r) => ({
      id: String(r.id),
      at: new Date(r.at).toISOString(),
      actor: r.actor,
      label: auditLabel(r.action),
      ref: r.ref,
      doc: r.doc_type ? { docType: r.doc_type, status: r.status as string, deliveredAll: r.delivered_all === "true" } : null,
    })),
    mine: mineRows.map((r) => {
      const meta = asObj<{ chain?: Role[]; approvals?: unknown[]; deliveredAll?: boolean }>(r.meta);
      const turn = r.status === "pending" ? meta.chain?.[(meta.approvals ?? []).length] : undefined;
      return {
        docNo: r.doc_no,
        docType: r.doc_type,
        status: r.status,
        deliveredAll: Boolean(meta.deliveredAll),
        waitingFor: turn ? (ROLE_LABEL[turn] ?? turn) : null,
      };
    }),
  };
}
