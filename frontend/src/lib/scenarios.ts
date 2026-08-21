/**
 * Scenario CRUD. These two tables are owned by the portal
 * (see sql/001_scenarios.sql).
 */
import { supabase } from "./supabase";
import type { Scenario, ScenarioItem, ScenarioWithItems } from "./types";

export async function listScenarios(be_no: string): Promise<ScenarioWithItems[]> {
  const { data: scenarios, error } = await supabase
    .from("boe_scenarios")
    .select("*")
    .eq("be_no", be_no)
    .order("created_at", { ascending: true });

  if (error) throw error;
  const list = (scenarios ?? []) as Scenario[];
  if (list.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("boe_scenario_items")
    .select("*")
    .in(
      "scenario_id",
      list.map((s) => s.id)
    );
  if (itemsError) throw itemsError;

  const byScenario = new Map<string, ScenarioItem[]>();
  for (const si of (items ?? []) as ScenarioItem[]) {
    const bucket = byScenario.get(si.scenario_id);
    if (bucket) bucket.push(si);
    else byScenario.set(si.scenario_id, [si]);
  }

  return list.map((s) => ({ ...s, items: byScenario.get(s.id) ?? [] }));
}

/**
 * Picks the next free "Simulation N". Counts from the existing names rather
 * than the row count so deleting Simulation 2 and creating another does not
 * collide with Simulation 3 (the unique index on (be_no, lower(name))
 * would otherwise reject the insert).
 */
export function nextScenarioName(existing: Scenario[]): string {
  const used = new Set(
    existing
      .map((s) => /^simulation\s+(\d+)$/i.exec(s.name.trim())?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return `Simulation ${n}`;
}

export async function createScenario(
  be_no: string,
  name: string,
  seed: Partial<Scenario> = {}
): Promise<ScenarioWithItems> {
  const { data, error } = await supabase
    .from("boe_scenarios")
    // Fixed duty is stated rather than left to the column default, so a
    // database that predates migration 002 still gets the intended behaviour.
    .insert({ be_no, name, duty_mode: "locked", ...seed })
    .select("*")
    .single();

  if (error) throw error;
  return { ...(data as Scenario), items: [] };
}

export async function updateScenario(
  id: string,
  patch: Partial<Scenario>
): Promise<Scenario> {
  // Never let a client-held id, be_no or timestamp overwrite the row.
  const { id: _id, be_no: _be, created_at: _c, updated_at: _u, ...safe } = patch;
  void _id;
  void _be;
  void _c;
  void _u;

  const { data, error } = await supabase
    .from("boe_scenarios")
    .update(safe)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as Scenario;
}

export async function deleteScenario(id: string): Promise<void> {
  const { error } = await supabase.from("boe_scenarios").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Upserts one item override. Rows are sparse -- one exists only for an item
 * that has actually been changed -- so this inserts on first edit and updates
 * thereafter, keyed by (scenario_id, invsno, itemsn).
 */
export async function upsertScenarioItem(
  scenario_id: string,
  invsno: number,
  itemsn: number,
  patch: Partial<Pick<ScenarioItem, "unit_price_usd" | "qty" | "is_foc" | "foc_bears_duty">>
): Promise<ScenarioItem> {
  const { data, error } = await supabase
    .from("boe_scenario_items")
    .upsert(
      { scenario_id, invsno, itemsn, ...patch },
      { onConflict: "scenario_id,invsno,itemsn" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as ScenarioItem;
}

/** Drops an override so the item falls back to its actual values. */
export async function clearScenarioItem(
  scenario_id: string,
  invsno: number,
  itemsn: number
): Promise<void> {
  const { error } = await supabase
    .from("boe_scenario_items")
    .delete()
    .eq("scenario_id", scenario_id)
    .eq("invsno", invsno)
    .eq("itemsn", itemsn);
  if (error) throw error;
}

/**
 * Replaces a scenario's item overrides wholesale. Same pattern the existing
 * backend uses for boe_items: delete then insert, so a removed override
 * actually disappears instead of lingering. Override counts are in the tens,
 * so the round trip is cheap and the alternative (diffing) is easy to get
 * subtly wrong.
 */
export async function replaceScenarioItems(
  scenario_id: string,
  items: Array<
    Pick<
      ScenarioItem,
      | "invsno"
      | "itemsn"
      | "unit_price_usd"
      | "qty"
      | "is_foc"
      | "foc_bears_duty"
      | "description"
      | "source_itemsn"
    >
  >
): Promise<ScenarioItem[]> {
  const { error: deleteError } = await supabase
    .from("boe_scenario_items")
    .delete()
    .eq("scenario_id", scenario_id);
  if (deleteError) throw deleteError;

  if (items.length === 0) return [];

  const { data, error } = await supabase
    .from("boe_scenario_items")
    .insert(items.map((i) => ({ scenario_id, ...i })))
    .select("*");
  if (error) throw error;
  return (data ?? []) as ScenarioItem[];
}

/** Copies a scenario and all its item overrides under a new name. */
export async function duplicateScenario(
  source: ScenarioWithItems,
  name: string
): Promise<ScenarioWithItems> {
  const {
    id: _id,
    created_at: _c,
    updated_at: _u,
    items: _items,
    name: _n,
    ...rest
  } = source;
  void _id;
  void _c;
  void _u;
  void _items;
  void _n;

  const { data, error } = await supabase
    .from("boe_scenarios")
    .insert({ ...rest, name })
    .select("*")
    .single();
  if (error) throw error;

  const created = data as Scenario;
  if (source.items.length === 0) return { ...created, items: [] };

  const { data: copied, error: itemsError } = await supabase
    .from("boe_scenario_items")
    .insert(
      source.items.map((si) => ({
        scenario_id: created.id,
        invsno: si.invsno,
        itemsn: si.itemsn,
        unit_price_usd: si.unit_price_usd,
        qty: si.qty,
        is_foc: si.is_foc,
        foc_bears_duty: si.foc_bears_duty,
        description: si.description,
        source_itemsn: si.source_itemsn,
      }))
    )
    .select("*");
  if (itemsError) throw itemsError;

  return { ...created, items: (copied ?? []) as ScenarioItem[] };
}
