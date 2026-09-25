"use client";
import { createContext, useContext } from "react";

export type TenantInfo = { name: string; taxCode: string };
const TenantInfoContext = createContext<TenantInfo>({ name: "", taxCode: "" });

/** Tên công ty + MST cho đầu trang in chứng từ (UI-3 3.4) — đặt ở AppShell, đọc ở modal chi tiết. */
export const TenantInfoProvider = TenantInfoContext.Provider;
export const useTenantInfo = () => useContext(TenantInfoContext);
