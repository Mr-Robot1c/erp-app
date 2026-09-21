import { redirect } from "next/navigation";
import { requireMember } from "@/server/auth";
import { createClient } from "@/server/supabase";
import { CAN_SEE_ALL, listTasks } from "@/server/tasks";
import { TasksBoard } from "@/components/tasks-board";
import type { DocRow } from "@/components/doc-detail";
import { DOC_COLUMNS } from "@/lib/doc-columns";

/** Việc cần làm (UX-1, 03 mục C3): mặc định CHỈ việc của vai đang đăng nhập; `?scope=all` (admin/giám đốc) cho toàn cảnh. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("memberships").select("role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  const m = await requireMember();
  const canSeeAll = CAN_SEE_ALL.includes(m.role);
  const scope = canSeeAll && params.scope === "all" ? "all" : "mine";
  const [tasks, mine] = await Promise.all([listTasks(m, scope), scope === "all" ? listTasks(m, "mine") : null]);
  const myCount = mine ? mine.length : tasks.length;

  const docIds = [...new Set(tasks.map((t) => t.documentId).filter((x): x is string => !!x))];
  const [{ data: docs }, { data: partners }, { data: items }] = await Promise.all([
    docIds.length ? supabase.from("documents").select(DOC_COLUMNS).in("id", docIds) : Promise.resolve({ data: [] as unknown[] }),
    supabase.from("partners").select("id, name"),
    supabase.from("items").select("id, name"),
  ]);

  return (
    <TasksBoard
      tasks={tasks}
      myRole={m.role}
      userId={user.id}
      scope={scope}
      canSeeAll={canSeeAll}
      myCount={myCount}
      allCount={scope === "all" ? tasks.length : null}
      docs={(docs ?? []) as unknown as DocRow[]}
      partners={(partners ?? []) as { id: string; name: string }[]}
      items={(items ?? []) as { id: string; name: string }[]}
    />
  );
}
