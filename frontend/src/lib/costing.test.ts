import { describe, expect, it } from "vitest";

import {
  compareCosting,
  computeCosting,
  deriveDutyRates,
  itemKey,
  resolveActualInputs,
  resolveFreightTotal,
  resolveScenarioInputs,
} from "./costing";
import type { Boe, BoeItem, BoeVariableFields, Scenario, ScenarioItem } from "./types";

// ---------------------------------------------------------------------------
// Fixture
//
// Round numbers chosen so every expected value below is hand-computable.
//
//   exchange rate 100
//   item A: qty 2 @ $100 -> $200 -> INR 20,000   (share 0.4)
//   item B: qty 1 @ $300 -> $300 -> INR 30,000   (share 0.6)
//                            total    INR 50,000
//
//   expense pool: 5000 freight + 500 insurance + 1000 clearance + 500 misc
//                 + 1000 supplier freight + 500 bank + 500 own bank = 9,000
//
// Actual duty is set to exactly what the derived rates would produce for the
// unmodified scenario (BCD 10% of assessable, SWS 10% of BCD, IGST 18%), so
// "derived with nothing changed" must equal "locked".
// ---------------------------------------------------------------------------

const boe: Boe = {
  be_no: "8555370",
  be_date: "2026-04-08",
  port_code: null,
  importer_name: "FERRARI VIDEO",
  supplier_name: "FOCAL JM LAB",
  inv_no: "2242026",
  inv_date: "2026-02-24",
  inv_value_usd: 500,
  freight_inr: 5000,
  insurance_inr: 500,
  misc_charges_inr: 500,
  exchange_rate: 100,
  hawb_no: "870002539200",
  total_assess_value: 56000,
  total_duty: 0,
  created_at: "",
  updated_at: "",
};

const itemA: BoeItem = {
  id: 1,
  be_no: "8555370",
  global_sno: 1,
  invsno: 1,
  itemsn: 1,
  cth: null,
  description: "HEADPHONE UTOPIA",
  unit_price_usd: 100,
  qty: 2,
  uqc: "NOS",
  assess_value: 22400,
  bcd: 2240,
  bcd_forgone: null,
  sws: 224,
  igst: 4475.52,
  total_duty: null,
};

const itemB: BoeItem = {
  id: 2,
  be_no: "8555370",
  global_sno: 2,
  invsno: 1,
  itemsn: 2,
  cth: null,
  description: "STELLIA EARPADS",
  unit_price_usd: 300,
  qty: 1,
  uqc: "NOS",
  assess_value: 33600,
  bcd: 3360,
  bcd_forgone: null,
  sws: 336,
  igst: 6713.28,
  total_duty: null,
};

const items = [itemA, itemB];

const variableFields: BoeVariableFields = {
  be_no: "8555370",
  updated_at: "",
  exchange_rate: null,
  freight_charges: null,
  clearing_charges: 1000,
  supplier_freight: 1000,
  bank_charges: 500,
  own_bank_charges: 500,
  exchange_rate_status: "provisional",
  freight_charges_status: "provisional",
  clearing_charges_status: "fixed",
  supplier_freight_status: "provisional",
  bank_charges_status: "provisional",
  own_bank_charges_status: "provisional",
};

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "s1",
    be_no: "8555370",
    name: "Simulation 1",
    notes: null,
    duty_mode: "derived",
    exchange_rate: null,
    exchange_rate_is_actual: false,
    freight_is_actual: false,
    freight_mode: "AIR",
    freight_basis: "LUMP_SUM",
    freight_rate: null,
    freight_quantity: null,
    freight_total_inr: null,
    insurance_inr: null,
    clearance_inr: null,
    other_charges_inr: null,
    misc_charges_inr: null,
    supplier_freight_inr: null,
    bank_charges_inr: null,
    own_bank_charges_inr: null,
    margin_pct: 2,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function scenarioItem(overrides: Partial<ScenarioItem> & Pick<ScenarioItem, "invsno" | "itemsn">): ScenarioItem {
  return {
    id: 1,
    scenario_id: "s1",
    unit_price_usd: null,
    qty: null,
    is_foc: false,
    foc_bears_duty: true,
    description: null,
    source_itemsn: null,
    ...overrides,
  };
}

const actualInputs = () => resolveActualInputs(boe, variableFields);

const actual = () => computeCosting({ label: "Actual", items, inputs: actualInputs() });

