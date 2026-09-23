"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLE_LABEL, canView, type Role, type View } from "@erp/core";
import { SignOutButton } from "./sign-out-button";
import { AIChatContextProvider } from "./ai-chat-context";
import { AIChatWidget } from "./ai-chat-widget";

type NavItem = {
  view: View | "team";
  label: string;
  href: string;
  built: boolean;
  note?: string;
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
      { view: "dash", label: "Tổng quan", href: "/app", built: true },
      { view: "tasks", label: "Việc cần làm", href: "/app/tasks", built: true },
    ],
  },
  {
    label: "NGHIỆP VỤ",
    items: [
      { view: "sales", label: "Bán hàng", href: "/app/sales", built: true },
      { view: "buy", label: "Mua hàng", href: "/app/buy", built: true },
      { view: "stock", label: "Kho", href: "/app/stock", built: true },
      { view: "acc", label: "Kế toán", href: "/app/acc", built: true },
      { view: "int", label: "Nội bộ", href: "/app/int", built: false, note: "lô 5.1" },
    ],
  },
  {
    label: "QUẢN TRỊ",
    items: [
      { view: "master", label: "Danh mục", href: "/app/master", built: true },
      { view: "team", label: "Thành viên", href: "/app/team", built: true },
      { view: "set", label: "Cài đặt", href: "/app/settings", built: true },
      { view: "audit", label: "Nhật ký", href: "/app/audit", built: false },
    ],
  },
];

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

  return (
    <AIChatContextProvider>
    <div
      className={`${fontClassName} grid min-h-screen grid-cols-[220px_1fr] bg-[var(--bg)] text-[var(--ink)] max-[760px]:grid-cols-1`}
    >
      <aside className="flex flex-col gap-0.5 bg-[var(--side)] p-2.5 text-[var(--side-ink)] max-[760px]:flex-row max-[760px]:flex-wrap">
        <div className="px-2.5 pt-1.5 pb-3 text-[15px] font-bold max-[760px]:w-full">
          ERP
          <small className="mt-0.5 block text-[11px] font-normal opacity-70">{tenantName}</small>
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
                    className={`flex items-center justify-between rounded-[var(--r)] border-l-[3px] px-2.5 py-2 text-[13.5px] ${
                      pathname === item.href
                        ? "border-[var(--acc)] bg-[var(--side-on)] font-semibold text-white"
                        : "border-transparent hover:bg-[var(--side-on)]"
                    }`}
                  >
                    {item.label}
                    {item.view === "tasks" && taskCount > 0 && (
                      <span id="task-badge" className="ml-2 min-w-5 rounded-full bg-[var(--acc)] px-1.5 text-center text-[11px] font-semibold text-white tabular-nums">
                        {taskCount}
                      </span>
                    )}
                  </Link>
                ) : (
                  <div
                    key={item.href}
                    className="flex items-center justify-between rounded-[var(--r)] px-2.5 py-2 text-[13.5px] opacity-40"
                  >
                    {item.label}
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
          <span id="tenant-title" className="font-semibold">
            {tenantName}
          </span>
          <span className="flex-1" />
          <span className="text-sm text-[var(--ink2)]">
            {displayName} · <b id="user-role" className="font-medium text-[var(--ink)]">{ROLE_LABEL[role]}</b>
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
