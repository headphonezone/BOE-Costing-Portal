/**
 * The costing engine.
 *
 * This is a pure, dependency-free module: same inputs always give the same
 * outputs, no Supabase, no React, no Date.now(). That is deliberate -- it is
 * the one piece of this project that has to be provably right, so it is the
 * one piece that is fully unit-testable in isolation (see costing.test.ts).
 *
 * ---------------------------------------------------------------------------
 * THE MODEL
 *
 * Ported from the C-SHEET of the Excel template that Ferrari Video has always
 * costed against (embedded as base64 in BOE-Costing-Sheet/boe_parser.py).
 * Landed cost is value-proportional apportionment of a single expense pool:
 *
 *   declared INR  Fi = usd_rate x qty x exchange_rate
 *   share         si = Fi / sum(F)
 *   expenses/pcs  Hi = expense_pool x si          <- C-SHEET col H, via $I$9
 *   duty in cost  Gi = BCD + SWS                  <- IGST excluded, see below
 *   cost/piece    Ii = (Fi + Gi + Hi) / qty
 *   selling       Ji = Ii x (1 + margin%)
 *
 * and, separately, a reconciliation of computed assessable value against what
 * customs actually assessed:
 *
 *   assess calc   Oi = Fi + freight_i + misc_i + insurance_i    <- col O
 *   assess actual Pi = boe_items.assess_value                   <- col P
 *   difference    Qi = Oi - Pi                                  <- col Q
 *
 * TWO DELIBERATE DEPARTURES FROM THE SPREADSHEET
 *
 * 1. The expense pool. The template computes it as `I9 = I8+I7+I6+I5`, i.e.
 *    Freight + Insurance + Clearance + Others. The current app also writes
 *    Supplier Freight, Bank Charges and Own Bank Charges into K6:K8 -- cells
 *    that I9 never sums. Those three costs are captured, displayed, and then
 *    silently dropped from cost per piece. Here the pool includes all of
 *    them. This means portal figures will read slightly HIGHER than the old
 *    spreadsheet for any BOE where those three are non-zero; that difference
 *    is the bug being fixed, not a regression.
 *
 * 2. IGST is excluded from cost. It is a creditable input tax -- it is
 *    recovered, so it is cash flow, not cost. The spreadsheet already does
 *    this (col G sums only D-DETAILS C+D, BCD and SWS). Preserved here, and
 *    IGST is still reported separately as part of the cyber-receipt outflow.
 * ---------------------------------------------------------------------------
 */

import type {
  Boe,
  BoeItem,
  BoeVariableFields,
  DutyMode,
  FreightBasis,
  Scenario,
  ScenarioItem,
} from "./types";

/** Statutory Social Welfare Surcharge rate, used only as a fallback. */
const DEFAULT_SWS_PCT = 0.1;

export function itemKey(invsno: number, itemsn: number): string {
  return `${invsno}-${itemsn}`;
}

// ---------------------------------------------------------------------------
// Duty rates
// ---------------------------------------------------------------------------

export type DutyRates = {
  /** BCD actually borne: cash BCD, or the licence-foregone amount when cash BCD is nil. */
  bcdEffective: number;
  sws: number;
  igst: number;
  assessValue: number;
  bcdPct: number;
  swsPct: number;
  igstPct: number;
  /**
   * False when this item has no assessable value on record, so no meaningful
   * rate can be back-computed. Callers must fall back to locked duty rather
   * than multiplying by a zero rate and silently reporting nil duty.
   */
  canDerive: boolean;
};

/**
 * Back-computes effective duty rates from what customs actually charged on
 * this item. The BOE records amounts, never rates, so this is the only way a
 * scenario can make duty respond to a change in value.
 *
 * The BCD rule matches the parser: a positive cash BCD is the real BCD;
 * otherwise the Part IV Section G duty-foregone amount is (it was paid, just
 * with a licence rather than cash).
 */