const simulate = (s: Scenario, si: ScenarioItem[] = []) =>
  computeCosting({
    label: s.name,
    items,
    inputs: resolveScenarioInputs(boe, variableFields, s),
    overrides: new Map(si.map((x) => [itemKey(x.invsno, x.itemsn), x])),
  });

// ---------------------------------------------------------------------------

describe("deriveDutyRates", () => {
  it("derives rates from cash BCD", () => {
    const r = deriveDutyRates(itemA);
    expect(r.bcdEffective).toBe(2240);
    expect(r.bcdPct).toBeCloseTo(0.1, 10);
    expect(r.swsPct).toBeCloseTo(0.1, 10);
    expect(r.igstPct).toBeCloseTo(0.18, 10);
    expect(r.canDerive).toBe(true);
  });

  it("uses the licence-foregone amount when cash BCD is nil", () => {
    // The Part IV Section G rule: BCD of 0 with a foregone amount means the
    // duty was paid with a licence, not that it was free.
    const licenceItem: BoeItem = { ...itemA, bcd: 0, bcd_forgone: 14642.5 };
    const r = deriveDutyRates(licenceItem);
    expect(r.bcdEffective).toBe(14642.5);
    expect(r.bcdPct).toBeCloseTo(14642.5 / 22400, 10);
  });

  it("refuses to derive without an assessable value", () => {
    const r = deriveDutyRates({ ...itemA, assess_value: null });
    expect(r.canDerive).toBe(false);
    expect(r.bcdPct).toBe(0);
  });
});

describe("expense pool", () => {
  it("includes supplier freight, bank charges and own bank charges", () => {
    // Regression guard. The Excel template computes I9 = I8+I7+I6+I5, which
    // omits these three -- they were captured and then never costed. If this
    // ever reads 6000 again, the bug is back.
    const pool = actualInputs().expenses;
    expect(pool.total).toBe(9000);
    expect(pool.supplierFreight).toBe(1000);
    expect(pool.bankCharges).toBe(500);
    expect(pool.ownBankCharges).toBe(500);
  });

  it("apportions the whole pool and nothing more", () => {
    const result = actual();
    expect(result.totals.expenseShare).toBeCloseTo(9000, 8);
    expect(result.totals.freightShare).toBeCloseTo(5000, 8);
  });

  it("splits into freight and everything-else without overlap", () => {
    // The table reports Freight and Expenses as separate columns, so the two
    // must partition the pool exactly -- no double counting, nothing dropped.
    const { rows, totals } = actual();
    for (const r of rows) {
      expect(r.freightShare + r.otherExpenseShare).toBeCloseTo(r.expenseShare, 8);
    }
    expect(totals.freightShare + totals.otherExpenseShare).toBeCloseTo(
      totals.expenseShare,
      8
    );
    // Pool is 9,000 of which 5,000 is freight.
    expect(totals.freightShare).toBeCloseTo(5000, 8);
    expect(totals.otherExpenseShare).toBeCloseTo(4000, 8);
  });

  it("prefers an operator-set variable field over the parsed BOE value", () => {
    const withOverride = resolveActualInputs(boe, {
      ...variableFields,
      freight_charges: 7500,
    });
    expect(withOverride.expenses.freight).toBe(7500);
  });
});

describe("actual costing", () => {
  it("reproduces the C-SHEET formula chain", () => {
    const { rows, totals } = actual();
    const [a, b] = rows;

    // A: 20,000 declared, share 0.4, expenses 3,600, duty 2,240 + 224
    expect(a.declaredInr).toBeCloseTo(20000, 8);
    expect(a.share).toBeCloseTo(0.4, 10);
    expect(a.expenseShare).toBeCloseTo(3600, 8);
    expect(a.dutyInCost).toBeCloseTo(2464, 8);
    expect(a.landedTotal).toBeCloseTo(26064, 8);
    expect(a.costPerPiece).toBeCloseTo(13032, 8);
    expect(a.sellingPerPiece).toBeCloseTo(13292.64, 6);

    // B: 30,000 declared, share 0.6, expenses 5,400, duty 3,360 + 336
    expect(b.expenseShare).toBeCloseTo(5400, 8);
    expect(b.landedTotal).toBeCloseTo(39096, 8);
    expect(b.costPerPiece).toBeCloseTo(39096, 8);

    expect(totals.landedTotal).toBeCloseTo(65160, 8);
    expect(totals.avgCostPerPiece).toBeCloseTo(21720, 8);
  });

  it("excludes IGST from cost but reports it in the cyber receipt", () => {
    const [a] = actual().rows;
    expect(a.dutyInCost).toBeCloseTo(a.bcd + a.sws, 10);
    expect(a.dutyInCost).not.toBeCloseTo(a.bcd + a.sws + a.igst, 2);
    expect(a.cyberReceipt).toBeCloseTo(224 + 4475.52, 6);
  });

  it("reconciles computed assessable value against the BOE", () => {
    const [a] = actual().rows;
    // 20,000 + freight 2,000 + misc 200 + insurance 200 = 22,400
    expect(a.assessValueCalc).toBeCloseTo(22400, 8);
    expect(a.assessValueDiff).toBeCloseTo(0, 8);
  });
});

