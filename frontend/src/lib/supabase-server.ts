import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * A Supabase client that never reaches a browser.
 *
 * The `server-only` import above is the guarantee: any client component that
 * imports this file fails the build rather than shipping the key. The key
 * itself is deliberately named without the NEXT_PUBLIC_ prefix, which is what
 * keeps it out of the bundle.
 *
 * It exists for one job. The document bucket holds real Bills of Entry --
 * importer IEC and GSTIN, supplier, unit prices, duty -- and until this
 * existed, the only credential available for signing a link to one was the
 * anon key that ships in the page source. Anyone holding it could list the
 * bucket and download every PDF in it. Signing here instead means the bucket
 * can refuse `anon` outright while the portal still shows its documents.
 *
 * Falls back to the anon key when the service key is absent, so a environment
 * that has not been given one keeps working exactly as before rather than
 * breaking. That fallback is also why locking the bucket down is a separate,
 * deliberate step: do it only once this variable is set.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabaseServer = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** True when a real service key is configured, rather than the anon fallback. */
export const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_KEY);
