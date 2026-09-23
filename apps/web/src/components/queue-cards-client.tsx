"use client";
import type { Role } from "@erp/core";
import { useCachedFetch } from "@/lib/use-cached-fetch";
import type { Queues } from "@/server/queues";
import { QueueCards } from "./queue-cards";

async function fetchQueues(): Promise<Queues> {
  const res = await fetch("/api/dashboard/queues", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message ?? "Không lấy được số liệu");
  return body.data as Queues;
}

// CB-1.7b: tách khỏi trang server để trang render ngay không đợi getQueues(); dữ liệu lấy qua
// /api/dashboard/queues, cache 30s dùng chung giữa các trang (Tổng quan/Bán hàng/Mua hàng) nhờ
// use-cached-fetch.ts — điều hướng lại trong 30s không phải chờ nữa.
export function QueueCardsClient({ role, only }: { role: Role; only?: ("sales" | "warehouse" | "accounting")[] }) {
  const { data: queues, loading } = useCachedFetch("dashboard:queues", fetchQueues);

  if (!queues) {
    const cols = only ? Math.min(only.length, 3) : 3;
    return (
      <div className={`grid gap-3 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} aria-busy={loading}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-[126px] animate-pulse rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]" />
        ))}
      </div>
    );
  }
  return <QueueCards queues={queues} role={role} only={only} />;
}