/**
 * The same BOE can be costed two ways: here, and by the Excel workbook that
 * `GET /boe/{be_no}/excel` serves from the C-SHEET template. Both are shown
 * to the same user from the same page, so they have to agree.
 *
 * These evaluate the workbook's own formulas by hand and check this engine
 * lands on the same numbers. The pool is the part that drifted: the template
 * shipped with `I9 = I8+I7+I6+I5`, leaving out misc charges (K5) and the
 * supplier freight / bank charges / own bank charges in K6:K8 -- captured on
 * the sheet, then dropped from cost per piece.
 */
describe("C-SHEET parity", () => {
  // I5 + I6 + I7 + I8 + K5 + K6 + K7 + K8
  const POOL = 5000 + 500 + 1000 + 0 + 500 + 1000 + 500 + 500;

  // F = D * $D$5 * C -- rate x exchange rate x qty
  const F = items.map((i) => i.unit_price_usd! * 100 * i.qty!);
  const SUM_F = F.reduce((a, b) => a + b, 0);

  it("apportions the pool the workbook's I9 now sums", () => {
    expect(POOL).toBe(9000);
    expect(actualInputs().expenses.total).toBe(POOL);
  });

  it("matches the workbook's cost per piece on every row", () => {
    // I = (F + G + H) / C, where H = $I$9 / $F$total * F and G = BCD + SWS
    const expected = items.map((item, n) => {
      const H = (POOL / SUM_F) * F[n];
      const G = item.bcd! + item.sws!;
      return (F[n] + G + H) / item.qty!;
    });

    actual().rows.forEach((row, n) => {
      expect(row.costPerPiece).toBeCloseTo(expected[n], 9);
    });
  });

  it("matches the workbook's assessable value column (O = F + L + M + N)", () => {
    const { freight, misc, insurance } = actualInputs().expenses;
    const expected = items.map((_, n) => {
      const share = F[n] / SUM_F;
      return F[n] + freight * share + misc * share + insurance * share;
    });

    actual().rows.forEach((row, n) => {
      expect(row.assessValueCalc).toBeCloseTo(expected[n], 9);
    });
  });
});

describe("scenario inheritance", () => {
  it("reproduces the actual costing when nothing is changed", () => {
    const sim = simulate(scenario({ duty_mode: "locked" }));
    expect(sim.totals.landedTotal).toBeCloseTo(actual().totals.landedTotal, 8);
  });

  it("derived duty equals locked duty when no value has moved", () => {
    // The key invariant: switching duty mode alone must not move the numbers.
    // If it does, the back-computed rates disagree with the actual amounts.
    const derived = simulate(scenario({ duty_mode: "derived" }));
    const locked = simulate(scenario({ duty_mode: "locked" }));
    expect(derived.totals.dutyInCost).toBeCloseTo(locked.totals.dutyInCost, 6);
    expect(derived.totals.igst).toBeCloseTo(locked.totals.igst, 6);
  });
});

