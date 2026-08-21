import type { CostingResult } from "@/lib/costing";
import { inr, qty as fmtQty, usd } from "@/lib/format";

/**
 * The C-SHEET, on screen.
 *
 * Freight is its own column and Expenses is everything else in the pool --
 * the two never overlap, so the freight impact of a scenario is readable on
 * its own rather than buried inside a single expenses figure.
 */
export function CostingTable({ result }: { result: CostingResult }) {
  const { rows, totals } = result;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
          <tr>
            <th className="px-3 py-2.5">#</th>
            <th className="px-3 py-2.5">Description</th>
            <th className="px-3 py-2.5 text-center">Qty</th>
            <th className="px-3 py-2.5 text-center">Rate</th>
            <th className="px-3 py-2.5 text-center">Freight Prorata</th>
            <th className="px-3 py-2.5 text-center">Duty in cost</th>
            <th className="px-3 py-2.5 text-center">Expenses</th>
            <th className="px-3 py-2.5 text-center">Landed</th>
            <th className="px-3 py-2.5 text-center">Cost / pc</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="px-3 py-2 text-muted">{r.sno}</td>
              <td className="max-w-[22rem] px-3 py-2">
                <span className="block truncate" title={r.description}>
                  {r.description}
                </span>
                <span className="mt-0.5 flex gap-1.5">
                  {r.isFoc && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      FOC
                    </span>
                  )}
                  {r.dutyFellBackToActual && (
                    <span
                      title="No assessable value on record for this item, so duty is held at the actual amount instead of floating."
                      className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                    >
                      duty locked
                    </span>
                  )}
                </span>
              </td>
              <td className="tnum px-3 py-2 text-center">{fmtQty(r.qty)}</td>
              <td className="tnum px-3 py-2 text-center">{usd(r.unitPriceUsd)}</td>
              <td className="tnum px-3 py-2 text-center">{inr(r.freightShare)}</td>
              <td className="tnum px-3 py-2 text-center">{inr(r.dutyInCost)}</td>
              <td className="tnum px-3 py-2 text-center">{inr(r.otherExpenseShare)}</td>
              <td className="tnum px-3 py-2 text-center">{inr(r.landedTotal)}</td>
              <td className="tnum px-3 py-2 text-center font-semibold">{inr(r.costPerPiece)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-line bg-slate-50 font-semibold dark:bg-slate-800/40">
          <tr>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5">Total</td>
            <td className="tnum px-3 py-2.5 text-center">{fmtQty(totals.qty)}</td>
            <td className="px-3 py-2.5" />
            <td className="tnum px-3 py-2.5 text-center">{inr(totals.freightShare)}</td>
            <td className="tnum px-3 py-2.5 text-center">{inr(totals.dutyInCost)}</td>
            <td className="tnum px-3 py-2.5 text-center">{inr(totals.otherExpenseShare)}</td>
            <td className="tnum px-3 py-2.5 text-center">{inr(totals.landedTotal)}</td>
            <td className="tnum px-3 py-2.5 text-center">{inr(totals.avgCostPerPiece)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
