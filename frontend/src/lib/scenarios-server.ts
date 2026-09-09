import "server-only";

import { supabaseServerComponent } from "./supabase-rsc";
import type { Scenario, ScenarioItem, ScenarioWithItems } from "./types";
import type { ScenarioIndexEntry } from "./scenarios";

/**
 * Reading scenarios from a server component.
 *
 * `scenarios.ts` is imported by the workbench, which is a client component, so
 * it holds the browser client and cannot import `server-only`. A server
 * component using that client would carry no session cookie, and the
 * `authenticated` policies would return nothing — an empty workbench rather
 * than an error, which is the worst way for this to fail.
 *
 * So the read path exists twice, deliberately: same queries, different client.
 * Writes are all initiated from the browser and stay in `scenarios.ts`.
 */
export async function listScenariosServer(be_no: string): Promise<ScenarioWithItems[]> {
  const supabase = await supabaseServerComponent();

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
 * Every scenario on this BOE, named, whether or not it can be opened.
 *
 * A locked scenario's body is withheld by the policy, so the query above
 * returns fewer rows than exist. This is how the page still knows they are
 * there — identity and lock state only.
 */
export async function listScenarioIndexServer(be_no: string): Promise<ScenarioIndexEntry[]> {
  const supabase = await supabaseServerComponent();
  const { data, error } = await supabase.rpc("scenario_index", { p_be_no: be_no });
  if (error) throw error;
  return (data ?? []) as ScenarioIndexEntry[];
}

/**
 * True when the signed-in user administers the portal.
 *
 * Re-exported from supabase-rsc so the simulate page has one import for its
 * scenario reads rather than two.
 */
export { isAdmin as isAdminServer } from "./supabase-rsc";