describe("exchange rate scenarios", () => {
  it("moves duty with value in derived mode", () => {
    const base = simulate(scenario({ duty_mode: "derived" }));
    const weaker = simulate(scenario({ duty_mode: "derived", exchange_rate: 110 }));

    expect(weaker.totals.declaredInr).toBeCloseTo(55000, 8);
    expect(weaker.totals.dutyInCost).toBeGreaterThan(base.totals.dutyInCost);

    // BCD must still be exactly 10% of the newly assessed value.
    const [a] = weaker.rows;
    expect(a.bcd).toBeCloseTo(a.assessValueCalc * 0.1, 8);
  });

  it("holds duty flat in locked mode", () => {
    const base = simulate(scenario({ duty_mode: "locked" }));
    const weaker = simulate(scenario({ duty_mode: "locked", exchange_rate: 110 }));

    expect(weaker.totals.declaredInr).toBeCloseTo(55000, 8);
    expect(weaker.totals.dutyInCost).toBeCloseTo(base.totals.dutyInCost, 8);
    // ...but landed cost still rises, because the goods themselves cost more.
    expect(weaker.totals.landedTotal).toBeGreaterThan(base.totals.landedTotal);
  });

  it("falls back to actual duty when an item has no assessable value", () => {
    const noBasis = [{ ...itemA, assess_value: null }, itemB];
    const result = computeCosting({
      label: "sim",
      items: noBasis,
      inputs: resolveScenarioInputs(boe, variableFields, scenario({ duty_mode: "derived" })),
    });
    expect(result.dutyFallbackCount).toBe(1);
    // Held at the actual amount rather than silently zeroed.
    expect(result.rows[0].bcd).toBe(2240);
    expect(result.rows[0].dutyFellBackToActual).toBe(true);
  });
});

describe("FOC items", () => {
  it("zeroes the price but keeps the freight share and the duty", () => {
    const sim = simulate(scenario({ duty_mode: "locked" }), [
      scenarioItem({ invsno: 1, itemsn: 1, is_foc: true, foc_bears_duty: true }),
    ]);
    const [a] = sim.rows;

    expect(a.payableInr).toBe(0);
    expect(a.declaredInr).toBeCloseTo(20000, 8); // still declared to customs
    expect(a.share).toBeCloseTo(0.4, 10); // still absorbs its share
    expect(a.expenseShare).toBeCloseTo(3600, 8);
    expect(a.dutyInCost).toBeCloseTo(2464, 8);
    expect(a.landedTotal).toBeCloseTo(6064, 8);
    expect(a.costPerPiece).toBeCloseTo(3032, 8);
  });

  it("waives duty when the FOC item is toggled to bear none", () => {
    const sim = simulate(scenario({ duty_mode: "locked" }), [
      scenarioItem({ invsno: 1, itemsn: 1, is_foc: true, foc_bears_duty: false }),
    ]);
    const [a] = sim.rows;

    expect(a.bcd).toBe(0);
    expect(a.sws).toBe(0);
    expect(a.igst).toBe(0);
    expect(a.landedTotal).toBeCloseTo(3600, 8);
    expect(a.costPerPiece).toBeCloseTo(1800, 8);
  });

  it("does not shift the freight burden onto the paid items", () => {
    const base = simulate(scenario({ duty_mode: "locked" }));
    const withFoc = simulate(scenario({ duty_mode: "locked" }), [
      scenarioItem({ invsno: 1, itemsn: 1, is_foc: true }),
    ]);
    expect(withFoc.rows[1].expenseShare).toBeCloseTo(base.rows[1].expenseShare, 8);
  });
});

describe("item price overrides", () => {
  it("re-apportions expenses when one item's price changes", () => {
    // A doubles to $200/pc -> 40,000 INR; total 70,000; A share 4/7.
    const sim = simulate(scenario({ duty_mode: "locked" }), [
      scenarioItem({ invsno: 1, itemsn: 1, unit_price_usd: 200 }),
    ]);
    const [a, b] = sim.rows;
    expect(a.declaredInr).toBeCloseTo(40000, 8);
    expect(a.share).toBeCloseTo(4 / 7, 10);
    expect(a.expenseShare).toBeCloseTo(9000 * (4 / 7), 8);
    expect(b.expenseShare).toBeCloseTo(9000 * (3 / 7), 8);
    expect(a.expenseShare + b.expenseShare).toBeCloseTo(9000, 8);
  });
});

