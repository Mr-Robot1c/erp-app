import { redirect } from "next/navigation";
import type { Role } from "@erp/core";
import { createClient } from "@/server/supabase";
import { TasksBoard } from "@/components/tasks-board";

export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("memberships").select("role").maybeSingle();
  if (!membership) redirect("/onboarding");

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, role, text, document_id, created_at")
    .eq("done", false)
    .order("created_at");

  return <TasksBoard tasks={tasks ?? []} myRole={membership.role as Role} />;
}
