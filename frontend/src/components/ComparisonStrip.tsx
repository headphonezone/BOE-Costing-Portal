import type { CostingComparison } from "@/lib/costing";
import { delta, inr, pct } from "@/lib/format";
import { StatusChip, type FigureStatus } from "./StatTile";
import type { Scenario } from "@/lib/types";

type Cell = {
  label: string;
  value: string;
  sub: string;
  /** Drives the red/green tint on the sub-line. Omitted where up/down is not good/bad. */
  diff?: number;
  status?: FigureStatus;
};

/** Headline figures for a scenario, against the actual import record. */
export function ComparisonStrip({
  comparison,
  scenario,
}: {
  comparison: CostingComparison;
  scenario: Scenario;
}) {
  const { totals, baseline, variant } = comparison;

  // otherExpenseShare includes DO charges and Exporter inland freight --
  // both get their own cell below, so they're subtracted back out here to
  // avoid showing the same rupees twice. Subtracting the raw pool inputs
  // rather than an apportioned share is exact: otherExpenseShare summed
  // across every item always equals the pool total it was apportioned from.
  const pureExpenses = (c: typeof variant) =>
    c.totals.otherExpenseShare - c.inputs.expenses.doCharges - c.inputs.expenses.exporterInlandFreight;

  const cells: Cell[] = [
    {
      label: "Avg cost / pc",
      value: inr(variant.totals.avgCostPerPiece),
      sub: `was ${inr(baseline.totals.avgCostPerPiece)} · ${pct(totals.avgCostPerPiecePct)}`,
      diff: totals.avgCostPerPiece,
    },
    {
      label: "Landed total",
      value: inr(variant.totals.landedTotal),
      sub: `${delta(totals.landedTotal)} vs actual`,
      diff: totals.landedTotal,
    },
    // Exchange rate, freight and clearance are the figures that settle later,
    // so each carries whether it is still an estimate or a confirmed actual.
    {
      label: "Exchange rate",
      value: inr(variant.inputs.exchangeRate),
      sub:
        variant.inputs.exchangeRate === baseline.inputs.exchangeRate
          ? "same as actual"
          : `was ${inr(baseline.inputs.exchangeRate)}`,
      status: scenario.exchange_rate_is_actual ? "actual" : "provisional",
    },
    {
      label: "Freight prorata",
      value: inr(variant.totals.freightShare),
      sub: `${delta(totals.freightShare)} vs actual`,
      diff: totals.freightShare,
      status: scenario.freight_is_actual ? "actual" : "provisional",
    },
    {
      label: "Clearance",
      value: inr(variant.inputs.expenses.clearance),
      sub:
        variant.inputs.expenses.clearance === baseline.inputs.expenses.clearance
          ? "same as actual"
          : `was ${inr(baseline.inputs.expenses.clearance)}`,
      status: scenario.clearance_is_actual ? "actual" : "provisional",
    },
    {
      label: "Duty in cost",
      value: inr(variant.totals.dutyInCost),
      sub:
        scenario.duty_mode === "locked"
          ? "fixed — as charged"
          : `${delta(totals.dutyInCost)} vs actual`,
      diff: scenario.duty_mode === "locked" ? undefined : totals.dutyInCost,
    },
    {
      label: "Expenses",
      value: inr(pureExpenses(variant)),
      sub: `${delta(pureExpenses(variant) - pureExpenses(baseline))} excl. freight, DO charges, inland freight`,
      diff: pureExpenses(variant) - pureExpenses(baseline),
    },
    // No separate "Actual" tick like freight/clearance have -- typing a
    // value here marks it actual immediately. No "provisional" chip when
    // blank either: StatusChip's provisional label is "As per BOE", which
    // would be untrue of a field the BOE never carries, so blank just gets
    // the plain default card styling.
    {
      label: "DO charges",
      value: inr(variant.inputs.expenses.doCharges),
      sub:
        variant.inputs.expenses.doCharges === baseline.inputs.expenses.doCharges
          ? "same as actual"
          : `was ${inr(baseline.inputs.expenses.doCharges)}`,
      status: scenario.do_charges_inr != null ? "actual" : undefined,
    },
    {
      label: "Exporter inland freight",
      value: inr(variant.inputs.expenses.exporterInlandFreight),
      sub:
        variant.inputs.expenses.exporterInlandFreight === baseline.inputs.expenses.exporterInlandFreight
          ? "same as actual"
          : `was ${inr(baseline.inputs.expenses.exporterInlandFreight)}`,
      status: scenario.exporter_inland_freight_inr != null ? "actual" : undefined,
    },
    {
      label: "Goods payable",
      value: inr(variant.totals.payableInr),
      sub: `${delta(totals.payableInr)} vs actual`,
      diff: totals.payableInr,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cells.map((c) => (
        <div
          key={c.label}
          className={`rounded-xl border px-4 py-3 ${
            c.status === "actual"
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
              : c.status === "provisional"
                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/25"
                : "border-line bg-surface"
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {c.label}
            </span>
            {c.status && <StatusChip status={c.status} />}
          </div>
          <div className="tnum mt-1 text-lg font-semibold">{c.value}</div>
          <div
            className={`tnum mt-0.5 text-xs ${
              c.diff === undefined || Math.abs(c.diff) < 0.005
                ? "text-muted"
                : c.diff > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
