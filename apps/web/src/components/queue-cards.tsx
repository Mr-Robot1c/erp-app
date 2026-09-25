import Link from "next/link";
import { canView, type Role, type View } from "@erp/core";
import type { Queues } from "@/server/queues";

type GroupKey = "sales" | "warehouse" | "accounting";
type Row = { label: string; n: number; href: string; view: View };
type Group = { key: GroupKey; title: string; tone: "ok" | "warn" | "acc"; rows: Row[] };

const BG = { ok: "var(--oks)", warn: "var(--warns)", acc: "var(--accs)" } as const;
const FG = { ok: "var(--ok)", warn: "var(--warn)", acc: "var(--acc)" } as const;

/** Thẻ việc theo bộ phận (03 mục C2): nền nhạt ngữ nghĩa + viền cùng tông, TỔNG to góc phải, 3 dòng `nhãn: số`. Cả thẻ lẫn từng dòng
 * bấm được → màn tương ứng với tab + pill lọc sẵn (query `tab`, `status`). Vai không xem được màn đích, hoặc staff (chỉ-đọc), thì dòng không có link. */
function build(q: Queues): Group[] {
  return [
    {
      key: "sales",
      title: "Cần kinh doanh xử lý",
      tone: "ok",
      rows: [
        { label: "Báo giá chờ duyệt", n: q.sales.quotePending, href: "/app/sales?tab=QUOTE&status=pending", view: "sales" },
        { label: "Đơn chưa xác nhận", n: q.sales.soDraft, href: "/app/sales?tab=SO&status=draft", view: "sales" },
        { label: "Đơn chờ duyệt", n: q.sales.soPending, href: "/app/sales?tab=SO&status=pending", view: "sales" },
      ],
    },
    {
      key: "warehouse",
      title: "Cần kho xử lý",
      tone: "warn",
      rows: [
        { label: "Chờ xuất kho", n: q.warehouse.toShip, href: "/app/sales?tab=SO&status=confirmed,partial", view: "sales" },
        { label: "Chờ nhận hàng", n: q.warehouse.toReceive, href: "/app/buy?tab=PO&status=confirmed,partial", view: "buy" },
        { label: "Chờ kiểm QC", n: q.warehouse.qcItems, href: "/app/stock", view: "stock" },
      ],
    },
    {
      key: "accounting",
      title: "Cần kế toán xử lý",
      tone: "acc",
      rows: [
        { label: "Hoá đơn chờ phát hành", n: q.accounting.invDraft, href: "/app/sales?tab=INV&status=draft", view: "sales" },
        { label: "Thu chờ khớp tay", n: q.accounting.unmatched, href: "/app/acc#cho-khop", view: "acc" },
        { label: "Chi chờ duyệt", n: q.accounting.payPending, href: "/app/buy?tab=PAY&status=pending", view: "buy" },
      ],
    },
  ];
}

const HOME: Partial<Record<Role, GroupKey>> = {
  sales: "sales",
  sales_lead: "sales",
  warehouse: "warehouse",
  purchasing: "warehouse",
  accountant: "accounting",
  chief_accountant: "accounting",
};

export function QueueCards({ queues, role, only }: { queues: Queues; role: Role; only?: GroupKey[] }) {
  let groups = build(queues);
  if (only) groups = groups.filter((g) => only.includes(g.key));
  const mine = HOME[role];
  groups = [...groups].sort((a, b) => Number(b.key === mine) - Number(a.key === mine)); // thẻ của vai mình đứng đầu
  const readOnly = role === "staff";
  const linkable = (r: Row) => !readOnly && canView(role, r.view);

  return (
    <div className={`grid gap-3 ${groups.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} id="queue-cards">
      {groups.map((g) => {
        const total = g.rows.reduce((a, r) => a + r.n, 0);
        const head = g.rows.find((r) => r.n > 0 && linkable(r)) ?? g.rows.find(linkable);
        const dot = <span className="inline-block h-2 w-2 rounded-full" style={{ background: FG[g.tone] }} />;
        return (
          <div key={g.key} data-queue={g.key} className="rounded-[var(--r)] border p-3" style={{ background: BG[g.tone], borderColor: FG[g.tone], color: FG[g.tone] }}>
            <div className="flex items-start justify-between gap-2">
              {head ? (
                <Link href={head.href} className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                  {dot}
                  {g.title}
                </Link>
              ) : (
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                  {dot}
                  {g.title}
                </span>
              )}
              <span className="text-[22px] leading-none font-semibold tabular-nums" data-total>
                {total}
              </span>
            </div>
            <ul className="mt-2 text-[13px] text-[var(--ink)]">
              {g.rows.map((r) => {
                const inner = (
                  <>
                    <span>{r.label}</span>
                    <span className="font-mono tabular-nums" data-n>
                      {r.n}
                    </span>
                  </>
                );
                const cls = "flex items-center justify-between rounded px-1 py-0.5";
                return (
                  <li key={r.label} data-row={r.label}>
                    {linkable(r) ? (
                      <Link href={r.href} className={`${cls} hover:bg-[var(--sf)]`}>
                        {inner}
                      </Link>
                    ) : (
                      <div className={cls}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
