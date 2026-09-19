"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      id="btn-signout"
      className="rounded-[var(--r)] border border-zinc-300 px-3 py-2 text-sm"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Đăng xuất
    </button>
  );
}
