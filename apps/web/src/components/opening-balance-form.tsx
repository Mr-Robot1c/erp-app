"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, parseOpeningCsv } from "@erp/core";
import { btnGhost, btnPrimary, callApi, inputCls, newKey } from "./doc-ui";

const TEMPLATE = [
  "loai,ma,kho,so_luong,gia_von,so_tien",
  "# ton: mã hàng, mã kho, số lượng, giá vốn (đồng/đơn vị)",
  "ton,SP001,K1,100,50000,",
  "# phai_thu / phai_tra: mã đối tác, số tiền",
  "phai_thu,KH001,,,,20000000",
  "phai_tra,NCC001,,,,15000000",
  "# tien: mã 111 (tiền mặt) hoặc 112 (ngân hàng), số tiền",
  "tien,111,,,,5000000",
  "tien,112,,,,30000000",
].join("\n");

/** Nạp số dư đầu kỳ từ tệp CSV (lô 4.2, AC-04): xem trước → nạp một lần. Dữ liệu mẫu bị xoá cùng lúc. Chỉ nạp được khi chưa có chứng từ nào. */
export function OpeningBalanceForm({ locked }: { locked: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const parsed = useMemo(() => (text.trim() ? parseOpeningCsv(text) : null), [text]);
  const totals = parsed
    ? {
        stock: parsed.data.stock.reduce((a, r) => a + Math.round(r.qty * r.unitCost), 0),
        ar: parsed.data.receivables.reduce((a, r) => a + r.amount, 0),
        ap: parsed.data.payables.reduce((a, r) => a + r.amount, 0),
        cash: parsed.data.cash.c111 + parsed.data.cash.c112,
      }
    : null;

  async function submit() {
    if (!parsed || parsed.errors.length) return;
    setBusy(true);
    setErr("");
    const res = await callApi("/api/onboarding/opening-balance", parsed.data, key);
    setBusy(false);
    if (!res.ok) return setErr(res.error.message);
    setDone(`Đã nạp số dư đầu kỳ (${String(res.data.docNo)}).`);
    router.refresh();
  }

  if (locked && !done) {
    return (
      <p id="opening-locked" className="mt-4 text-sm text-[var(--ink2)]">
        Doanh nghiệp đã có chứng từ nên không nạp số dư đầu kỳ được nữa (chỉ nạp một lần, trước khi phát sinh nghiệp vụ).
      </p>
    );
  }

  return (
    <div id="opening-form" className="mt-4 max-w-3xl">
      <p className="text-sm text-[var(--ink2)]">
        Chọn tệp CSV hoặc dán nội dung. Khi nạp, dữ liệu mẫu (nếu có) bị xoá và số dư thật được ghi bằng MỘT bút toán đầu kỳ; chênh lệch vào vốn chủ sở hữu (411).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <a className={btnGhost} download="so-du-dau-ky-mau.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${TEMPLATE}`)}`}>
          Tải tệp mẫu
        </a>
      </div>
      <textarea
        id="opening-text"
        className={`${inputCls} mt-3 h-40 font-mono text-[12.5px]`}
        placeholder="loai,ma,kho,so_luong,gia_von,so_tien"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {parsed && parsed.errors.length > 0 && (
        <ul id="opening-errors" className="mt-2 list-disc pl-5 text-sm text-[var(--bad)]">
          {parsed.errors.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {parsed && totals && parsed.errors.length === 0 && (
        <table id="opening-preview" className="mt-3 w-full max-w-md text-sm">
          <tbody>
            <tr><td className="py-0.5">Tồn kho ({parsed.data.stock.length} dòng)</td><td className="text-right font-mono tabular-nums">{formatMoney(totals.stock)}</td></tr>
            <tr><td className="py-0.5">Phải thu ({parsed.data.receivables.length} khoản)</td><td className="text-right font-mono tabular-nums">{formatMoney(totals.ar)}</td></tr>
            <tr><td className="py-0.5">Tiền mặt + ngân hàng</td><td className="text-right font-mono tabular-nums">{formatMoney(totals.cash)}</td></tr>
            <tr><td className="py-0.5">Phải trả ({parsed.data.payables.length} khoản)</td><td className="text-right font-mono tabular-nums">{formatMoney(totals.ap)}</td></tr>
            <tr className="border-t border-[var(--line)] font-semibold">
              <td className="py-0.5">Vốn chủ sở hữu (chênh lệch)</td>
              <td className="text-right font-mono tabular-nums">{formatMoney(totals.stock + totals.ar + totals.cash - totals.ap)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {err && (
        <p id="opening-err" className="mt-2 text-sm text-[var(--bad)]">
          {err}
        </p>
      )}
      {done && (
        <p id="opening-done" className="mt-2 text-sm text-[var(--ok)]">
          {done}
        </p>
      )}
      <div className="mt-3">
        <button
          id="btn-opening"
          className={btnPrimary}
          disabled={busy || !parsed || parsed.errors.length > 0 || !!done}
          onClick={() => {
            if (confirm("Nạp số dư đầu kỳ? Dữ liệu mẫu sẽ bị xoá và không nạp lại được.")) void submit();
          }}
        >
          Nạp số dư đầu kỳ
        </button>
      </div>
    </div>
  );
}
