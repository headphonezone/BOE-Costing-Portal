/**
 * Read-only access to the actual import records. These tables are owned and
 * written by the existing BOE-Costing-Sheet FastAPI backend; the portal never
 * writes to them.
 */
import { supabaseServerComponent } from "./supabase-rsc";
import { supabaseServer } from "./supabase-server";
import { API_BASE_URL } from "./supabase";
import type { Boe, BoeDebitAdvice, BoeDocument, BoeItem, BoeLicence, BoeVariableFields } from "./types";

/**
 * A pre-migration boe_documents row still holds a Supabase Storage path
 * (e.g. "8555370/BOE/file.pdf"), not a Drive file ID -- those slashes are
 * the tell. Drive file IDs never contain one. Once the one-time migration
 * script (parser/scripts/migrate_docs_to_drive.py) has run against every
 * row, this always returns false and the branch below is dead but harmless.
 */
function isLegacySupabasePath(storagePath: string): boolean {
  return storagePath.includes("/");
}

export type BoeBundle = {
  boe: Boe;
  items: BoeItem[];
  licences: BoeLicence[];
  documents: BoeDocument[];
  variableFields: BoeVariableFields | null;
  debitAdvices: BoeDebitAdvice[];
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
  const supabase = await supabaseServerComponent();
  const { data, error } = await supabase
    .from("boes")
    .select("*")
    .order("be_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Boe[];
}

export async function getBoeBundle(be_no: string): Promise<BoeBundle | null> {
  const supabase = await supabaseServerComponent();
  const [{ data: boe }, { data: items }, { data: licences }, { data: docs }, { data: vf }, { data: advices }] =
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
      supabase
        .from("boe_debit_advices")
        .select("*")
        .eq("be_no", be_no)
        .order("uploaded_at", { ascending: false }),
    ]);

  if (!boe) return null;

  return {
    boe: boe as Boe,
    items: (items ?? []) as BoeItem[],
    licences: (licences ?? []) as BoeLicence[],
    documents: (docs ?? []) as BoeDocument[],
    variableFields: (vf ?? null) as BoeVariableFields | null,
    debitAdvices: (advices ?? []) as BoeDebitAdvice[],
  };
}

/**
 * The bucket pre-migration documents still live in. Only reached for the
 * legacy-path branch below; new uploads never touch Supabase Storage.
 */
const DOCS_BUCKET = "boe-documents";

/**
 * How long a legacy Supabase-signed document link stays valid. The pages
 * that mint these are `force-dynamic`, so a link is signed fresh on every
 * render and only has to outlive the visit it was made for.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * One viewable link per document, keyed by storage path.
 *
 * Documents live in Google Drive now, but the link points at this app's own
 * parser service (GET /documents/{file_id}), which streams the bytes straight
 * from Drive using the service account's credentials. That -- not a direct
 * drive.google.com link -- is what makes "View BOE PDF" open for anyone using
 * the portal: a raw Drive link requires the *viewer's own* Google account to
 * be a member of the "BOE Costing Portal" Shared Drive, which defeats the
 * point of a portal link anyone can click. A row that predates the Drive
 * migration still holds a Supabase Storage path (see isLegacySupabasePath)
 * and falls back to a signed Supabase URL.
 *
 * A file that has gone missing is left out of the map rather than throwing,
 * and the caller renders it as unavailable: a broken attachment must not
 * take the whole record page down with it.
 */
export async function signDocumentUrls(
  documents: BoeDocument[]
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    documents.map(async (doc) => {
      if (!isLegacySupabasePath(doc.storage_path)) {
        return [doc.storage_path, `${API_BASE_URL}/documents/${doc.storage_path}`] as const;
      }
      try {
        // Signed with the server-only client so the bucket can refuse the
        // anon key outright. This function is only ever called from a server
        // component, so the service key never leaves the server.
        const { data } = await supabaseServer.storage
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
