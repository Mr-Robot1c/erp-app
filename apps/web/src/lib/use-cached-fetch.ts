"use client";
import { useEffect, useState } from "react";

/**
 * CB-1.7b: cache client-side kiểu stale-while-revalidate, tự viết bằng React thuần — KHÔNG cài
 * swr/react-query vì 2 thư viện đó không nằm trong danh sách được duyệt (02-quyet-dinh mục E;
 * luật 00 "cần thêm thư viện -> hỏi user" trước khi cài). Cache là 1 Map cấp module: sống suốt
 * phiên SPA của trình duyệt (điều hướng qua next/link không reload trang) nên các trang dùng
 * chung 1 key sẽ thấy lại dữ liệu đã lấy trong 30s gần nhất, không gọi lại API.
 */
const STALE_MS = 30_000;
const cache = new Map<string, { data: unknown; at: number }>();

function readCache<T>(key: string): { key: string; data: T | undefined; loading: boolean } {
  const entry = cache.get(key) as { data: T; at: number } | undefined;
  return { key, data: entry?.data, loading: !entry };
}

export function useCachedFetch<T>(key: string, fetcher: () => Promise<T>): { data: T | undefined; loading: boolean } {
  const [state, setState] = useState(() => readCache<T>(key));

  // `key` đổi giữa 2 lần render (vd đổi kỳ ym) -> đồng bộ state NGAY trong render, theo mẫu React
  // khuyến nghị cho "adjusting state when a prop changes" (không cần effect cho nhánh đồng bộ).
  if (state.key !== key) setState(readCache<T>(key));

  useEffect(() => {
    let cancelled = false;
    const entry = cache.get(key) as { data: T; at: number } | undefined;
    const isStale = !entry || Date.now() - entry.at >= STALE_MS;
    if (!isStale) return;
    fetcher().then(
      (result) => {
        if (cancelled) return;
        cache.set(key, { data: result, at: Date.now() });
        setState({ key, data: result, loading: false });
      },
      () => {
        if (cancelled) return;
        setState((s) => (s.key === key ? { ...s, loading: false } : s));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data: state.data, loading: state.loading };
}
