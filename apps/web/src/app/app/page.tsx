import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto mt-16 w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">ERP</h1>
      <p className="mt-2 text-sm">
        Đã đăng nhập: <b id="user-email">{user.email}</b>
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Lô 0.1 — khung dự án. Doanh nghiệp, vai và nghiệp vụ vào từ lô 0.2.
      </p>
      <div className="mt-4">
        <SignOutButton />
      </div>
    </main>
  );
}
