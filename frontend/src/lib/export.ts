/**
 * Exports a costing as the C-SHEET workbook -- the same .xlsx the record page
 * downloads for the actual BOE, filled with a scenario's figures instead.
 *
 * The maths is NOT redone server-side. Everything below is taken from the
 * `CostingResult` already on screen and posted to the parser service, which
 * only lays it into the template. That split is deliberate: `costing.ts` is
 * the single source of truth, and the one time a second implementation of it
 * existed the two drifted apart. The workbook keeps its live formulas, and
 * `costing.test.ts` pins that they reproduce these numbers.
 */
import type { CostingResult } from "./costing";
import { API_BASE_URL } from "./supabase";
import type { Boe } from "./types";

/** Mirrors SimulationExport in backend/main.py. */
type SimulationPayload = {
  label: string;
  exchange_rate: number;
  margin_pct: number;
  freight: number;
  insurance: number;
  clearance: number;
  other_charges: number;
  misc: number;
  supplier_freight: number;
  bank_charges: number;
  own_bank_charges: number;
  items: Array<{
    invsno: number;
    itemsn: number;
    description: string;
    qty: number;
    unit_price_usd: number;
    is_foc: boolean;
    bcd: number;
    sws: number;
    igst: number;
    assess_value: number | null;
  }>;
};

export function toSimulationPayload(result: CostingResult): SimulationPayload {
  const { inputs, rows } = result;
  const e = inputs.expenses;
  return {
    label: result.label,
    exchange_rate: inputs.exchangeRate,
    margin_pct: inputs.marginPct,
    freight: e.freight,
    insurance: e.insurance,
    clearance: e.clearance,
    other_charges: e.otherCharges,
    misc: e.misc,
    supplier_freight: e.supplierFreight,
    bank_charges: e.bankCharges,
    own_bank_charges: e.ownBankCharges,
    // Rows are sent in display order. The workbook numbers them 1..n from
    // this order, because D-DETAILS places duty by that number and C-SHEET
    // reads it back positionally -- a gap would shift every row below it.
    items: rows.map((r) => ({
      invsno: r.invsno,
      itemsn: r.itemsn,
      description: r.description,
      qty: r.qty,
      unit_price_usd: r.unitPriceUsd,
      is_foc: r.isFoc,
      bcd: r.bcd,
      sws: r.sws,
      igst: r.igst,
      // A duplicated row was never assessed by customs, so there is nothing
      // to reconcile it against -- null, not a misleading zero.
      assess_value: r.isAdded ? null : r.assessValuePerBoe,
    })),
  };
}

export function simulationFileName(boe: Boe, label: string): string {
  const safe = label.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "simulation";
  return `BOE_${boe.be_no}_${safe}.xlsx`;
}

/**
 * Fetches the workbook and hands it to the browser. Throws with a readable
 * message when the parser service is unreachable -- this is the one action on
 * the simulate page that needs it, so it must say so rather than failing mute.
 */
export async function downloadSimulationExcel(
  result: CostingResult,
  boe: Boe
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `${API_BASE_URL}/boe/${encodeURIComponent(boe.be_no)}/excel/simulation`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSimulationPayload(result)),
      }
    );
  } catch {
    // A fetch that never reached the server throws rather than returning a
    // status: the signature of the parser service being down.
    throw new Error(
      `Could not reach the parser service at ${API_BASE_URL}. It builds the Excel file, so it has to be running for this download.`
    );
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.detail || `The parser service rejected this export (${res.status}).`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = simulationFileName(boe, result.label);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
