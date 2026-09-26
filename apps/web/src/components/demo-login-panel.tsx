"use client";

const DEMO_PASSWORD = "123123";

type DemoAccount = {
  email: string;
  initials: string;
  roleName: string;
  description: string;
};

const DEMO_GROUPS: { id: string; title: string; accounts: DemoAccount[] }[] = [
  {
    id: "operations",
    title: "Điều hành",
    accounts: [
      { email: "admin@demo.vn", initials: "QT", roleName: "Quản trị viên", description: "Cấu hình hệ thống." },
      { email: "giamdoc@demo.vn", initials: "GĐ", roleName: "Giám đốc", description: "Soi số toàn công ty." },
    ],
  },
  {
    id: "sales-stock",
    title: "Kinh doanh & Kho",
    accounts: [
      { email: "tkd@demo.vn", initials: "TK", roleName: "Trưởng KD", description: "Duyệt báo giá." },
      { email: "tbp@demo.vn", initials: "TB", roleName: "Trưởng bộ phận", description: "Duyệt đơn mua." },
      { email: "kd@demo.vn", initials: "KD", roleName: "NV KD", description: "Lập báo giá." },
      { email: "mua@demo.vn", initials: "MH", roleName: "NV Mua", description: "Lập đơn mua." },
      { email: "kho@demo.vn", initials: "KH", roleName: "Thủ kho", description: "Nhập và xuất kho." },
    ],
  },
  {
    id: "accounting",
    title: "Kế toán",
    accounts: [
      { email: "ktt@demo.vn", initials: "KT", roleName: "Kế toán trưởng", description: "Xem sổ cái, khoá kỳ." },
      { email: "kt@demo.vn", initials: "KV", roleName: "Kế toán", description: "Ghi hoá đơn, thu chi." },
    ],
  },
];

export function DemoLoginPanel({ busy, onLogin }: { busy: boolean; onLogin: (email: string, password: string) => void }) {
  return (
    <aside
      id="demo-accounts"
      className="order-2 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-4 shadow-sm md:order-1 md:w-[22rem] md:shrink-0"
    >
      <h2 className="text-base font-semibold">Đăng nhập nhanh</h2>
      <p className="mt-1 text-xs text-[var(--ink2)]">
        Đây là bản demo — mật khẩu chung <span className="font-mono">{DEMO_PASSWORD}</span>.
      </p>
      <div className="mt-4 space-y-4">
        {DEMO_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`demo-${group.id}`}>
            <h3 id={`demo-${group.id}`} className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--ink2)] uppercase">
              {group.title}
            </h3>
            <div className="space-y-2">
              {group.accounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={busy}
                  aria-label={`Đăng nhập nhanh ${account.roleName}`}
                  onClick={() => onLogin(account.email, DEMO_PASSWORD)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-[var(--r)] border border-[var(--line)] p-2 text-left hover:border-[var(--acc)] hover:bg-[var(--lane)] disabled:opacity-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accs)] text-xs font-semibold text-[var(--acc)]">
                    {account.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{account.roleName}</span>
                    <span className="block truncate text-xs text-[var(--ink2)]">{account.description}</span>
                    <span className="block font-mono text-[11px] text-[var(--acc)]">{account.email}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
