/**
 * Read-only access to the actual import records. These tables are owned and
 * written by the existing BOE-Costing-Sheet FastAPI backend; the portal never
 * writes to them.
 */
import { supabase } from "./supabase";
import type { Boe, BoeDocument, BoeItem, BoeLicence, BoeVariableFields } from "./types";

export type BoeBundle = {
  boe: Boe;
  items: BoeItem[];
  licences: BoeLicence[];
  documents: BoeDocument[];
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
  const [{ data: boe }, { data: items }, { data: licences }, { data: docs }, { data: vf }] =
    await Promise.all([
      supabase.from("boes").select("*").eq("be_no", be_no).maybeSingle(),
      supabase.from("boe_items").select("*").eq("be_no", be_no).order("global_sno"),
      supabase.from("boe_licences").select("*").eq("be_no", be_no),
      supabase
        .from("boe_documents")
        .select("*")
        .eq("be_no", be_no)
        .order("uploaded_at", { ascending: false }),
      supabase.from("boe_variable_fields").select("*").eq("be_no", be_no).maybeSingle(),
    ]);

  if (!boe) return null;

  return {
    boe: boe as Boe,
    items: (items ?? []) as BoeItem[],
    licences: (licences ?? []) as BoeLicence[],
    documents: (docs ?? []) as BoeDocument[],
    variableFields: (vf ?? null) as BoeVariableFields | null,
  };
}

/**
 * The bucket the parser service uploads into. It is private -- a public URL
 * on it returns 400 -- so every link to a stored file has to be signed.
 */
const DOCS_BUCKET = "boe-documents";

/**
 * How long a document link stays valid. The pages that mint these are
 * `force-dynamic`, so a link is signed fresh on every render and only has to
 * outlive the visit it was made for.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * One signed link per document, keyed by storage path.
 *
 * A file that has gone missing from Storage is left out of the map rather
 * than throwing, and the caller renders it as unavailable: a broken
 * attachment must not take the whole record page down with it.
 */
export async function signDocumentUrls(
  documents: BoeDocument[]
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    documents.map(async (doc) => {
      try {
        const { data } = await supabase.storage
          .from(DOCS_BUCKET)
          .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
        return [doc.storage_path, data?.signedUrl] as const;
      } catch {
        return [doc.storage_path, undefined] as const;
      }
    })
  );

  return new Map(
    entries.filter((e): e is readonly [string, string] => Boolean(e[1]))
  );
}
