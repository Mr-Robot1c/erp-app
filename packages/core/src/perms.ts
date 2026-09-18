import type { Role } from "./labels";

/** Màn hình — chép từ demo/ui.js (nav()). */
export const VIEWS = [
  "dash",
  "tasks",
  "sales",
  "buy",
  "stock",
  "acc",
  "int",
  "ext",
  "master",
  "audit",
  "set",
  "sc",
  "assign",
] as const;
export type View = (typeof VIEWS)[number];

/** Hành động nghiệp vụ — chép từ demo/ui.js PERMS. */
export const ACTIONS = [
  "quote",
  "cq",
  "q2o",
  "cso",
  "cancel",
  "approve",
  "reject",
  "exp",
  "adv",
  "deliver",
  "grn",
  "adj",
  "po",
  "cpo",
  "pr2po",
  "vinv",
  "rcpt",
  "pay",
  "issue",
  "payexp",
  "settle",
  "lock",
  "produce",
] as const;
export type Action = (typeof ACTIONS)[number];

type PermSet = { views: readonly View[]; actions: readonly Action[] };

/** Ma trận quyền — nguồn sự thật MỘT chỗ (02-quyet-dinh, lô 1.2). Chép nguyên PERMS của
 * demo/ui.js, đổi key vai tiếng Việt sang role tiếng Anh (packages/core/src/labels.ts). */
export const PERMS: Record<Role, PermSet> = {
  admin: { views: VIEWS, actions: ACTIONS },
  director: { views: VIEWS, actions: ["approve", "reject"] },
  sales_lead: {
    views: ["dash", "tasks", "sales", "ext", "master", "audit"],
    actions: ["quote", "cq", "q2o", "cso", "cancel", "approve", "reject", "exp", "adv"],
  },
  sales: {
    views: ["dash", "tasks", "sales", "ext", "master"],
    actions: ["quote", "cq", "q2o", "cso", "cancel", "exp", "adv"],
  },
  warehouse: {
    views: ["dash", "tasks", "stock", "sales", "buy"],
    actions: ["deliver", "grn", "adj", "exp", "adv"],
  },
  purchasing: {
    views: ["dash", "tasks", "buy", "stock", "master"],
    actions: ["po", "cpo", "pr2po", "vinv", "cancel", "exp", "adv"],
  },
  dept_lead: {
    views: ["dash", "tasks", "int", "audit"],
    actions: ["approve", "reject", "exp", "adv"],
  },
  accountant: {
    views: ["dash", "tasks", "acc", "sales", "buy", "int", "audit"],
    actions: ["rcpt", "pay", "issue", "payexp", "settle", "approve", "reject", "exp", "adv", "produce"],
  },
  chief_accountant: {
    views: ["dash", "tasks", "acc", "sales", "buy", "int", "audit"],
    actions: ["rcpt", "pay", "issue", "payexp", "settle", "lock", "approve", "reject", "exp", "adv"],
  },
  staff: { views: ["dash", "tasks", "int"], actions: ["exp", "adv"] },
};

/** MỌI endpoint nghiệp vụ từ lô 1.2 trở đi gọi hàm này SAU requireMember() — sai vai -> forbidden. */
export function can(role: Role, action: Action): boolean {
  return role === "admin" || PERMS[role].actions.includes(action);
}

export function canView(role: Role, view: View): boolean {
  return role === "admin" || PERMS[role].views.includes(view);
}
