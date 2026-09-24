"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, type Role } from "@erp/core";
import { KIND_LABEL_ITEM } from "@/lib/item-kinds";
import { Modal, btnGhost, btnPrimary, callApi, inputCls } from "./doc-ui";

type PartnerRow = { id: string; code: string; name: string; kind: string; credit_limit: number; is_sample: boolean };
type ItemRow = { id: string; code: string; name: string; kind: string; uom: string; price: number; cost: number; tracking: string; is_sample: boolean };
type WarehouseRow = { id: string; code: string; name: string };
type Tab = "partners" | "items" | "warehouses";

const WRITERS: Role[] = ["admin", "accountant"];
const PARTNER_KIND: Record<string, string> = { customer: "Khách hàng", supplier: "Nhà cung cấp", both: "Khách & NCC" };
const TRACKING: Record<string, string> = { none: "Không", lot: "Theo lô", serial: "Theo số serial" };
const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

const th = "px-3 py-2 text-left";
const tdNum = "px-3 py-2 text-right font-mono tabular-nums";

export function MasterBoard({
  role,
  partners,
  items,
  warehouses,
}: {
  role: Role;
  partners: PartnerRow[];
  items: ItemRow[];
  warehouses: WarehouseRow[];
}) {
  const router = useRouter();
  const canWrite = WRITERS.includes(role);
  const [tab, setTab] = useState<Tab>("partners");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ tab: Tab; row: PartnerRow | ItemRow | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const needle = q.trim().toLowerCase();
  const match = (code: string, name: string) => !needle || code.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
  const pRows = partners.filter((p) => match(p.code, p.name));
  const iRows = items.filter((i) => match(i.code, i.name));
  const wRows = warehouses.filter((w) => match(w.code, w.name));
  const hasSample = partners.some((p) => p.is_sample) || items.some((i) => i.is_sample);

  async function removeSample() {
    if (!confirm("Xoá dữ liệu mẫu? Khách hàng/mặt hàng mẫu chưa có chứng từ sẽ bị xoá; cái đã dùng thì giữ lại.")) return;
    setBusy(true);
    setMsg("");
    const res = await callApi("/api/master/remove-sample", {});
    setBusy(false);
    if (!res.ok) return setMsg(res.error.message);
    setMsg(`Đã xoá ${res.data.removedPartners} khách/NCC và ${res.data.removedItems} mặt hàng mẫu.`);
    router.refresh();
  }

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "partners", label: "Khách & NCC", n: partners.length },
    { key: "items", label: "Mặt hàng", n: items.length },
    { key: "warehouses", label: "Kho", n: warehouses.length },
  ];
  const addLabel = tab === "partners" ? "+ Thêm khách/NCC" : tab === "items" ? "+ Thêm mặt hàng" : "+ Thêm kho";
  const rowCls = `border-t border-[var(--line)] ${canWrite ? "cursor-pointer hover:bg-[var(--lane)]" : ""}`;
  const empty = (tab === "partners" && !pRows.length) || (tab === "items" && !iRows.length) || (tab === "warehouses" && !wRows.length);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Danh mục</h1>
        <div className="flex gap-2">
          {role === "admin" && tab === "partners" && hasSample && (
            <button type="button" id="btn-remove-sample" className={btnGhost} disabled={busy} onClick={removeSample}>
              Xoá dữ liệu mẫu
            </button>
          )}
          {canWrite && (
            <button type="button" id="btn-add" className={btnPrimary} onClick={() => setForm({ tab, row: null })}>
              {addLabel}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            data-tab={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-[var(--r)] border px-3 py-1.5 text-sm ${tab === t.key ? "border-[var(--acc-fill)] bg-[var(--acc-fill)] text-white" : "border-[var(--line)] bg-[var(--sf)]"}`}
          >
            {t.label} ({t.n})
          </button>
        ))}
        <input id="master-search" className={`${inputCls} ml-auto max-w-xs`} placeholder="Tìm theo mã, tên…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {msg && (
        <p id="master-msg" className="mt-2 text-sm text-[var(--ink2)]">
          {msg}
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-[var(--r)] border border-[var(--line)] bg-[var(--sf)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--lane)] text-[11px] tracking-wide text-[var(--ink2)] uppercase">
            {tab === "partners" && (
              <tr>
                <th className={th}>Mã</th>
                <th className={th}>Tên</th>
                <th className={th}>Loại</th>
                <th className={`${th} text-right`}>Hạn mức công nợ</th>
              </tr>
            )}
            {tab === "items" && (
              <tr>
                <th className={th}>Mã</th>
                <th className={th}>Tên</th>
                <th className={th}>Loại</th>
                <th className={th}>Đơn vị</th>
                <th className={`${th} text-right`}>Giá bán</th>
                <th className={`${th} text-right`}>Giá vốn</th>
              </tr>
            )}
            {tab === "warehouses" && (
              <tr>
                <th className={th}>Mã</th>
                <th className={th}>Tên</th>
              </tr>
            )}
          </thead>
          <tbody>
            {tab === "partners" &&
              pRows.map((p) => (
                <tr key={p.id} data-code={p.code} className={rowCls} onClick={() => canWrite && setForm({ tab, row: p })}>
                  <td className="px-3 py-2 font-mono text-[12px]">{p.code}</td>
                  <td className="px-3 py-2">
                    {p.name}
                    {p.is_sample && <span className="ml-2 text-[11px] text-[var(--ink2)]">(mẫu)</span>}
                  </td>
                  <td className="px-3 py-2">{PARTNER_KIND[p.kind] ?? p.kind}</td>
                  <td className={tdNum}>{formatMoney(p.credit_limit)}</td>
                </tr>
              ))}
            {tab === "items" &&
              iRows.map((i) => (
                <tr key={i.id} data-code={i.code} className={rowCls} onClick={() => canWrite && setForm({ tab, row: i })}>
                  <td className="px-3 py-2 font-mono text-[12px]">{i.code}</td>
                  <td className="px-3 py-2">
                    {i.name}
                    {i.is_sample && <span className="ml-2 text-[11px] text-[var(--ink2)]">(mẫu)</span>}
                  </td>
                  <td className="px-3 py-2">{KIND_LABEL_ITEM[i.kind] ?? i.kind}</td>
                  <td className="px-3 py-2">{i.uom}</td>
                  <td className={tdNum}>{formatMoney(i.price)}</td>
                  <td className={tdNum}>{formatMoney(i.cost)}</td>
                </tr>
              ))}
            {tab === "warehouses" &&
              wRows.map((w) => (
                <tr key={w.id} data-code={w.code} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-mono text-[12px]">{w.code}</td>
                  <td className="px-3 py-2">{w.name}</td>
                </tr>
              ))}
            {empty && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[var(--ink2)]">
                  Chưa có dữ liệu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <MasterForm
          key={`${form.tab}-${form.row?.id ?? "new"}`}
          tab={form.tab}
          row={form.row}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MasterForm({ tab, row, onClose, onSaved }: { tab: Tab; row: PartnerRow | ItemRow | null; onClose: () => void; onSaved: () => void }) {
  const editing = row !== null;
  const p = row as PartnerRow | null;
  const it = row as ItemRow | null;
  const [code, setCode] = useState(row?.code ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [kind, setKind] = useState(row?.kind ?? (tab === "partners" ? "customer" : "goods"));
  const [creditLimit, setCreditLimit] = useState(String(p?.credit_limit ?? 0));
  const [uom, setUom] = useState(it?.uom ?? "cái");
  const [price, setPrice] = useState(String(it?.price ?? 0));
  const [cost, setCost] = useState(String(it?.cost ?? 0));
  const [tracking, setTracking] = useState(it?.tracking ?? "none");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const title = `${editing ? "Sửa" : "Thêm"} ${tab === "partners" ? "khách hàng / nhà cung cấp" : tab === "items" ? "mặt hàng" : "kho"}`;
  const num = (v: string) => Number(v.replace(/[.,\s]/g, ""));

  async function submit() {
    setErr("");
    if (!editing && !CODE_RE.test(code)) return setErr("Mã chỉ gồm chữ, số, gạch nối/gạch dưới, tối đa 32 ký tự.");
    if (!name.trim()) return setErr("Thiếu tên.");
    const numbers = tab === "partners" ? [creditLimit] : tab === "items" ? [price, cost] : [];
    if (numbers.some((v) => !Number.isInteger(num(v)) || num(v) < 0)) return setErr("Số tiền phải là số nguyên không âm.");

    let url: string;
    let body: Record<string, unknown>;
    if (tab === "partners") {
      url = editing ? "/api/master/partners/update" : "/api/master/partners";
      body = { ...(editing ? { id: row!.id } : { code }), name: name.trim(), kind, creditLimit: num(creditLimit) };
    } else if (tab === "items") {
      url = editing ? "/api/master/items/update" : "/api/master/items";
      body = { ...(editing ? { id: row!.id } : { code }), name: name.trim(), kind, uom: uom.trim() || "cái", price: num(price), cost: num(cost), tracking };
    } else {
      url = "/api/master/warehouses";
      body = { code, name: name.trim() };
    }
    setBusy(true);
    const res = await callApi(url, body);
    setBusy(false);
    if (!res.ok) return setErr(res.error.message);
    onSaved();
  }

  const label = "mt-3 block text-[12px] text-[var(--ink2)]";
  return (
    <Modal title={title} onClose={onClose}>
      <form
        id="master-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className={label}>Mã</label>
        <input id="f-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} disabled={editing} />
        {editing && <p className="mt-1 text-[11.5px] text-[var(--ink2)]">Mã không đổi được sau khi tạo.</p>}
        <label className={label}>Tên</label>
        <input id="f-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />

        {tab === "partners" && (
          <>
            <label className={label}>Loại</label>
            <select id="f-kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(PARTNER_KIND).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className={label}>Hạn mức công nợ (đ)</label>
            <input id="f-credit" className={inputCls} inputMode="numeric" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
          </>
        )}
        {tab === "items" && (
          <>
            <label className={label}>Loại</label>
            <select id="f-kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KIND_LABEL_ITEM).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className={label}>Đơn vị tính</label>
            <input id="f-uom" className={inputCls} value={uom} onChange={(e) => setUom(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Giá bán (đ)</label>
                <input id="f-price" className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <label className={label}>Giá vốn (đ)</label>
                <input id="f-cost" className={inputCls} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
            </div>
            <label className={label}>Theo dõi</label>
            <select id="f-tracking" className={inputCls} value={tracking} onChange={(e) => setTracking(e.target.value)}>
              {Object.entries(TRACKING).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </>
        )}

        {err && (
          <p id="master-err" className="mt-3 text-sm text-[var(--bad)]">
            {err}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" id="btn-save" className={btnPrimary} disabled={busy}>
            {editing ? "Lưu" : "Thêm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
