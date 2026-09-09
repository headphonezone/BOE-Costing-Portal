"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  compareCosting,
  computeActual,
  computeCosting,
  itemKey,
  resolveActualInputs,
  resolveScenarioInputs,
  type CostingResult,
  type CostRow,
} from "@/lib/costing";
import { downloadSimulationExcel } from "@/lib/export";
import { LockedScenarioPanel, ScenarioLockControl } from "@/components/ScenarioLock";
import { FirstSavePasswordPrompt, ScenarioList } from "@/components/ScenarioList";
import type { ScenarioIndexEntry } from "@/lib/scenarios";
import { inr, pct } from "@/lib/format";
import {
  createScenario,
  deleteScenario,
  duplicateScenario,
  nextScenarioName,
  replaceScenarioItems,
  updateScenario,
} from "@/lib/scenarios";
import type { Boe, BoeItem, BoeVariableFields, ScenarioItem, ScenarioWithItems } from "@/lib/types";
import { ComparisonStrip } from "./ComparisonStrip";
import { CostingTable } from "./CostingTable";
import { ScenarioControls } from "./ScenarioControls";
import { ScenarioItemsTable, type ItemPatch } from "./ScenarioItemsTable";

/**
 * An override carrying no actual change is not worth a row in the database.
 * A duplicated row is never empty -- the row IS the change, so dropping it
 * would delete the item.
 */
function isEmptyOverride(o: ScenarioItem): boolean {
  if (o.source_itemsn != null) return false;
  return o.unit_price_usd == null && o.qty == null && !o.is_foc && o.foc_bears_duty;
}

