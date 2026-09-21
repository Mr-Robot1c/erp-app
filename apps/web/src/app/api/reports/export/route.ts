import { AppError, exportReportSchema, type Role } from "@erp/core";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireMember } from "@/server/auth";
import { buildReport } from "@/server/export";

export const runtime = "nodejs";

const ROLES: Role[] = ["admin", "director", "accountant", "chief_accountant"];
const errStatus = (code: string) => (code === "unauthenticated" ? 401 : code === "forbidden" ? 403 : 200);

/** Xuất Excel (lô 4.4): trả tệp .xlsx; lỗi trả JSON `{ok:false,error}` như mọi API khác. */
export async function POST(req: Request) {
  try {
    const m = await requireMember(ROLES, req);
    const body = exportReportSchema.parse(await req.json());
    const period = body.period ?? new Date().toISOString().slice(0, 7);
    const buf = await buildReport(m.tenantId, body.report, period);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="bao-cao-${body.report}-${period}.xlsx"`,
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: errStatus(e.code) });
    if (e instanceof ZodError) return NextResponse.json({ ok: false, error: { code: "invalid_argument", message: e.issues.map((i) => i.message).join("; ") } });
    console.error(e);
    return NextResponse.json({ ok: false, error: { code: "internal", message: "Lỗi hệ thống" } });
  }
}
