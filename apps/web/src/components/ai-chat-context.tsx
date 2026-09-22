"use client";
import { createContext, useContext, useMemo, useState } from "react";

export type AIPageContext = { page_type: "sales_order_detail"; module: "sales"; record_id: string };
type Value = { pageContext: AIPageContext | null; setPageContext: (value: AIPageContext | null) => void };
const Context = createContext<Value | null>(null);

export function AIChatContextProvider({ children }: { children: React.ReactNode }) {
  const [pageContext, setPageContext] = useState<AIPageContext | null>(null);
  const value = useMemo(() => ({ pageContext, setPageContext }), [pageContext]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAIChatContext() {
  const value = useContext(Context);
  if (!value) throw new Error("AIChatContextProvider missing");
  return value;
}
