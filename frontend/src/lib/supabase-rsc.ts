import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The Supabase client for server components.
 *
 * Same anon key as the browser's, but reading the session from the request's
 * cookies, so queries run as the signed-in user and the `authenticated`
 * policies apply. A server component that used the browser client would have
 * no session attached and would be refused everything.
 *
 * Writing cookies is a no-op here: a server component cannot set them, and
 * token refresh is handled in middleware.ts before the request reaches this
 * point. Swallowing the write is the documented pattern rather than a
 * shortcut — without it, a refresh during render throws.
 */
export async function supabaseServerComponent() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: () => {
          /* refreshed in middleware; nothing to do during render */
        },
      },
    }
  );
}

/** The signed-in user for this request, or null. */
export async function currentUser() {
  const sb = await supabaseServerComponent();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/**
 * Whether the signed-in address has been granted access.
 *
 * Signing in and being let in are different things now that any Google
 * account can complete the flow. Without this the portal would render every
 * page empty for a stranger, which looks like a fault rather than a refusal.
 */
export async function isMember() {
  const sb = await supabaseServerComponent();
  const { data, error } = await sb.rpc("is_member");
  return !error && data === true;
}

/** Whether the signed-in address administers the portal. */
export async function isAdmin() {
  const sb = await supabaseServerComponent();
  const { data, error } = await sb.rpc("is_admin");
  return !error && data === true;
}