describe("duplicated items", () => {
  // A copy of item A: same $100 x 2, added as itemsn 5 pointing back at item 1.
  const copyOfA = () =>
    scenarioItem({
      invsno: 1,
      itemsn: 5,
      source_itemsn: 1,
      description: "HEADPHONE UTOPIA (copy)",
      unit_price_usd: 100,
      qty: 2,
    });

  it("adds a third row and re-apportions across all three", () => {
    const sim = simulate(scenario({ duty_mode: "locked" }), [copyOfA()]);

    expect(sim.rows).toHaveLength(3);
    const added = sim.rows.find((r) => r.isAdded)!;
    expect(added.description).toBe("HEADPHONE UTOPIA (copy)");

    // Declared total goes 50,000 -> 70,000; the copy takes 20/70.
    expect(sim.totals.declaredInr).toBeCloseTo(70000, 8);
    expect(added.share).toBeCloseTo(2 / 7, 10);
    expect(sim.totals.expenseShare).toBeCloseTo(9000, 8);
  });

  it("derives the copy's duty even when the scenario locks duty", () => {
    // Locking a copy to its source's actual amounts would charge the same
    // customs payment twice. It must always derive instead.
    const sim = simulate(scenario({ duty_mode: "locked" }), [copyOfA()]);
    const added = sim.rows.find((r) => r.isAdded)!;

    expect(added.bcd).toBeCloseTo(added.assessValueCalc * 0.1, 8);
    expect(added.bcd).not.toBeCloseTo(2240, 1); // not the source's actual
    expect(added.sws).toBeCloseTo(added.bcd * 0.1, 8);
  });

  it("has nothing to reconcile against the BOE", () => {
    const sim = simulate(scenario({ duty_mode: "locked" }), [copyOfA()]);
    const added = sim.rows.find((r) => r.isAdded)!;
    expect(added.assessValuePerBoe).toBe(0);
  });

  it("sorts copies after every real item", () => {
    const sim = simulate(scenario({ duty_mode: "locked" }), [copyOfA()]);
    expect(sim.rows.map((r) => r.isAdded)).toEqual([false, false, true]);
  });

  it("drops a copy whose source item no longer exists", () => {
    // Rather than guessing at duty rates it has no basis for.
    const orphan = scenarioItem({
      invsno: 1,
      itemsn: 9,
      source_itemsn: 77,
      unit_price_usd: 100,
      qty: 1,
    });
    const sim = simulate(scenario({ duty_mode: "locked" }), [orphan]);
    expect(sim.rows).toHaveLength(2);
  });

  it("charges no duty on a copy of an item that has no assessable value", () => {
    const noBasis = [{ ...itemA, assess_value: null }, itemB];
    const result = computeCosting({
      label: "sim",
      items: noBasis,
      inputs: resolveScenarioInputs(boe, variableFields, scenario({ duty_mode: "locked" })),
      overrides: new Map([[itemKey(1, 5), copyOfA()]]),
    });
    const added = result.rows.find((r) => r.isAdded)!;
    expect(added.bcd).toBe(0);
    expect(added.sws).toBe(0);
    expect(added.igst).toBe(0);
  });
});