export function deriveDutyRates(item: BoeItem): DutyRates {
  const cashBcd = item.bcd ?? 0;
  const bcdEffective = cashBcd > 0 ? cashBcd : item.bcd_forgone ?? 0;
  const sws = item.sws ?? 0;
  const igst = item.igst ?? 0;
  const assessValue = item.assess_value ?? 0;

  const canDerive = assessValue > 0;
  const igstBase = assessValue + bcdEffective + sws;

  return {
    bcdEffective,
    sws,
    igst,
    assessValue,
    bcdPct: canDerive ? bcdEffective / assessValue : 0,
    // When BCD is nil the ratio is undefined; the statutory 10% is a safe
    // fallback because it only ever multiplies a BCD that is itself nil.
    swsPct: bcdEffective > 0 ? sws / bcdEffective : DEFAULT_SWS_PCT,
    igstPct: igstBase > 0 ? igst / igstBase : 0,
    canDerive,
  };
}

// ---------------------------------------------------------------------------
// Resolving inputs
// ---------------------------------------------------------------------------

export type ExpensePool = {
  freight: number;
  insurance: number;
  clearance: number;
  otherCharges: number;
  misc: number;
  supplierFreight: number;
  bankCharges: number;
  ownBankCharges: number;
  /** Sum of every component above -- the pool apportioned into cost per piece. */
  total: number;
};

export type ResolvedInputs = {
  exchangeRate: number;
  marginPct: number;
  dutyMode: DutyMode;
  expenses: ExpensePool;
};

function num(...candidates: Array<number | null | undefined>): number {
  for (const c of candidates) {
    if (c !== null && c !== undefined && Number.isFinite(c)) return c;
  }
  return 0;
}

/**
 * Freight total for a scenario. `LUMP_SUM` uses the typed total directly;
 * every other basis multiplies rate x quantity (air INR/kg on chargeable
 * weight, sea INR/CBM or per container). If the calculator is only half
 * filled in, the typed total still wins -- a partially configured calculator
 * must never silently zero out freight.
 */
export function resolveFreightTotal(
  scenario: Pick<
    Scenario,
    "freight_basis" | "freight_rate" | "freight_quantity" | "freight_total_inr"
  >
): number {
  const { freight_basis, freight_rate, freight_quantity, freight_total_inr } = scenario;
  if (freight_basis !== "LUMP_SUM" && freight_rate != null && freight_quantity != null) {
    return freight_rate * freight_quantity;
  }
  return num(freight_total_inr);
}

/** True when the rate x quantity calculator is fully populated and in use. */
export function isFreightCalculated(basis: FreightBasis, rate: number | null, qty: number | null) {
  return basis !== "LUMP_SUM" && rate != null && qty != null;
}

/**
 * A scenario's freight, in the order the controls imply it:
 *
 *   1. a fully filled-in rate x quantity calculator wins;
 *   2. otherwise a typed total wins;
 *   3. otherwise the actual freight is inherited, like every other input.
 *
 * Step 3 is why this exists rather than calling `resolveFreightTotal`
 * directly. That function answers "what freight has this scenario set?", for
 * which nothing set is legitimately zero. Inheritance is a different
 * question, and picking the basis dropdown is not a freight figure: choosing
 * "Per kg" before typing a rate must not silently drop the actual freight out
 * of the pool while the control still shows it as the inherited placeholder.
 */
export function resolveScenarioFreight(
  scenario: Pick<
    Scenario,
    "freight_basis" | "freight_rate" | "freight_quantity" | "freight_total_inr"
  >,
  inherited: number
): number {
  const { freight_basis, freight_rate, freight_quantity, freight_total_inr } = scenario;
  if (isFreightCalculated(freight_basis, freight_rate, freight_quantity)) {
    return freight_rate! * freight_quantity!;
  }
  return freight_total_inr ?? inherited;
}

/**
 * Resolves the actual (un-simulated) inputs for a BOE. Mirrors the fallback
 * order the existing spreadsheet filler uses: an operator-maintained variable
 * field wins over the parsed BOE value, which wins over zero.
 */
