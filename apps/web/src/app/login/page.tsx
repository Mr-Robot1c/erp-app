"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { DemoLoginPanel } from "@/components/demo-login-panel";

const VI_ERR: Record<string, string> = {
  "Invalid login credentials": "Email hoặc mật khẩu không đúng.",
  "User already registered": "Email này đã đăng ký — bấm Đăng nhập.",
  "Password should be at least 6 characters.": "Mật khẩu tối thiểu 6 ký tự.",
};

export default function LoginPage() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(mode: "in" | "up", creds?: { email: string; password: string }) {
    setBusy(true);
    setMsg("");
    const sb = supabaseBrowser();
    const c = creds ?? { email, password };
    const { error } =
      mode === "in" ? await sb.auth.signInWithPassword(c) : await sb.auth.signUp(c);
    setBusy(false);
    if (error) {
      setMsg(VI_ERR[error.message] ?? error.message);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <div className={`mx-auto flex w-full flex-col gap-4 px-4 pb-10 ${demoMode ? "mt-10 max-w-5xl md:mt-16 md:flex-row md:items-start" : "mt-24 max-w-sm"}`}>
      {demoMode && (
        <DemoLoginPanel
          busy={busy}
          onLogin={(demoEmail, demoPassword) => {
            setEmail(demoEmail);
            setPassword(demoPassword);
            void submit("in", { email: demoEmail, password: demoPassword });
          }}
        />
      )}
      <main className="order-1 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)] p-6 shadow-sm md:order-2 md:max-w-sm">
      <h1 className="text-xl font-bold">Sổ Việc</h1>
      <p className="mt-1 text-sm text-[var(--ink2)]">Dùng thật, thay sổ tay.</p>
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
            className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] px-3 py-2"
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
            className="mt-1 w-full rounded-[var(--r)] border border-[var(--line)] px-3 py-2"
          />
        </label>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        <button
          id="btn-signin"
          type="submit"
          disabled={busy}
          className="rounded-[var(--r)] bg-[var(--acc-fill)] px-3 py-2 font-medium text-white disabled:opacity-50"
        >
          Đăng nhập
        </button>
        <button
          id="btn-signup"
          type="button"
          disabled={busy}
          onClick={() => void submit("up")}
          className="rounded-[var(--r)] border border-[var(--line)] px-3 py-2 disabled:opacity-50"
        >
          Đăng ký tài khoản mới
        </button>
      </form>
      </main>
    </div>
  );
}