describe("freight modelling", () => {
  it("uses the typed total for a lump sum", () => {
    expect(
      resolveFreightTotal({
        freight_basis: "LUMP_SUM",
        freight_rate: null,
        freight_quantity: null,
        freight_total_inr: 38161,
      })
    ).toBe(38161);
  });

  it("computes air freight as rate x chargeable weight", () => {
    expect(
      resolveFreightTotal({
        freight_basis: "PER_KG",
        freight_rate: 450,
        freight_quantity: 84.8,
        freight_total_inr: null,
      })
    ).toBeCloseTo(38160, 6);
  });

  it("computes sea freight as rate x CBM", () => {
    expect(
      resolveFreightTotal({
        freight_basis: "PER_CBM",
        freight_rate: 12000,
        freight_quantity: 2.4,
        freight_total_inr: null,
      })
    ).toBeCloseTo(28800, 6);
  });

  it("keeps the typed total when the calculator is only half filled in", () => {
    expect(
      resolveFreightTotal({
        freight_basis: "PER_KG",
        freight_rate: 450,
        freight_quantity: null,
        freight_total_inr: 38161,
      })
    ).toBe(38161);
  });

  // Picking a basis is not a freight figure. Before this was pinned down,
  // selecting "Per kg" and typing nothing dropped the actual freight out of
  // the pool entirely, while the control still offered it as the placeholder.
  it("inherits the actual freight when only the basis has been picked", () => {
    const s = scenario({ freight_basis: "PER_KG" });
    expect(resolveScenarioInputs(boe, variableFields, s).expenses.freight).toBe(5000);
  });

  it("inherits the actual freight when the calculator is only half filled in", () => {
    const s = scenario({ freight_basis: "PER_KG", freight_rate: 450 });
    expect(resolveScenarioInputs(boe, variableFields, s).expenses.freight).toBe(5000);
  });

  it("lets a typed zero mean zero rather than inheriting", () => {
    const s = scenario({ freight_total_inr: 0 });
    expect(resolveScenarioInputs(boe, variableFields, s).expenses.freight).toBe(0);
  });

  it("prefers a completed calculator over the typed total", () => {
    const s = scenario({
      freight_basis: "PER_KG",
      freight_rate: 100,
      freight_quantity: 30,
      freight_total_inr: 38161,
    });
    expect(resolveScenarioInputs(boe, variableFields, s).expenses.freight).toBe(3000);
  });

  it("re-apportions a changed freight charge across items by value share", () => {
    // Freight 5,000 -> 20,000, so the pool goes 9,000 -> 24,000. Every item's
    // slice must move in proportion to its value share, and the slices must
    // still add back up to exactly what was charged.
    const sim = simulate(
      scenario({ duty_mode: "locked", freight_total_inr: 20000 })
    );
    const [a, b] = sim.rows;

    expect(a.share).toBeCloseTo(0.4, 10);
    expect(b.share).toBeCloseTo(0.6, 10);

    expect(a.freightShare).toBeCloseTo(8000, 8);
    expect(b.freightShare).toBeCloseTo(12000, 8);
    expect(a.freightShare + b.freightShare).toBeCloseTo(20000, 8);

    expect(a.expenseShare).toBeCloseTo(24000 * 0.4, 8);
    expect(b.expenseShare).toBeCloseTo(24000 * 0.6, 8);
    expect(sim.totals.expenseShare).toBeCloseTo(24000, 8);

    // ...and the extra 15,000 lands on cost per piece in the same proportion.
    const base = actual();
    expect(a.costPerPiece - base.rows[0].costPerPiece).toBeCloseTo((15000 * 0.4) / 2, 8);
    expect(b.costPerPiece - base.rows[1].costPerPiece).toBeCloseTo(15000 * 0.6, 8);
  });

  it("re-apportions freight by the NEW proportions when a price also changes", () => {
    // A doubles to $200/pc, so shares become 4/7 and 3/7. The freight split
    // must follow the new proportions, not the original ones.
    const sim = simulate(scenario({ duty_mode: "locked", freight_total_inr: 20000 }), [
      scenarioItem({ invsno: 1, itemsn: 1, unit_price_usd: 200 }),
    ]);
    const [a, b] = sim.rows;

    expect(a.freightShare).toBeCloseTo(20000 * (4 / 7), 8);
    expect(b.freightShare).toBeCloseTo(20000 * (3 / 7), 8);
    expect(a.freightShare + b.freightShare).toBeCloseTo(20000, 8);
  });

  it("apportions a rate-calculated freight total the same way as a typed one", () => {
    const typed = simulate(scenario({ duty_mode: "locked", freight_total_inr: 28800 }));
    const calculated = simulate(
      scenario({
        duty_mode: "locked",
        freight_basis: "PER_CBM",
        freight_rate: 12000,
        freight_quantity: 2.4,
      })
    );
    expect(calculated.rows[0].freightShare).toBeCloseTo(typed.rows[0].freightShare, 8);
    expect(calculated.totals.landedTotal).toBeCloseTo(typed.totals.landedTotal, 8);
  });

  it("makes sea freight cheaper per piece than air", () => {
    const air = simulate(
      scenario({ name: "Air", freight_mode: "AIR", freight_basis: "PER_KG", freight_rate: 450, freight_quantity: 84.8 })
    );
    const sea = simulate(
      scenario({ name: "Sea", freight_mode: "SEA", freight_basis: "PER_CBM", freight_rate: 12000, freight_quantity: 2.4 })
    );
    expect(sea.totals.avgCostPerPiece).toBeLessThan(air.totals.avgCostPerPiece);
  });
});

describe("compareCosting", () => {
  it("reports per-row and total deltas against the baseline", () => {
    const base = actual();
    const variant = simulate(scenario({ duty_mode: "locked", exchange_rate: 110 }));
    const cmp = compareCosting(base, variant);

    expect(cmp.rows).toHaveLength(2);
    expect(cmp.totals.landedTotal).toBeCloseTo(
      variant.totals.landedTotal - base.totals.landedTotal,
      8
    );
    expect(cmp.totals.avgCostPerPiece).toBeGreaterThan(0);
    expect(cmp.rows[0].delta).toBeCloseTo(
      variant.rows[0].costPerPiece - base.rows[0].costPerPiece,
      8
    );
  });

  it("keeps an item that exists on only one side", () => {
    const base = actual();
    const variant = computeCosting({
      label: "one item",
      items: [itemA],
      inputs: actualInputs(),
    });
    const cmp = compareCosting(base, variant);
    expect(cmp.rows).toHaveLength(2);
    expect(cmp.rows[1].variantCostPerPiece).toBe(0);
  });
});
