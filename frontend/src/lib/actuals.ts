/**
 * Read-only access to the actual import records. These tables are owned and
 * written by the existing BOE-Costing-Sheet FastAPI backend; the portal never
 * writes to them.
 */
import { supabase } from "./supabase";
import type { Boe, BoeItem, BoeLicence, BoeVariableFields } from "./types";

export type BoeBundle = {
  boe: Boe;
  items: BoeItem[];
  licences: BoeLicence[];
  variableFields: BoeVariableFields | null;
};

/**
 * Ceiling on how many records the list page pulls in one go. Filtering,
 * sorting and paging all happen in the browser, which keeps them instant; the
 * cap is what stops that choice becoming a problem if the table grows. If it
 * is ever reached, the list page says so rather than quietly truncating.
 */
export const LIST_LIMIT = 1000;

/** Every import record, newest first, for the client-side list page. */
export async function listBoes(limit = LIST_LIMIT): Promise<Boe[]> {
  const { data, error } = await supabase
    .from("boes")
    .select("*")
    .order("be_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Boe[];
}

export async function getBoeBundle(be_no: string): Promise<BoeBundle | null> {
  const [{ data: boe }, { data: items }, { data: licences }, { data: vf }] =
    await Promise.all([
      supabase.from("boes").select("*").eq("be_no", be_no).maybeSingle(),
      supabase.from("boe_items").select("*").eq("be_no", be_no).order("global_sno"),
      supabase.from("boe_licences").select("*").eq("be_no", be_no),
      supabase.from("boe_variable_fields").select("*").eq("be_no", be_no).maybeSingle(),
    ]);

  if (!boe) return null;

  return {
    boe: boe as Boe,
    items: (items ?? []) as BoeItem[],
    licences: (licences ?? []) as BoeLicence[],
    variableFields: (vf ?? null) as BoeVariableFields | null,
  };
}
