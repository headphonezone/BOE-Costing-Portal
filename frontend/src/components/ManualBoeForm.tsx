"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  boeExists,
  createBoeManually,
  emptyDraft,
  emptyItem,
  isBlankItem,
  validate,
  type ManualBoeDraft,
  type ManualItemDraft,
} from "@/lib/manual-entry";
import { inr, usd } from "@/lib/format";

export function ManualBoeForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<ManualBoeDraft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ManualBoeDraft>(key: K, value: ManualBoeDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setItem(index: number, key: keyof ManualItemDraft, value: string) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, i) => (i === index ? { ...it, [key]: value } : it)),
    }));
  }

  function addItem() {
    setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] }));
  }

  /**
   * Inserts a copy directly below the original rather than at the end, so a
   * run of near-identical items (same product, different SKU) stays together
   * while it is being edited.
   */
  function duplicateItem(index: number) {
    setDraft((d) => {
      const copy = { ...d.items[index] };
      const items = [...d.items];
      items.splice(index + 1, 0, copy);
      return { ...d, items };
    });
  }

  function removeItem(index: number) {
    setDraft((d) => ({
      ...d,
      // Never leave the table with no rows at all -- an empty table gives the
      // user nothing to type into.
      items: d.items.length === 1 ? [emptyItem()] : d.items.filter((_, i) => i !== index),
    }));
  }

  async function checkDuplicate() {
    if (!draft.be_no.trim()) return;
    try {
      setDuplicate(await boeExists(draft.be_no));
    } catch {
      // A failed existence check is only a lost warning, not a blocker --
      // the save itself will surface any real problem.
      setDuplicate(false);
    }
  }

  async function handleSave() {
    const found = validate(draft);
    setErrors(found);
    setSaveError(null);
    if (found.length > 0) return;

    setSaving(true);
    try {
      const be_no = await createBoeManually(draft);
      router.push(`/boe/${encodeURIComponent(be_no)}`);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save this record.");
      setSaving(false);
    }
  }

  const filled = draft.items.filter((i) => !isBlankItem(i));
  const rate = Number(draft.exchange_rate) || 0;
  const goodsUsd = filled.reduce(
    (s, i) => s + (Number(i.unit_price_usd) || 0) * (Number(i.qty) || 0),
    0
  );
  const dutyTotal = filled.reduce(
    (s, i) => s + (Number(i.bcd) || 0) + (Number(i.sws) || 0) + (Number(i.igst) || 0),
    0
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold">Bill of Entry</h2>
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="BE number"
            required
            value={draft.be_no}
            onChange={(v) => set("be_no", v)}
            onBlur={checkDuplicate}
            placeholder="2702749"
          />
          <Field label="BE date" type="date" value={draft.be_date} onChange={(v) => set("be_date", v)} />
          <Field
            label="Exchange rate"
            required
            type="number"
            value={draft.exchange_rate}
            onChange={(v) => set("exchange_rate", v)}
            placeholder="91.237"
            prefix="₹"
          />
          <Field
            label="Supplier"
            value={draft.supplier_name}
            onChange={(v) => set("supplier_name", v)}
            placeholder="FANMUSIC (HONGKONG) LIMITED"
          />
          <Field label="Invoice number" value={draft.inv_no} onChange={(v) => set("inv_no", v)} />
          <Field label="Invoice date" type="date" value={draft.inv_date} onChange={(v) => set("inv_date", v)} />
          <Field
            label="Invoice value"
            type="number"
            value={draft.inv_value_usd}
            onChange={(v) => set("inv_value_usd", v)}
            prefix="$"
          />
          <Field label="AWB / HAWB" value={draft.hawb_no} onChange={(v) => set("hawb_no", v)} />
          <Field label="Importer" value={draft.importer_name} onChange={(v) => set("importer_name", v)} />
          <Field
            label="Freight"
            type="number"
            value={draft.freight_inr}
            onChange={(v) => set("freight_inr", v)}
            prefix="₹"
          />
          <Field
            label="Insurance"
            type="number"
            value={draft.insurance_inr}
            onChange={(v) => set("insurance_inr", v)}
            prefix="₹"
          />
          <Field
            label="Misc charges"
            type="number"
            value={draft.misc_charges_inr}
            onChange={(v) => set("misc_charges_inr", v)}
            prefix="₹"
          />
        </div>

        {duplicate && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            BE {draft.be_no.trim()} already exists. Saving will replace its header and items.
            Any saved simulations on it are kept.
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Items ({filled.length})</h2>
          <p className="text-xs text-muted">
            Leave duty blank if not known — it can be filled in later.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Description</th>
                <th className="px-3 py-2.5 text-center">Qty</th>
                <th className="px-3 py-2.5 text-center">Rate (USD)</th>
                <th className="px-3 py-2.5 text-center">Assessable</th>
                <th className="px-3 py-2.5 text-center">BCD</th>
                <th className="px-3 py-2.5 text-center">SWS</th>
                <th className="px-3 py-2.5 text-center">IGST</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2 text-muted">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Cell
                      value={item.description}
                      onChange={(v) => setItem(i, "description", v)}
                      placeholder="HEADPHONE UTOPIA 2022 BLACK"
                      wide
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Cell value={item.qty} onChange={(v) => setItem(i, "qty", v)} type="number" />
                  </td>
                  <td className="px-3 py-2">
                    <Cell
                      value={item.unit_price_usd}
                      onChange={(v) => setItem(i, "unit_price_usd", v)}
                      type="number"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Cell
                      value={item.assess_value}
                      onChange={(v) => setItem(i, "assess_value", v)}
                      type="number"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Cell value={item.bcd} onChange={(v) => setItem(i, "bcd", v)} type="number" />
                  </td>
                  <td className="px-3 py-2">
                    <Cell value={item.sws} onChange={(v) => setItem(i, "sws", v)} type="number" />
                  </td>
                  <td className="px-3 py-2">
                    <Cell value={item.igst} onChange={(v) => setItem(i, "igst", v)} type="number" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => duplicateItem(i)}
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      aria-label={`Duplicate item ${i + 1}`}
                    >
                      duplicate
                    </button>
                    <span className="px-1.5 text-xs text-muted">·</span>
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                      aria-label={`Remove item ${i + 1}`}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={addItem}
            className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-blue-400 hover:text-foreground"
          >
            + Add item
          </button>
          {filled.length > 0 && (
            <p className="tnum text-xs text-muted">
              Goods {usd(goodsUsd)}
              {rate > 0 && <> · {inr(goodsUsd * rate)}</>} · Duty {inr(dutyTotal)}
            </p>
          )}
        </div>
      </section>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-medium">Fix these before saving</p>
          <ul className="mt-1.5 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {saveError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save record"}
        </button>
        <p className="text-xs text-muted">
          Saved straight to the database — this does not need the parser service.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  placeholder,
  prefix,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  type?: string;
  placeholder?: string;
  prefix?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <span className="mt-1 flex items-center rounded-lg border border-line bg-surface focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
        {prefix && <span className="pl-2.5 text-sm text-muted">{prefix}</span>}
        <input
          type={type}
          step={type === "number" ? "any" : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="tnum w-full bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted/60"
        />
      </span>
    </label>
  );
}

function Cell({
  value,
  onChange,
  type = "text",
  placeholder,
  wide,
}: {
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <input
      type={type}
      step={type === "number" ? "any" : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`tnum rounded border border-line bg-surface px-2 py-1 text-sm outline-none placeholder:text-muted/50 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${
        wide ? "w-full min-w-[16rem]" : "w-24 text-center"
      }`}
    />
  );
}
