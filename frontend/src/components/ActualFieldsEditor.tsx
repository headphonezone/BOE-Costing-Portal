"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/supabase";
import { NumberField } from "./NumberField";
import type { Boe, BoeVariableFields } from "@/lib/types";

/** The eight fields supabase_client.FIELDS accepts, in the order shown. */
const FIELD_DEFS: Array<{
  key:
    | "exchange_rate"
    | "freight_charges"
    | "clearing_charges"
    | "supplier_freight"
    | "bank_charges"
    | "own_bank_charges"
    | "do_charges"
    | "exporter_inland_freight";
  label: string;
}> = [
  { key: "exchange_rate", label: "Exchange rate" },
  { key: "freight_charges", label: "Freight" },
  { key: "clearing_charges", label: "Clearance" },
  { key: "supplier_freight", label: "Supplier freight" },
  { key: "bank_charges", label: "Bank charges" },
  { key: "own_bank_charges", label: "Own bank charges" },
  { key: "do_charges", label: "DO charges" },
  { key: "exporter_inland_freight", label: "Exporter inland freight" },
];

/**
 * Manually confirms one of the BOE's actual-costing figures -- the same
 * eight fields a debit advice can set, or that otherwise sit at whatever the
 * BOE itself printed (exchange rate, freight) or the 10,000 clearance
 * default. Saving marks the field confirmed/actual immediately: no separate
 * tick, typing a number here and leaving the box is the confirmation.
 */
export function ActualFieldsEditor({
  be_no,
  boe,
  variableFields,
}: {
  be_no: string;
  boe: Boe;
  variableFields: BoeVariableFields | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(fieldName: string, value: number | null) {
    if (value === null) return; // Nothing to confirm a field to -- clearing a box is not supported here.
    setSaving(fieldName);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/boe/${encodeURIComponent(be_no)}/field`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field_name: fieldName, value, status: "fixed" }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || `Could not save (${res.status}).`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(null);
    }
  }

  const inheritedFor: Record<string, number | null> = {
    exchange_rate: boe.exchange_rate,
    freight_charges: boe.freight_inr,
    clearing_charges: 10000,
    supplier_freight: null,
    bank_charges: null,
    own_bank_charges: null,
    do_charges: null,
    exporter_inland_freight: null,
  };

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold">Confirm actual figures</h2>
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FIELD_DEFS.map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              value={variableFields?.[f.key] ?? null}
              inherited={inheritedFor[f.key]}
              onChange={() => {}}
              onCommit={(v) => save(f.key, v)}
              prefix="₹"
              disabled={saving === f.key}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Typing a value and clicking away confirms it as the actual cost immediately -- no
          separate confirm step. Exchange rate and Freight&apos;s chips above update to match;
          the rest apply to costing right away even though nothing on this page displays their
          confirmed/estimated status individually.
        </p>
      </div>
    </section>
  );
}
