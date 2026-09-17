"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const VI_ERR: Record<string, string> = {
  "Invalid login credentials": "Email hoặc mật khẩu không đúng.",
  "User already registered": "Email này đã đăng ký — bấm Đăng nhập.",
  "Password should be at least 6 characters.": "Mật khẩu tối thiểu 6 ký tự.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(mode: "in" | "up") {
    setBusy(true);
    setMsg("");
    const sb = supabaseBrowser();
    const { error } =
      mode === "in"
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setMsg(VI_ERR[error.message] ?? error.message);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">ERP — đăng nhập</h1>
      <p className="mt-1 text-sm text-zinc-500">Tài khoản email riêng của hệ thống.</p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit("in");
        }}
      >
        <label className="text-sm">
          Email
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Mật khẩu
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <button
          id="btn-signin"
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-50"
        >
          Đăng nhập
        </button>
        <button
          id="btn-signup"
          type="button"
          disabled={busy}
          onClick={() => void submit("up")}
          className="rounded-md border border-zinc-300 px-3 py-2 disabled:opacity-50"
        >
          Đăng ký tài khoản mới
        </button>
      </form>
    </main>
  );
}
