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
    // Exchange rate and freight are the two figures that settle later, so each
    // carries whether it is still the BOE's number or a confirmed actual.
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
      value: inr(variant.totals.otherExpenseShare),
      sub: `${delta(totals.otherExpenseShare)} excl. freight`,
      diff: totals.otherExpenseShare,
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
