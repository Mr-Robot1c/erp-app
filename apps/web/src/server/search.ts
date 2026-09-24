import { sql } from "./db";

export type SearchHit = {
  id: string;
  docNo: string;
  docType: string;
  status: string;
  deliveredAll: boolean;
  partnerName: string | null;
};

/** Tìm chứng từ toàn cục (UI-2 I.3): số chứng từ HOẶC tên đối tác chứa `q`, CHỈ trong tenant của người gọi
 * (kết nối server quyền cao bỏ qua RLS nên `tenant_id` lọc tường minh ở cả 2 bảng — có test isolation). ≤ 8 dòng. */
export async function searchDocuments(tenantId: string, q: string): Promise<SearchHit[]> {
  const term = q.trim().slice(0, 60);
  if (!term) return [];
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await sql<
    { id: string; doc_no: string; doc_type: string; status: string; delivered_all: string | null; partner_name: string | null }[]
  >`
    select d.id, d.doc_no, d.doc_type, d.status, d.meta->>'deliveredAll' as delivered_all, p.name as partner_name
    from documents d
    left join partners p on p.tenant_id = d.tenant_id and p.id = d.partner_id
    where d.tenant_id = ${tenantId}
      and (d.doc_no ilike ${pattern} or p.name ilike ${pattern})
    order by d.created_at desc
    limit 8`;
  return rows.map((r) => ({
    id: r.id,
    docNo: r.doc_no,
    docType: r.doc_type,
    status: r.status,
    deliveredAll: r.delivered_all === "true",
    partnerName: r.partner_name,
  }));
}
