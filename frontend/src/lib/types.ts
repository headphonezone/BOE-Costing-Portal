// ---------------------------------------------------------------------------
// Actuals -- these mirror the tables the existing BOE-Costing-Sheet backend
// writes. The portal treats them as read-only.
// ---------------------------------------------------------------------------

export type Boe = {
  be_no: string;
  be_date: string | null;
  port_code: string | null;
  importer_name: string | null;
  supplier_name: string | null;
  inv_no: string | null;
  inv_date: string | null;
  inv_value_usd: number | null;
  freight_inr: number | null;
  insurance_inr: number | null;
  misc_charges_inr: number | null;
  exchange_rate: number | null;
  hawb_no: string | null;
  total_assess_value: number | null;
  total_duty: number | null;
  created_at: string;
  updated_at: string;
};

export type BoeItem = {
  id: number;
  be_no: string;
  global_sno: number | null;
  invsno: number;
  itemsn: number;
  cth: string | null;
  description: string | null;
  unit_price_usd: number | null;
  qty: number | null;
  uqc: string | null;
  assess_value: number | null;
  /** Duty actually paid in cash. Zero when the item cleared against a licence. */
  bcd: number | null;
  /** BCD foregone under a licence (Part IV Section G). The real BCD when `bcd` is 0. */
  bcd_forgone: number | null;
  sws: number | null;
  igst: number | null;
  total_duty: number | null;
};

export type BoeLicence = {
  id: number;
  be_no: string;
  invsno: number;
  itemsn: number;
  lic_no: string | null;
  lic_date: string | null;
  code: string | null;
  port: string | null;
  debit_value: number | null;
  debit_duty: number | null;
};

/** The six provisional/fixed cost fields the existing dashboard maintains. */
export type BoeVariableFields = {
  be_no: string;
  updated_at: string;
  exchange_rate: number | null;
  freight_charges: number | null;
  clearing_charges: number | null;
  supplier_freight: number | null;
  bank_charges: number | null;
  own_bank_charges: number | null;
  exchange_rate_status: FieldStatus | null;
  freight_charges_status: FieldStatus | null;
  clearing_charges_status: FieldStatus | null;
  supplier_freight_status: FieldStatus | null;
  bank_charges_status: FieldStatus | null;
  own_bank_charges_status: FieldStatus | null;
};

export type FieldStatus = "provisional" | "fixed";

// ---------------------------------------------------------------------------
// Scenarios -- owned by the portal (sql/001_scenarios.sql)
// ---------------------------------------------------------------------------

/**
 * `derived` recomputes duty from effective rates back-computed from this
 * BOE's own actual duty, so duty moves when value moves.
 * `locked` holds duty at exactly what customs charged.
 */
export type DutyMode = "derived" | "locked";

export type FreightMode = "AIR" | "SEA" | "ROAD" | "COURIER" | "OTHER";

export type FreightBasis = "LUMP_SUM" | "PER_KG" | "PER_CBM" | "PER_CONTAINER";

/**
 * Every adjustable input is nullable, meaning "inherit the actual". A newly
 * created scenario therefore reproduces the actual costing exactly until
 * something is deliberately changed.
 */
export type Scenario = {
  id: string;
  be_no: string;
  name: string;
  notes: string | null;
  duty_mode: DutyMode;
  exchange_rate: number | null;
  /**
   * False means the figure is provisional, as per the BOE. True means it has
   * been confirmed as the actual cost. Display-only -- it changes how the
   * number is presented, never how it is calculated.
   */
  exchange_rate_is_actual: boolean;
  freight_is_actual: boolean;
  freight_mode: FreightMode;
  freight_basis: FreightBasis;
  freight_rate: number | null;
  freight_quantity: number | null;
  freight_total_inr: number | null;
  insurance_inr: number | null;
  clearance_inr: number | null;
  other_charges_inr: number | null;
  misc_charges_inr: number | null;
  supplier_freight_inr: number | null;
  bank_charges_inr: number | null;
  own_bank_charges_inr: number | null;
  margin_pct: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScenarioItem = {
  id: number;
  scenario_id: string;
  invsno: number;
  itemsn: number;
  unit_price_usd: number | null;
  qty: number | null;
  is_foc: boolean;
  foc_bears_duty: boolean;
  /** Only set on a duplicated row, which has no BOE item to inherit one from. */
  description: string | null;
  /**
   * Null on a row that adjusts a real BOE item. Set to the source item's
   * `itemsn` on a duplicated row, which is an extra item that exists only in
   * this scenario and borrows the source's effective duty rates.
   */
  source_itemsn: number | null;
};

export type ScenarioWithItems = Scenario & { items: ScenarioItem[] };

export const FREIGHT_BASIS_LABELS: Record<FreightBasis, string> = {
  LUMP_SUM: "Lump sum",
  PER_KG: "Per kg (chargeable weight)",
  PER_CBM: "Per CBM",
  PER_CONTAINER: "Per container",
};

export const FREIGHT_BASIS_UNITS: Record<FreightBasis, string> = {
  LUMP_SUM: "",
  PER_KG: "kg",
  PER_CBM: "CBM",
  PER_CONTAINER: "containers",
};

export const FREIGHT_MODE_LABELS: Record<FreightMode, string> = {
  AIR: "Air",
  SEA: "Sea",
  ROAD: "Road",
  COURIER: "Courier",
  OTHER: "Other",
};