export function resolveActualInputs(
  boe: Boe,
  variableFields: BoeVariableFields | null
): ResolvedInputs {
  const expenses = buildPool({
    freight: num(variableFields?.freight_charges, boe.freight_inr),
    insurance: num(boe.insurance_inr),
    clearance: num(variableFields?.clearing_charges),
    otherCharges: 0,
    misc: num(boe.misc_charges_inr),
    supplierFreight: num(variableFields?.supplier_freight),
    bankCharges: num(variableFields?.bank_charges),
    ownBankCharges: num(variableFields?.own_bank_charges),
  });

  return {
    exchangeRate: num(variableFields?.exchange_rate, boe.exchange_rate, 1),
    marginPct: 2,
    dutyMode: "locked", // actuals are, by definition, what customs charged
    expenses,
  };
}

/**
 * Resolves a scenario's inputs. Every null on the scenario inherits from the
 * actuals, so a brand-new scenario reproduces the actual costing exactly and
 * only deliberate edits move the numbers.
 */
export function resolveScenarioInputs(
  boe: Boe,
  variableFields: BoeVariableFields | null,
  scenario: Scenario
): ResolvedInputs {
  const actual = resolveActualInputs(boe, variableFields);

  const expenses = buildPool({
    freight: resolveScenarioFreight(scenario, actual.expenses.freight),
    insurance: scenario.insurance_inr ?? actual.expenses.insurance,
    clearance: scenario.clearance_inr ?? actual.expenses.clearance,
    otherCharges: scenario.other_charges_inr ?? actual.expenses.otherCharges,
    misc: scenario.misc_charges_inr ?? actual.expenses.misc,
    supplierFreight: scenario.supplier_freight_inr ?? actual.expenses.supplierFreight,
    bankCharges: scenario.bank_charges_inr ?? actual.expenses.bankCharges,
    ownBankCharges: scenario.own_bank_charges_inr ?? actual.expenses.ownBankCharges,
  });

  return {
    exchangeRate: scenario.exchange_rate ?? actual.exchangeRate,
    marginPct: scenario.margin_pct ?? 2,
    dutyMode: scenario.duty_mode,
    expenses,
  };
}

