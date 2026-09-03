"use client";

import { itemKey, type CostingResult, type CostRow } from "@/lib/costing";
import { inr } from "@/lib/format";
import type { BoeItem, ScenarioItem } from "@/lib/types";

export type ItemPatch = Partial<
  Pick<
    ScenarioItem,
    "unit_price_usd" | "qty" | "is_foc" | "foc_bears_duty" | "description"
  >
>;

/**
 * Per-item adjustments.
 *
 * Rows come from the costing result rather than the BOE, because a scenario
 * can hold duplicated items that have no BOE row behind them. An empty price
 * or qty box means "use the actual", shown as the placeholder, so an
 * untouched row still reads as the number it will use.
 */
export function ScenarioItemsTable({
  items,
  overrides,
  result,
  baseline,
  onChange,
  onReset,
  onDuplicate,
}: {
  items: BoeItem[];
  overrides: Map<string, ScenarioItem>;
  result: CostingResult;
  baseline: CostingResult;
  onChange: (invsno: number, itemsn: number, patch: ItemPatch) => void;
  onReset: (invsno: number, itemsn: number) => void;
  onDuplicate: (row: CostRow) => void;
}) {
  const boeByKey = new Map(items.map((i) => [itemKey(i.invsno, i.itemsn), i]));
  const baseByKey = new Map(baseline.rows.map((r) => [r.key, r]));

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[880px] text-sm">
        <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
          <tr>
            <th className="px-3 py-2.5">#</th>
            <th className="px-3 py-2.5">Description</th>
            <th className="px-3 py-2.5 text-center">Rate (USD)</th>
            <th className="px-3 py-2.5 text-center">Qty</th>
            <th className="px-3 py-2.5 text-center">FOC</th>
            <th className="px-3 py-2.5 text-center">FOC duty</th>
            <th className="px-3 py-2.5 text-center">Cost / pc</th>
            <th className="px-3 py-2.5 text-center">vs actual</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => {
            const key = row.key;
            const o = overrides.get(key);
            const boeItem = boeByKey.get(key);
            const base = baseByKey.get(key);
            const diff = row.costPerPiece - (base?.costPerPiece ?? 0);
            const touched =
              o != null &&
              (o.unit_price_usd != null || o.qty != null || o.is_foc || !o.foc_bears_duty);

            return (
              <tr
                key={key}
                className={`border-t border-line ${
                  row.isAdded ? "bg-blue-50/40 dark:bg-blue-950/15" : ""
                }`}
              >
                <td className="px-3 py-2 text-muted">{row.sno}</td>

                <td className="max-w-[18rem] px-3 py-2">
                  {row.isAdded ? (
                    // A duplicated row has no BOE description to fall back on,
                    // so it carries and edits its own.
                    <input
                      value={o?.description ?? ""}
                      onChange={(e) =>
                        onChange(row.invsno, row.itemsn, { description: e.target.value })
                      }
                      className="w-full min-w-[12rem] rounded border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      aria-label={`Description for added item ${row.sno}`}
                    />
                  ) : (
                    <span className="block truncate" title={row.description}>
                      {row.description}
                    </span>
                  )}
                  {row.isAdded && (
                    <span className="mt-0.5 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                      added · duty from source
                    </span>
                  )}
                </td>

                <td className="px-3 py-2 text-center">
                  <CellInput
                    value={o?.unit_price_usd ?? null}
                    placeholder={boeItem?.unit_price_usd ?? null}
                    onChange={(v) => onChange(row.invsno, row.itemsn, { unit_price_usd: v })}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <CellInput
                    value={o?.qty ?? null}
                    placeholder={boeItem?.qty ?? null}
                    onChange={(v) => onChange(row.invsno, row.itemsn, { qty: v })}
                  />
                </td>

                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={o?.is_foc ?? false}
                    onChange={(e) =>
                      onChange(row.invsno, row.itemsn, { is_foc: e.target.checked })
                    }
                    className="size-4 accent-blue-600"
                    aria-label={`Mark item ${row.sno} free of cost`}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    disabled={!(o?.is_foc ?? false)}
                    checked={o?.foc_bears_duty ?? true}
                    onChange={(e) =>
                      onChange(row.invsno, row.itemsn, { foc_bears_duty: e.target.checked })
                    }
                    className="size-4 accent-blue-600 disabled:opacity-30"
                    aria-label={`Charge duty on free-of-cost item ${row.sno}`}
                    title="Uncheck to clear this FOC item without duty"
                  />
                </td>

                <td className="tnum px-3 py-2 text-center font-medium">
                  {inr(row.costPerPiece)}
                </td>
                <td
                  className={`tnum px-3 py-2 text-center text-xs ${
                    row.isAdded || Math.abs(diff) < 0.005
                      ? "text-muted"
                      : diff > 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {row.isAdded
                    ? "new"
                    : Math.abs(diff) < 0.005
                      ? "—"
                      : `${diff > 0 ? "+" : ""}${inr(diff).slice(1)}`}
                </td>

                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onDuplicate(row)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    aria-label={`Duplicate item ${row.sno}`}
                  >
                    duplicate
                  </button>
                  {(touched || row.isAdded) && (
                    <>
                      <span className="px-1.5 text-xs text-muted">·</span>
                      <button
                        type="button"
                        onClick={() => onReset(row.invsno, row.itemsn)}
                        className={`text-xs hover:underline ${
                          row.isAdded
                            ? "text-red-600 dark:text-red-400"
                            : "text-blue-600 dark:text-blue-400"
                        }`}
                        aria-label={
                          row.isAdded ? `Remove added item ${row.sno}` : `Reset item ${row.sno}`
                        }
                      >
                        {row.isAdded ? "remove" : "reset"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-line bg-slate-50 text-xs dark:bg-slate-800/40">
          <tr>
            <td colSpan={6} className="px-3 py-2 text-muted">
              {result.rows.length} item{result.rows.length === 1 ? "" : "s"}
              {result.rows.some((r) => r.isAdded) &&
                ` · ${result.rows.filter((r) => r.isAdded).length} added in this scenario`}
            </td>
            <td className="tnum px-3 py-2 text-center font-semibold">
              {inr(result.totals.avgCostPerPiece)}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CellInput({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <input
      type="number"
      step="any"
      inputMode="decimal"
      value={value === null ? "" : String(value)}
      placeholder={placeholder == null ? "0" : String(placeholder)}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") return onChange(null);
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      className="tnum w-20 rounded border border-line bg-surface px-2 py-1 text-center text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
    />
  );
}
