"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Boxes,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Users,
  Wrench,
  History,
  type LucideIcon,
} from "lucide-react";
import { can, ROLE_LABEL, canView, type Role, type View } from "@erp/core";
import { SignOutButton } from "./sign-out-button";
import { AIChatContextProvider } from "./ai-chat-context";
import { AIChatWidget } from "./ai-chat-widget";
import { GlobalSearch } from "./global-search";
import { useCachedFetch } from "@/lib/use-cached-fetch";
import type { Queues } from "@/server/queues";

type NavItem = {
  view: View | "team";
  label: string;
  href: string;
  built: boolean;
  note?: string;
  icon: LucideIcon;
};
type NavGroup = { label: string; items: NavItem[] };

/** Sidebar 3 nhóm — playbook/03-chuan-giao-dien.md mục B. Mục chưa xây hiện mờ + số lô để
 * user thấy bản đồ tiến độ (lô lấy từ docs/plans/tien-do-web-erp.md); "team" không phải View
 * trong PERMS (packages/core/src/perms.ts) — chỉ admin thấy, lọc riêng bên dưới. "set" (Cài đặt,
 * lô 1.4) CŨNG lọc riêng theo admin dù có trong View: PERMS.director.views hiện là VIEWS đầy đủ
 * (gồm cả set/sc/assign — rộng hơn ALLV của demo/ui.js vốn không có 3 mục này cho director) —
 * trang /app/settings tự chặn non-admin, để canView quyết định hiển thị sẽ ra link cụt cho
 * director; ép admin-only ở đây cho khớp UI-hành vi mà không đụng PERMS chung (quyết định lô 1.2,
 * ngoài phạm vi lô 1.4). */
const ADMIN_ONLY_VIEWS = new Set<NavItem["view"]>(["team", "set"]);
const NAV_GROUPS: NavGroup[] = [
  {
    label: "LÀM VIỆC",
    items: [
      { view: "dash", label: "Tổng quan", href: "/app", built: true, icon: LayoutDashboard },
      { view: "tasks", label: "Việc cần làm", href: "/app/tasks", built: true, icon: ListChecks },
    ],
  },
  {
    label: "NGHIỆP VỤ",
    items: [
      { view: "sales", label: "Bán hàng", href: "/app/sales", built: true, icon: ShoppingBag },
      { view: "buy", label: "Mua hàng", href: "/app/buy", built: true, icon: ShoppingCart },
      { view: "stock", label: "Kho", href: "/app/stock", built: true, icon: Boxes },
      { view: "acc", label: "Kế toán", href: "/app/acc", built: true, icon: BookOpen },
      { view: "int", label: "Nội bộ", href: "/app/int", built: false, icon: Wrench, note: "lô 5.1" },
    ],
  },
  {
    label: "QUẢN TRỊ",
    items: [
      { view: "master", label: "Danh mục", href: "/app/master", built: true, icon: ClipboardList },
      { view: "team", label: "Thành viên", href: "/app/team", built: true, icon: Users },
      { view: "set", label: "Cài đặt", href: "/app/settings", built: true, icon: Settings },
      { view: "audit", label: "Nhật ký", href: "/app/audit", built: false, icon: History },
    ],
  },
];

/** "+" nhanh trên header (03 mục H) — thay hàng nút nhanh dashboard cũ (chưa từng dựng), dùng
 * lại ĐÚNG cổng quyền `can()` mà doc-board.tsx đã dùng cho các nút "+ Lập …" trong màn, nên vai
 * nào bấm được nút gốc mới thấy action tương ứng ở đây. `?new=` do doc-board.tsx tự mở form khi
 * vào trang (không đổi API/route, chỉ thêm 1 query param tự nhận biết). */
const QUICK_ACTIONS: { action: "quote" | "rcpt" | "po" | "pay"; label: string; href: string }[] = [
  { action: "quote", label: "Lập báo giá", href: "/app/sales?new=quote" },
  { action: "rcpt", label: "Thu tiền", href: "/app/sales?new=receipt" },
  { action: "po", label: "Lập đơn mua", href: "/app/buy?new=po" },
  { action: "pay", label: "Trả tiền NCC", href: "/app/buy?new=pay" },
];

async function fetchQueues(): Promise<Queues> {
  const res = await fetch("/api/dashboard/queues", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "Không lấy được số liệu");
  return body.data as Queues;
}

/** Badge đếm theo phân hệ (03 mục I.2) — từ đúng dữ liệu queues (cache 30s dùng chung với thẻ việc), 0 thì ẩn. */
function moduleBadges(q: Queues | undefined): Partial<Record<string, number>> {
  if (!q) return {};
  return {
    sales: q.sales.quotePending + q.sales.soDraft + q.sales.soPending,
    stock: q.warehouse.toShip + q.warehouse.toReceive + q.warehouse.qcItems,
    buy: q.buying.poPending + q.accounting.payPending,
    acc: q.accounting.invDraft + q.accounting.unmatched,
  };
}

const ACC_VIEW_LABEL: Record<string, string> = {
  debt: "Công nợ",
  ledger: "Sổ cái",
  balance: "Số dư tài khoản",
  partner: "Sổ chi tiết đối tác",
  opening: "Số dư đầu kỳ",
  adjust: "Bút toán điều chỉnh",
  period: "Khoá kỳ",
};