function buildPool(parts: Omit<ExpensePool, "total">): ExpensePool {
  const total =
    parts.freight +
    parts.insurance +
    parts.clearance +
    parts.otherCharges +
    parts.misc +
    parts.supplierFreight +
    parts.bankCharges +
    parts.ownBankCharges;
  return { ...parts, total };
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

export type CostRow = {
  key: string;
  sno: number;
  invsno: number;
  itemsn: number;
  description: string;

  qty: number;
  unitPriceUsd: number;
  isFoc: boolean;
  /** True for a row that exists only in this scenario, duplicated from a BOE item. */
  isAdded: boolean;

  /** usd_rate x qty. What the goods are worth, FOC or not. */
  declaredUsd: number;
  /** declaredUsd x exchange_rate -- the apportionment base. */
  declaredInr: number;
  /** What is actually paid to the supplier. Zero for FOC. */
  payableInr: number;

  share: number;
  freightShare: number;
  insuranceShare: number;
  miscShare: number;
  /** The full expense pool apportioned to this item -- C-SHEET col H. */
  expenseShare: number;
  /**
   * `expenseShare` minus `freightShare`. Freight is the expense that moves
   * most between scenarios, so it is reported on its own and this is
   * everything else; the two always add back up to `expenseShare`.
   */
  otherExpenseShare: number;

  bcd: number;
  sws: number;
  igst: number;
  /** BCD + SWS. IGST excluded as a creditable input tax. */
  dutyInCost: number;
  /** SWS + IGST -- the cash actually paid when BCD clears against a licence. */
  cyberReceipt: number;
  /** True when derived duty was requested but this item had no basis to derive from. */
  dutyFellBackToActual: boolean;

  assessValueCalc: number;
  assessValuePerBoe: number;
  assessValueDiff: number;

  landedTotal: number;
  costPerPiece: number;
  sellingPerPiece: number;
  totalSelling: number;
};

export type CostTotals = {
  qty: number;
  declaredUsd: number;
  declaredInr: number;
  payableInr: number;
  freightShare: number;
  insuranceShare: number;
  miscShare: number;
  expenseShare: number;
  otherExpenseShare: number;
  bcd: number;
  sws: number;
  igst: number;
  dutyInCost: number;
  cyberReceipt: number;
  assessValueCalc: number;
  assessValuePerBoe: number;
  assessValueDiff: number;
  landedTotal: number;
  totalSelling: number;
  /** Weighted, not a column sum: landedTotal / qty. */
  avgCostPerPiece: number;
};

export type CostingResult = {
  label: string;
  inputs: ResolvedInputs;
  rows: CostRow[];
  totals: CostTotals;
  /** Items where derived duty was requested but no assessable value existed. */
  dutyFallbackCount: number;
};

export type ComputeArgs = {
  label: string;
  items: BoeItem[];
  inputs: ResolvedInputs;
  /** Sparse per-item overrides, keyed by `${invsno}-${itemsn}`. */
  overrides?: Map<string, ScenarioItem>;
};

/**
 * Deliberately takes items and already-resolved inputs rather than the BOE
 * itself: everything BOE-level has been folded into `inputs` by then, which
 * keeps this function trivially callable from a test with a hand-built
 * fixture.
 */
export function computeCosting({
  label,
  items,
  inputs,
  overrides,
}: ComputeArgs): CostingResult {
  const { exchangeRate, marginPct, dutyMode, expenses } = inputs;

  // Duplicated rows are extra items that exist only in this scenario. Each is
  // built from the BOE item it was copied from, which is what gives it duty
  // rates to work with -- it has no duty of its own on the BOE. A copy whose
  // source has since gone is dropped rather than guessed at.
  const bySourceKey = new Map(items.map((i) => [itemKey(i.invsno, i.itemsn), i]));
  const maxSno = items.reduce((m, i) => Math.max(m, i.global_sno ?? i.itemsn), 0);

  const added: BoeItem[] = [];
  for (const o of overrides?.values() ?? []) {
    if (o.source_itemsn == null) continue;
    const source = bySourceKey.get(itemKey(o.invsno, o.source_itemsn));
    if (!source) continue;
    added.push({
      ...source,
      id: -Math.abs(o.id),
      itemsn: o.itemsn,
      // Copies sort after every real item rather than interleaving, so the
      // BOE's own numbering stays readable.
      global_sno: maxSno + added.length + 1,
      description: o.description ?? `${source.description ?? ""} (copy)`,
    });
  }

  const addedKeys = new Set(added.map((a) => itemKey(a.invsno, a.itemsn)));
  const allItems = added.length > 0 ? [...items, ...added] : items;

  // Pass 1 -- resolve each item's declared value. This is the apportionment
  // base, and FOC items stay in it at full declared value: the goods still
  // occupy the container and are still assessed by customs, so they must
  // absorb their share of freight even though nothing is paid for them.
  const resolved = allItems.map((item) => {
    const key = itemKey(item.invsno, item.itemsn);
    const o = overrides?.get(key);

    const unitPriceUsd = o?.unit_price_usd ?? item.unit_price_usd ?? 0;
    const qty = o?.qty ?? item.qty ?? 0;
    const isFoc = o?.is_foc ?? false;
    const focBearsDuty = o?.foc_bears_duty ?? true;

    const declaredUsd = unitPriceUsd * qty;
    const declaredInr = declaredUsd * exchangeRate;

    return {
      item,
      key,
      isAdded: addedKeys.has(key),
      unitPriceUsd,
      qty,
      isFoc,
      focBearsDuty,
      declaredUsd,
      declaredInr,
      payableInr: isFoc ? 0 : declaredInr,
      rates: deriveDutyRates(item),
    };
  });

  const totalDeclaredInr = resolved.reduce((s, r) => s + r.declaredInr, 0);

  // Pass 2 -- apportion, apply duty, and cost.
  const rows: CostRow[] = resolved.map((r) => {
    const share = totalDeclaredInr > 0 ? r.declaredInr / totalDeclaredInr : 0;

    const freightShare = expenses.freight * share;
    const insuranceShare = expenses.insurance * share;
    const miscShare = expenses.misc * share;
    const expenseShare = expenses.total * share;

    // Assessable value as this scenario implies it: goods value plus the
    // freight, misc and insurance that customs loads onto it.
    const assessValueCalc = r.declaredInr + freightShare + miscShare + insuranceShare;

    // Derived duty needs a basis. Without an assessable value on record there
    // is no rate to derive, so hold that item at its actual duty and say so,
    // rather than multiplying by zero and reporting nil duty.
    const canDerive = r.rates.canDerive;
    // A duplicated row must always derive, whatever the scenario's duty mode.
    // Locking it would apply the source item's actual duty a second time --
    // charging the same customs payment twice.
    const wantDerived = dutyMode === "derived" || r.isAdded;
    const dutyFellBackToActual = wantDerived && !canDerive && !r.isAdded;

    let bcd: number;
    let sws: number;
    let igst: number;

    if (wantDerived && canDerive) {
      bcd = assessValueCalc * r.rates.bcdPct;
      sws = bcd * r.rates.swsPct;
      igst = (assessValueCalc + bcd + sws) * r.rates.igstPct;
    } else if (r.isAdded) {
      // No rate to derive from, and no actual to fall back on.
      bcd = 0;
      sws = 0;
      igst = 0;
    } else {
      bcd = r.rates.bcdEffective;
      sws = r.rates.sws;
      igst = r.rates.igst;
    }

    // FOC with duty waived: the scenario is modelling a replacement or sample
    // shipment cleared without duty. Otherwise FOC goods are dutiable at their
    // declared value exactly like paid goods.
    if (r.isFoc && !r.focBearsDuty) {
      bcd = 0;
      sws = 0;
      igst = 0;
    }

    const dutyInCost = bcd + sws;
    const cyberReceipt = sws + igst;

    const landedTotal = r.payableInr + dutyInCost + expenseShare;
    const costPerPiece = r.qty > 0 ? landedTotal / r.qty : 0;
    const sellingPerPiece = costPerPiece * (1 + marginPct / 100);

    // A duplicated row is not on the BOE, so customs assessed nothing for it
    // and there is no figure to reconcile against.
    const assessValuePerBoe = r.isAdded ? 0 : r.item.assess_value ?? 0;

    return {
      key: r.key,
      sno: r.item.global_sno ?? r.item.itemsn,
      invsno: r.item.invsno,
      itemsn: r.item.itemsn,
      description: r.item.description ?? "",
      qty: r.qty,
      unitPriceUsd: r.unitPriceUsd,
      isFoc: r.isFoc,
      isAdded: r.isAdded,
      declaredUsd: r.declaredUsd,
      declaredInr: r.declaredInr,
      payableInr: r.payableInr,
      share,
      freightShare,
      insuranceShare,
      miscShare,
      expenseShare,
      otherExpenseShare: expenseShare - freightShare,
      bcd,
      sws,
      igst,
      dutyInCost,
      cyberReceipt,
      dutyFellBackToActual,
      assessValueCalc,
      assessValuePerBoe,
      assessValueDiff: assessValueCalc - assessValuePerBoe,
      landedTotal,
      costPerPiece,
      sellingPerPiece,
      totalSelling: r.qty * sellingPerPiece,
    };
  });

  rows.sort((a, b) => a.sno - b.sno);

  const sum = (pick: (r: CostRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totalQty = sum((r) => r.qty);
  const totalLanded = sum((r) => r.landedTotal);

  const totals: CostTotals = {
    qty: totalQty,
    declaredUsd: sum((r) => r.declaredUsd),
    declaredInr: sum((r) => r.declaredInr),
    payableInr: sum((r) => r.payableInr),
    freightShare: sum((r) => r.freightShare),
    insuranceShare: sum((r) => r.insuranceShare),
    miscShare: sum((r) => r.miscShare),
    expenseShare: sum((r) => r.expenseShare),
    otherExpenseShare: sum((r) => r.otherExpenseShare),
    bcd: sum((r) => r.bcd),
    sws: sum((r) => r.sws),
    igst: sum((r) => r.igst),
    dutyInCost: sum((r) => r.dutyInCost),
    cyberReceipt: sum((r) => r.cyberReceipt),
    assessValueCalc: sum((r) => r.assessValueCalc),
    assessValuePerBoe: sum((r) => r.assessValuePerBoe),
    assessValueDiff: sum((r) => r.assessValueDiff),
    landedTotal: totalLanded,
    totalSelling: sum((r) => r.totalSelling),
    avgCostPerPiece: totalQty > 0 ? totalLanded / totalQty : 0,
  };

  return {
    label,
    inputs,
    rows,
    totals,
    dutyFallbackCount: rows.filter((r) => r.dutyFellBackToActual).length,
  };
}

/** Convenience: the actual, un-simulated costing for a BOE. */
export function computeActual(
  boe: Boe,
  items: BoeItem[],
  variableFields: BoeVariableFields | null
): CostingResult {
  return computeCosting({
    label: "Actual",
    items,
    inputs: resolveActualInputs(boe, variableFields),
  });
}

/** Convenience: the costing implied by a saved scenario. */
export function computeScenario(
  boe: Boe,
  items: BoeItem[],
  variableFields: BoeVariableFields | null,
  scenario: Scenario,
  scenarioItems: ScenarioItem[]
): CostingResult {
  return computeCosting({
    label: scenario.name,
    items,
    inputs: resolveScenarioInputs(boe, variableFields, scenario),
    overrides: new Map(scenarioItems.map((si) => [itemKey(si.invsno, si.itemsn), si])),
  });
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type RowDelta = {
  key: string;
  sno: number;
  description: string;
  baseCostPerPiece: number;
  variantCostPerPiece: number;
  delta: number;
  deltaPct: number;
};

export type CostingComparison = {
  baseline: CostingResult;
  variant: CostingResult;
  totals: {
    landedTotal: number;
    dutyInCost: number;
    /** The whole pool, freight included. */
    expenseShare: number;
    freightShare: number;
    /** The pool excluding freight -- pairs with `freightShare`. */
    otherExpenseShare: number;
    payableInr: number;
    avgCostPerPiece: number;
    avgCostPerPiecePct: number;
  };
  rows: RowDelta[];
};

function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : Infinity;
  return ((to - from) / Math.abs(from)) * 100;
}

/**
 * Diffs a scenario against a baseline. Rows are matched on (invsno, itemsn);
 * an item present in only one side is reported with zero on the missing side
 * rather than being dropped, so nothing disappears from a comparison.
 */
export function compareCosting(
  baseline: CostingResult,
  variant: CostingResult
): CostingComparison {
  const byKey = new Map<string, { base?: CostRow; variant?: CostRow }>();
  for (const r of baseline.rows) byKey.set(r.key, { base: r });
  for (const r of variant.rows) {
    byKey.set(r.key, { ...(byKey.get(r.key) ?? {}), variant: r });
  }

  const rows: RowDelta[] = [...byKey.entries()]
    .map(([key, { base, variant: v }]) => {
      const baseCost = base?.costPerPiece ?? 0;
      const variantCost = v?.costPerPiece ?? 0;
      return {
        key,
        sno: base?.sno ?? v?.sno ?? 0,
        description: base?.description ?? v?.description ?? "",
        baseCostPerPiece: baseCost,
        variantCostPerPiece: variantCost,
        delta: variantCost - baseCost,
        deltaPct: pctChange(baseCost, variantCost),
      };
    })
    .sort((a, b) => a.sno - b.sno);

  return {
    baseline,
    variant,
    totals: {
      landedTotal: variant.totals.landedTotal - baseline.totals.landedTotal,
      dutyInCost: variant.totals.dutyInCost - baseline.totals.dutyInCost,
      expenseShare: variant.totals.expenseShare - baseline.totals.expenseShare,
      freightShare: variant.totals.freightShare - baseline.totals.freightShare,
      otherExpenseShare:
        variant.totals.otherExpenseShare - baseline.totals.otherExpenseShare,
      payableInr: variant.totals.payableInr - baseline.totals.payableInr,
      avgCostPerPiece: variant.totals.avgCostPerPiece - baseline.totals.avgCostPerPiece,
      avgCostPerPiecePct: pctChange(
        baseline.totals.avgCostPerPiece,
        variant.totals.avgCostPerPiece
      ),
    },
    rows,
  };
}