export function SimulationWorkbench({
  boe,
  items,
  variableFields,
  initialScenarios,
  initialIndex,
  isAdmin,
}: {
  boe: Boe;
  items: BoeItem[];
  variableFields: BoeVariableFields | null;
  initialScenarios: ScenarioWithItems[];
  /** Every scenario on this BOE, locked ones included -- see listScenarioIndex. */
  initialIndex: ScenarioIndexEntry[];
  isAdmin: boolean;
}) {
  const [scenarios, setScenarios] = useState(initialScenarios);
  // Not state: every lock change reloads the page, because the grant lives in
  // the database and the body has to be re-fetched with it. Local state would
  // only be a second, staler copy of what the server just sent.
  const index = initialIndex;
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * Where a BOE with existing simulations opens.
   *
   * Landing straight in one of several simulations means picking for the
   * reader, and picking wrong: which of "Q3 revised" and "supplier B" they
   * wanted is not something this component can know. So a BOE that has any
   * simulations opens on the list of them, by name, and a BOE that has none
   * opens where it always did -- on the invitation to make the first one.
   */
  const [view, setView] = useState<"list" | "workbench">(
    initialIndex.length > 0 ? "list" : "workbench"
  );
  /**
   * Scenarios created in this session and not yet saved once.
   *
   * A password is offered at the end of the first save rather than from a
   * button somewhere on the toolbar: at that moment the reader has just
   * decided the simulation is worth keeping, which is the only moment they
   * have an opinion about who else should see it.
   */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [passwordPrompt, setPasswordPrompt] = useState<{ id: string; name: string } | null>(
    null
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The scenario controls are a workbench, not a permanent fixture. They open
   * while a scenario is being set up and fold away once it is saved, because
   * the 300px they occupy is exactly what pushed the item table into
   * horizontal scrolling -- the columns you need to read are the ones that
   * fell off the right edge.
   */
  const [editing, setEditing] = useState(false);

  /** Switching scenarios shows the saved result, not the editor. */
  function selectScenario(id: string) {
    setActiveId(id);
    setEditing(false);
    setView("workbench");
  }

  /** Back to the list, without losing anything typed but unsaved. */
  function backToList() {
    setEditing(false);
    setView("list");
  }

  const actualInputs = useMemo(
    () => resolveActualInputs(boe, variableFields),
    [boe, variableFields]
  );
  const baseline = useMemo(
    () => computeActual(boe, items, variableFields),
    [boe, items, variableFields]
  );

  // Every scenario is costed on every render. The engine is pure arithmetic
  // over a few dozen rows, so this is far cheaper than round-tripping to the
  // server, and it is what makes the controls feel live.
  const results = useMemo(() => {
    const map = new Map<string, CostingResult>();
    for (const s of scenarios) {
      map.set(
        s.id,
        computeCosting({
          label: s.name,
          items,
          inputs: resolveScenarioInputs(boe, variableFields, s),
          overrides: new Map(s.items.map((si) => [itemKey(si.invsno, si.itemsn), si])),
        })
      );
    }
    return map;
  }, [scenarios, boe, items, variableFields]);

  const active = scenarios.find((s) => s.id === activeId) ?? null;
  // A locked scenario has an index entry but no body -- the policy withheld
  // it -- so this is how "selected but not openable" is told apart from
  // "nothing selected".
  const lockedEntry =
    !active && activeId
      ? index.find((e) => e.id === activeId && e.is_locked && !e.has_access) ?? null
      : null;
  const activeEntry = index.find((e) => e.id === activeId) ?? null;
  const activeResult = active ? results.get(active.id)! : null;
  const comparison = activeResult ? compareCosting(baseline, activeResult) : null;

  const overrides = useMemo(
    () => new Map((active?.items ?? []).map((si) => [itemKey(si.invsno, si.itemsn), si])),
    [active]
  );

  function markDirty(id: string) {
    setDirty((prev) => new Set(prev).add(id));
  }

  function patchScenario(patch: Partial<ScenarioWithItems>) {
    if (!active) return;
    setScenarios((prev) =>
      prev.map((s) => (s.id === active.id ? { ...s, ...patch } : s))
    );
    markDirty(active.id);
  }

  function patchItem(invsno: number, itemsn: number, patch: ItemPatch) {
    if (!active) return;
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id !== active.id) return s;
        const idx = s.items.findIndex((i) => i.invsno === invsno && i.itemsn === itemsn);
        const existing: ScenarioItem =
          idx >= 0
            ? s.items[idx]
            : {
                id: -Date.now(),
                scenario_id: s.id,
                invsno,
                itemsn,
                unit_price_usd: null,
                qty: null,
                is_foc: false,
                foc_bears_duty: true,
                description: null,
                source_itemsn: null,
              };
        const next = { ...existing, ...patch };
        const list = idx >= 0 ? s.items.map((i, n) => (n === idx ? next : i)) : [...s.items, next];
        return { ...s, items: list };
      })
    );
    markDirty(active.id);
  }

  /**
   * Adds a copy of a row as an extra item in this scenario only. The copy
   * carries its own price, quantity and description rather than inheriting,
   * so it stands alone; `source_itemsn` points at the real BOE item, which is
   * where its duty rates come from. Duplicating a copy points at the same
   * original, never at the copy, so the chain never goes stale.
   */
  function duplicateItem(row: CostRow) {
    if (!active) return;
    const sourceOverride = active.items.find(
      (i) => i.invsno === row.invsno && i.itemsn === row.itemsn
    );
    const source_itemsn = sourceOverride?.source_itemsn ?? row.itemsn;

    const used = [
      ...items.filter((i) => i.invsno === row.invsno).map((i) => i.itemsn),
      ...active.items.filter((i) => i.invsno === row.invsno).map((i) => i.itemsn),
    ];
    const itemsn = Math.max(0, ...used) + 1;

    setScenarios((prev) =>
      prev.map((s) =>
        s.id === active.id
          ? {
              ...s,
              items: [
                ...s.items,
                {
                  id: -Date.now(),
                  scenario_id: s.id,
                  invsno: row.invsno,
                  itemsn,
                  source_itemsn,
                  description: `${row.description} (copy)`,
                  unit_price_usd: row.unitPriceUsd,
                  qty: row.qty,
                  is_foc: row.isFoc,
                  foc_bears_duty: true,
                },
              ],
            }
          : s
      )
    );
    markDirty(active.id);
  }

  function resetItem(invsno: number, itemsn: number) {
    if (!active) return;
    setScenarios((prev) =>
      prev.map((s) =>
        s.id === active.id
          ? { ...s, items: s.items.filter((i) => !(i.invsno === invsno && i.itemsn === itemsn)) }
          : s
      )
    );
    markDirty(active.id);
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    await run(async () => {
      const created = await createScenario(boe.be_no, nextScenarioName(scenarios));
      setScenarios((prev) => [...prev, created]);
      setActiveId(created.id);
      setFresh((prev) => new Set(prev).add(created.id));
      setEditing(true);
      setView("workbench");
    });
  }

  async function handleDuplicate() {
    if (!active) return;
    await run(async () => {
      const copy = await duplicateScenario(active, nextScenarioName(scenarios));
      setScenarios((prev) => [...prev, copy]);
      setActiveId(copy.id);
      setFresh((prev) => new Set(prev).add(copy.id));
      setEditing(true);
      setView("workbench");
    });
  }

  async function handleSave() {
    if (!active) return;
    await run(async () => {
      const { items: overrideRows, ...fields } = active;
      const saved = await updateScenario(active.id, fields);
      const keep = overrideRows.filter((o) => !isEmptyOverride(o));
      const persisted = await replaceScenarioItems(
        active.id,
        keep.map(
          ({
            invsno,
            itemsn,
            unit_price_usd,
            qty,
            is_foc,
            foc_bears_duty,
            description,
            source_itemsn,
          }) => ({
            invsno,
            itemsn,
            unit_price_usd,
            qty,
            is_foc,
            foc_bears_duty,
            description,
            source_itemsn,
          })
        )
      );
      setScenarios((prev) =>
        prev.map((s) => (s.id === active.id ? { ...saved, items: persisted } : s))
      );
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(active.id);
        return next;
      });
      setEditing(false);

      // First save of a simulation created in this session: offer a password
      // once, here, and never ask again. Declining is a real answer -- most
      // simulations are working notes and a password on each would be noise.
      if (fresh.has(active.id)) {
        setFresh((prev) => {
          const next = new Set(prev);
          next.delete(active.id);
          return next;
        });
        setPasswordPrompt({ id: active.id, name: saved.name });
      }
    });
  }

  async function handleDelete() {
    if (!active) return;
    if (!window.confirm(`Delete "${active.name}"? This cannot be undone.`)) return;
    await run(async () => {
      await deleteScenario(active.id);
      const remaining = scenarios.filter((s) => s.id !== active.id);
      setScenarios(remaining);
      setActiveId(null);
      setEditing(false);
      // Back to the list rather than into whichever simulation happened to be
      // next: after a deletion the reader is choosing again, not continuing.
      setView(index.length > 1 ? "list" : "workbench");
    });
  }

  const isDirty = active ? dirty.has(active.id) : false;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {passwordPrompt && (
        <FirstSavePasswordPrompt
          scenarioId={passwordPrompt.id}
          scenarioName={passwordPrompt.name}
          onDone={(didSet) => {
            setPasswordPrompt(null);
            // Only a password that was actually set changes what the server
            // would send; skipping leaves the page already correct.
            if (didSet) window.location.reload();
          }}
        />
      )}

      {/* Scenario tabs, only once something is open --------------------- */}
      {view === "workbench" && (
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        {index.length > 0 && (
          <button
            type="button"
            onClick={backToList}
            className="mr-1 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted transition hover:border-blue-400 hover:text-foreground"
          >
            &larr; All simulations
          </button>
        )}
        {/* From the index, not the loaded scenarios: a locked one has no body
            to load but must still be listed, or the count would be wrong and a
            colleague's simulation would appear not to exist. */}
        {index.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => selectScenario(e.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              e.id === activeId
                ? "bg-blue-600 text-white"
                : "border border-line bg-surface hover:border-blue-400"
            }`}
          >
            {e.name}
            {e.is_locked && !e.has_access && (
              <span className="ml-1.5 opacity-70" aria-label="locked">&#128274;</span>
            )}
            {dirty.has(e.id) && <span className="ml-1.5 text-amber-400">&bull;</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-blue-400 hover:text-foreground disabled:opacity-50"
        >
          + New simulation
        </button>
      </div>
      )}

      {view === "list" ? (
        <ScenarioList
          entries={index}
          onOpen={selectScenario}
          onCreate={handleCreate}
          busy={busy}
        />
      ) : lockedEntry ? (
        <LockedScenarioPanel
          entry={lockedEntry}
          isAdmin={isAdmin}
          // A full reload rather than local state: the grant lives in the
          // database, and the scenario body has to be fetched by the server
          // with that grant in place before anything can be shown.
          onUnlocked={() => window.location.reload()}
        />
      ) : !active ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm text-muted">
            No simulations saved for this BOE yet.
          </p>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            Create Simulation 1
          </button>
        </div>
      ) : (
        <>
          {comparison && <ComparisonStrip comparison={comparison} scenario={active} />}

          {activeResult && activeResult.dutyFallbackCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {activeResult.dutyFallbackCount} item
              {activeResult.dutyFallbackCount === 1 ? " has" : "s have"} no assessable value on
              record, so their duty is held at the actual amount instead of floating with value.
            </div>
          )}

          {/* Toolbar. Every action for the active scenario lives here, at a
              fixed place at the top, rather than moving with the panel that
              folds away underneath it. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold">{active.name}</h2>
                {isDirty && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                    unsaved
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">
                {active.notes ||
                  (editing
                    ? "Adjust the inputs on the left; the tables update as you type."
                    : "Saved. Choose Edit to change the inputs behind this costing.")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy || !isDirty}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={busy}
                    className="rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                    title={isDirty ? "Hide the inputs. Unsaved changes are kept." : "Hide the inputs."}
                  >
                    Close inputs
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    disabled={busy}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Delete
                  </button>
                </>
              )}
              {/* Set, change or remove afterwards. The first offer is made
                  automatically at the end of the first save, so this is for
                  changing one's mind rather than for remembering to. */}
              <ScenarioLockControl
                scenarioId={active.id}
                scenarioName={active.name}
                isLocked={activeEntry?.is_locked ?? false}
                onChanged={() => window.location.reload()}
              />
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={busy}
                className="rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() =>
                  activeResult && run(() => downloadSimulationExcel(activeResult, boe))
                }
                disabled={busy || !activeResult}
                className="rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                title="This simulation as the C-SHEET workbook, the same format the actual record exports"
              >
                Download Excel
              </button>
            </div>
          </div>

          <div className={editing ? "grid gap-6 lg:grid-cols-[280px_1fr]" : ""}>
            {editing && (
              <aside className="lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-xl border border-line bg-surface p-4">
                  <ScenarioControls
                    scenario={active}
                    actualInputs={actualInputs}
                    onChange={patchScenario}
                  />
                </div>
              </aside>
            )}

            <div className="min-w-0 space-y-8">
              <section>
                <h2 className="mb-3 text-sm font-semibold">Item adjustments</h2>
                {activeResult && (
                  <ScenarioItemsTable
                    items={items}
                    overrides={overrides}
                    result={activeResult}
                    baseline={baseline}
                    onChange={patchItem}
                    onReset={resetItem}
                    onDuplicate={duplicateItem}
                  />
                )}
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold">Simulated costing</h2>
                {activeResult && <CostingTable result={activeResult} />}
              </section>
            </div>
          </div>
        </>
      )}

      {/* All scenarios side by side ------------------------------------- */}
      {scenarios.length > 0 && (
        <section className="pt-4">
          <h2 className="mb-3 text-sm font-semibold">All scenarios</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2.5">Scenario</th>
                  <th className="px-3 py-2.5">Freight</th>
                  <th className="px-3 py-2.5">Duty</th>
                  <th className="px-3 py-2.5 text-right">Expenses</th>
                  <th className="px-3 py-2.5 text-right">Landed total</th>
                  <th className="px-3 py-2.5 text-right">Avg cost / pc</th>
                  <th className="px-3 py-2.5 text-right">vs actual</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line bg-slate-50/60 dark:bg-slate-800/30">
                  <td className="px-3 py-2 font-medium">Actual</td>
                  <td className="px-3 py-2 text-xs text-muted">as filed</td>
                  <td className="px-3 py-2 text-xs text-muted">as charged</td>
                  <td className="tnum px-3 py-2 text-right">{inr(baseline.totals.expenseShare)}</td>
                  <td className="tnum px-3 py-2 text-right">{inr(baseline.totals.landedTotal)}</td>
                  <td className="tnum px-3 py-2 text-right font-semibold">
                    {inr(baseline.totals.avgCostPerPiece)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted">—</td>
                </tr>
                {scenarios.map((s) => {
                  const r = results.get(s.id)!;
                  const d = r.totals.avgCostPerPiece - baseline.totals.avgCostPerPiece;
                  const dPct =
                    baseline.totals.avgCostPerPiece === 0
                      ? 0
                      : (d / baseline.totals.avgCostPerPiece) * 100;
                  return (
                    <tr
                      key={s.id}
                      className={`border-t border-line ${s.id === activeId ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => selectScenario(s.id)}
                          className="font-medium hover:text-blue-600 hover:underline"
                        >
                          {s.name}
                        </button>
                        {s.notes && (
                          <span className="ml-2 text-xs text-muted">{s.notes}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {s.freight_mode}
                        <span className="text-muted"> · {inr(r.inputs.expenses.freight)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {s.duty_mode === "derived" ? "floating" : "locked"}
                      </td>
                      <td className="tnum px-3 py-2 text-right">{inr(r.totals.expenseShare)}</td>
                      <td className="tnum px-3 py-2 text-right">{inr(r.totals.landedTotal)}</td>
                      <td className="tnum px-3 py-2 text-right font-semibold">
                        {inr(r.totals.avgCostPerPiece)}
                      </td>
                      <td
                        className={`tnum px-3 py-2 text-right text-xs ${
                          Math.abs(d) < 0.005
                            ? "text-muted"
                            : d > 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {Math.abs(d) < 0.005 ? "—" : pct(dPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Unsaved changes are marked with a dot on the scenario tab and are included in this
            table, so a comparison always reflects what is on screen.
          </p>
        </section>
      )}

      <div className="pt-2">
        <Link
          href={`/boe/${encodeURIComponent(boe.be_no)}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to actual record
        </Link>
      </div>
    </div>
  );
}