function pageTitleFor(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) if (pathname === item.href) return item.label;
  }
  return "ERP";
}

export function AppShell({
  tenantName,
  displayName,
  role,
  fontClassName,
  taskCount = 0,
  children,
}: {
  taskCount?: number;
  tenantName: string;
  displayName: string;
  role: Role;
  fontClassName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: queues } = useCachedFetch("dashboard:queues", fetchQueues);
  const badges = moduleBadges(queues);
  const [quickOpen, setQuickOpen] = useState(false);
  const quickActions = QUICK_ACTIONS.filter((a) => can(role, a.action));

  return (
    <AIChatContextProvider>
    <div
      className={`${fontClassName} grid min-h-screen grid-cols-[220px_1fr] bg-[var(--bg)] text-[var(--ink)] max-[760px]:grid-cols-1`}
    >
      <aside className="flex flex-col gap-0.5 bg-[var(--side)] p-2.5 text-[var(--side-ink)] max-[760px]:flex-row max-[760px]:flex-wrap">
        <div className="px-2.5 pt-1.5 pb-3 text-[15px] font-bold max-[760px]:w-full">
          ERP
          <small id="tenant-title" className="mt-0.5 block text-[11px] font-normal opacity-70">
            {tenantName}
          </small>
        </div>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) =>
            ADMIN_ONLY_VIEWS.has(item.view) ? role === "admin" : canView(role, item.view as View),
          );
          if (!items.length) return null;
          return (
            <div key={group.label} className="mt-1.5 first:mt-0">
              <div className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-wide uppercase opacity-60">
                {group.label}
              </div>
              {items.map((item) =>
                item.built ? (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    className={`flex items-center justify-between rounded-[var(--r)] px-2.5 py-2 text-[13.5px] ${
                      pathname === item.href ? "bg-[var(--side-on)] font-semibold text-white" : "text-[var(--side-ink)] hover:bg-white/10"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <item.icon size={16} strokeWidth={1.75} aria-hidden />
                      {item.label}
                    </span>
                    {(badges[item.view] ?? 0) > 0 && (
                      <span data-module-badge={item.view} className="ml-2 min-w-5 rounded-full bg-[var(--pop)] px-1.5 text-center text-[11px] font-semibold text-white tabular-nums">
                        {badges[item.view]}
                      </span>
                    )}
                    {item.view === "tasks" && taskCount > 0 && (
                      <span id="task-badge" className="ml-2 min-w-5 rounded-full bg-[var(--pop)] px-1.5 text-center text-[11px] font-semibold text-white tabular-nums">
                        {taskCount}
                      </span>
                    )}
                  </Link>
                ) : (
                  <div
                    key={item.href}
                    className="flex items-center justify-between rounded-[var(--r)] px-2.5 py-2 text-[13.5px] opacity-40"
                  >
                    <span className="flex items-center gap-2">
                      <item.icon size={16} strokeWidth={1.75} aria-hidden />
                      {item.label}
                    </span>
                    {item.note && <span className="text-[10.5px]">{item.note}</span>}
                  </div>
                ),
              )}
            </div>
          );
        })}
      </aside>
      <div className="flex flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--sf)] px-5 py-3">
          <nav id="page-title" aria-label="Breadcrumb" className="flex items-center gap-1 font-semibold">
            {pathname === "/app/acc" ? (
              <>
                <span className="font-normal text-[var(--ink2)]">{pageTitleFor(pathname)}</span>
                <ChevronRight size={14} className="text-[var(--ink2)]" aria-hidden />
                <span>{ACC_VIEW_LABEL[searchParams.get("view") ?? "debt"] ?? ACC_VIEW_LABEL.debt}</span>
              </>
            ) : (
              pageTitleFor(pathname)
            )}
          </nav>
          <div className="flex flex-1 justify-center">
            <GlobalSearch />
          </div>

          {quickActions.length > 0 && (
            <div className="relative">
              <button
                id="btn-quick-actions"
                type="button"
                aria-label="Hành động nhanh"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--pop)] text-lg leading-none text-white"
                onClick={() => setQuickOpen((v) => !v)}
              >
                +
              </button>
              {quickOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setQuickOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1.5 w-48 rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] py-1 shadow-lg">
                    {quickActions.map((a) => (
                      <Link
                        key={a.href}
                        href={a.href}
                        className="block px-3 py-1.5 text-sm hover:bg-[var(--lane)]"
                        onClick={() => setQuickOpen(false)}
                      >
                        {a.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <Link
            href="/app/tasks"
            aria-label="Việc cần làm"
            className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink2)]"
          >
            🔔
            {taskCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-[var(--bad)] px-1 text-center text-[10px] font-semibold text-white tabular-nums">
                {taskCount}
              </span>
            )}
          </Link>

          <span className="flex items-center gap-2 rounded-full border border-[var(--line)] py-1 pr-3 pl-1 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accs)] text-[11px] font-semibold text-[var(--acc)]">
              {(displayName || "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="leading-tight">
              {displayName}
              <b id="user-role" className="block text-[11px] font-medium text-[var(--ink2)]">
                {ROLE_LABEL[role]}
              </b>
            </span>
          </span>
          <SignOutButton />
        </header>
        <main className="flex-1 px-5 py-6">{children}</main>
      </div>
      <AIChatWidget />
    </div>
    </AIChatContextProvider>
  );
}
