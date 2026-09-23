"use client";
import { useEffect, useRef, useState } from "react";
import { useAIChatContext } from "./ai-chat-context";

type Msg = { role: "user" | "assistant"; content: string };

// The chat is intentionally plain text. Strip common model-emitted bold markers so
// customers never see raw Markdown while still preserving line breaks and bullets.
function displayText(content: string) { return content.replace(/\*\*/g, ""); }

export function AIChatWidget() {
  const { pageContext } = useAIChatContext();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(suggested?: string) {
    const message = (suggested ?? text).trim();
    if (!message || busy) return;
    setText(""); setBusy(true); setMessages((x) => [...x, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message, page_context: pageContext }) });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body?.error?.code ?? "failed");
      setConversationId(body.data.conversation_id);
      setMessages((x) => [...x, { role: "assistant", content: body.data.message }]);
    } catch (error) {
      const limited = error instanceof Error && error.message.includes("rate_limit");
      setMessages((x) => [...x, { role: "assistant", content: limited ? "Trợ lý AI đang bận, vui lòng thử lại sau ít phút." : "Trợ lý AI đang tạm thời không phản hồi. Vui lòng thử lại." }]);
    } finally { setBusy(false); }
  }

  return <>
    <button aria-label="Mở Trợ lý AI" onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-40 h-11 rounded-full bg-[var(--acc)] px-4 text-sm font-semibold text-white shadow-lg">Trợ lý AI</button>
    {open && <section aria-label="Trợ lý AI" className="fixed top-0 right-0 z-50 flex h-dvh w-[380px] max-w-full flex-col border-l border-[var(--line)] bg-[var(--sf)] shadow-2xl max-[520px]:w-full">
      <header className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3"><div className="flex-1"><h2 className="font-semibold">Trợ lý AI</h2><p className="text-xs text-[var(--ink2)]">{pageContext ? `Đang xem ${pageContext.record_id}` : "Hỏi chung, hoặc mở một đơn bán để hỏi theo đúng đơn đó"}</p></div><button aria-label="Đóng" onClick={() => setOpen(false)} className="rounded px-2 py-1 hover:bg-[var(--lane)]">×</button></header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">{messages.length === 0 && pageContext && <div className="space-y-2">{["Đơn này đang ở trạng thái nào?", "Đơn này tổng bao nhiêu?", "Đơn này gồm những sản phẩm nào?"].map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="block min-h-11 w-full rounded-[var(--r)] border border-[var(--line)] bg-[var(--lane)] px-3 py-2 text-left text-[var(--ink2)] hover:border-[var(--acc)]">{suggestion}</button>)}</div>}{messages.map((m,i)=><div key={i} className={`max-w-[88%] whitespace-pre-wrap rounded-[var(--r)] px-3 py-2 ${m.role === "user" ? "ml-auto bg-[var(--acc)] text-white" : "bg-[var(--lane)]"}`}>{displayText(m.content)}</div>)}{busy && <p className="text-xs text-[var(--ink2)]">Đang kiểm tra dữ liệu…</p>}<div ref={bottom}/></div>
      <footer className="border-t border-[var(--line)] p-3"><div className="flex gap-2"><textarea aria-label="Nội dung hỏi" value={text} onChange={(e)=>setText(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} disabled={busy} rows={2} placeholder="Hỏi Trợ lý AI…" className="min-h-11 flex-1 resize-none rounded-[var(--r)] border border-[var(--line)] bg-white px-3 py-2 outline-none focus:border-[var(--acc)]"/><button onClick={()=>void send()} disabled={!text.trim()||busy} className="rounded-[var(--r)] bg-[var(--acc)] px-4 font-semibold text-white disabled:opacity-40">Gửi</button></div></footer>
    </section>}
  </>;
}
