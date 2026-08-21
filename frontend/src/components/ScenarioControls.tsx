"use client";

import { isFreightCalculated, resolveFreightTotal, type ResolvedInputs } from "@/lib/costing";
import { inr } from "@/lib/format";
import {
  FREIGHT_BASIS_LABELS,
  FREIGHT_BASIS_UNITS,
  FREIGHT_MODE_LABELS,
  type FreightBasis,
  type FreightMode,
  type ScenarioWithItems,
} from "@/lib/types";
import { NumberField } from "./NumberField";

const FREIGHT_MODES: FreightMode[] = ["AIR", "SEA", "ROAD", "COURIER", "OTHER"];
const FREIGHT_BASES: FreightBasis[] = ["LUMP_SUM", "PER_KG", "PER_CBM", "PER_CONTAINER"];

export function ScenarioControls({
  scenario,
  actualInputs,
  onChange,
}: {
  scenario: ScenarioWithItems;
  actualInputs: ResolvedInputs;
  onChange: (patch: Partial<ScenarioWithItems>) => void;
}) {
  const calculated = isFreightCalculated(
    scenario.freight_basis,
    scenario.freight_rate,
    scenario.freight_quantity
  );
  const freightTotal = resolveFreightTotal(scenario);
  const unit = FREIGHT_BASIS_UNITS[scenario.freight_basis];

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      <Group title="Scenario">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Name</span>
          <input
            value={scenario.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Notes</span>
          <textarea
            rows={2}
            value={scenario.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value || null })}
            placeholder="What is this scenario testing?"
            className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none placeholder:text-muted focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="Duty">
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            active={scenario.duty_mode === "locked"}
            onClick={() => onChange({ duty_mode: "locked" })}
            label="Fixed"
          />
          <Toggle
            active={scenario.duty_mode === "derived"}
            onClick={() => onChange({ duty_mode: "derived" })}
            label="Float with value"
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          {scenario.duty_mode === "locked"
            ? "Duty stays at exactly what customs charged, whatever else changes. This is the default."
            : "Duty is recomputed from this BOE's effective rates, so a price or exchange-rate change moves it too."}
        </p>
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="Exchange rate">
        <NumberField
          label="INR per USD"
          value={scenario.exchange_rate}
          inherited={actualInputs.exchangeRate}
          onChange={(v) => onChange({ exchange_rate: v })}
          prefix="₹"
        />
        {/* `?? false` because a database that has not had migration 002
            applied yet returns no such column, and an undefined `checked`
            would flip the input to uncontrolled mid-render. */}
        <ActualTick
          checked={scenario.exchange_rate_is_actual ?? false}
          onChange={(v) => onChange({ exchange_rate_is_actual: v })}
          id="exchange-rate-actual"
        />
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="Freight">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Mode</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {FREIGHT_MODES.map((m) => (
              <Toggle
                key={m}
                active={scenario.freight_mode === m}
                onClick={() => onChange({ freight_mode: m })}
                label={FREIGHT_MODE_LABELS[m]}
                compact
              />
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Basis</span>
          <select
            value={scenario.freight_basis}
            onChange={(e) => onChange({ freight_basis: e.target.value as FreightBasis })}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-blue-500"
          >
            {FREIGHT_BASES.map((b) => (
              <option key={b} value={b}>
                {FREIGHT_BASIS_LABELS[b]}
              </option>
            ))}
          </select>
        </label>

        {scenario.freight_basis !== "LUMP_SUM" && (
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-dashed border-line p-2.5">
            <NumberField
              label="Rate"
              value={scenario.freight_rate}
              onChange={(v) => onChange({ freight_rate: v })}
              prefix="₹"
              suffix={`/ ${unit}`}
            />
            <NumberField
              label={unit === "containers" ? "Containers" : "Quantity"}
              value={scenario.freight_quantity}
              onChange={(v) => onChange({ freight_quantity: v })}
              suffix={unit}
            />
            <p className="col-span-2 text-[11px] text-muted">
              {calculated ? (
                <>
                  Computes to <strong className="tnum">{inr(freightTotal)}</strong>, overriding the
                  total below.
                </>
              ) : (
                "Fill in both to compute the total; otherwise the typed total is used."
              )}
            </p>
          </div>
        )}

        <NumberField
          label="Freight total"
          value={scenario.freight_total_inr}
          inherited={actualInputs.expenses.freight}
          onChange={(v) => onChange({ freight_total_inr: v })}
          prefix="₹"
          disabled={calculated}
          hint={calculated ? "Driven by the calculator above." : undefined}
        />
        <ActualTick
          checked={scenario.freight_is_actual ?? false}
          onChange={(v) => onChange({ freight_is_actual: v })}
          id="freight-actual"
        />
      </Group>

      {/* ---------------------------------------------------------------- */}
      <Group title="Other expenses">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Insurance"
            value={scenario.insurance_inr}
            inherited={actualInputs.expenses.insurance}
            onChange={(v) => onChange({ insurance_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Clearance"
            value={scenario.clearance_inr}
            inherited={actualInputs.expenses.clearance}
            onChange={(v) => onChange({ clearance_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Misc / freight 2"
            value={scenario.misc_charges_inr}
            inherited={actualInputs.expenses.misc}
            onChange={(v) => onChange({ misc_charges_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Supplier freight"
            value={scenario.supplier_freight_inr}
            inherited={actualInputs.expenses.supplierFreight}
            onChange={(v) => onChange({ supplier_freight_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Bank charges"
            value={scenario.bank_charges_inr}
            inherited={actualInputs.expenses.bankCharges}
            onChange={(v) => onChange({ bank_charges_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Own bank charges"
            value={scenario.own_bank_charges_inr}
            inherited={actualInputs.expenses.ownBankCharges}
            onChange={(v) => onChange({ own_bank_charges_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Others"
            value={scenario.other_charges_inr}
            inherited={actualInputs.expenses.otherCharges}
            onChange={(v) => onChange({ other_charges_inr: v })}
            prefix="₹"
          />
          <NumberField
            label="Margin"
            value={scenario.margin_pct}
            onChange={(v) => onChange({ margin_pct: v ?? 0 })}
            suffix="%"
          />
        </div>
      </Group>
    </div>
  );
}

/**
 * Marks a figure as the confirmed actual cost rather than the provisional one
 * carried over from the BOE. Unticked is the safe default: a number nobody has
 * confirmed must not present itself as settled.
 */
function ActualTick({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  id: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition ${
        checked
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/25 dark:text-red-300"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-emerald-600"
      />
      {checked ? "Actual cost" : "Provisional — as per BOE"}
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({
  active,
  onClick,
  label,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border text-sm font-medium transition ${
        compact ? "px-2.5 py-1 text-xs" : "px-3 py-2"
      } ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-line bg-surface hover:border-blue-400"
      }`}
    >
      {label}
    </button>
  );
}
