import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser's Supabase client.
 *
 * Session-aware: it reads and writes the auth cookie, so every query it makes
 * carries the signed-in user's JWT rather than the bare anon key. That is what
 * lets the database policies grant to `authenticated` instead of to anyone —
 * the anon key compiled into this bundle stops being a key to the data and
 * becomes only the key that lets a browser ask to sign in.
 *
 * Server components use `supabaseServerComponent()` in ./supabase-rsc instead,
 * because cookies are read differently there.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * The parser service, deployed separately from this app.
 *
 * It has to be: a Next.js app and a Python function both claim `/api/*`, and
 * inside a single Vercel project Next wins -- requests never reach Python. Its
 * own project has no framework competing for the path.
 *
 * So this needs a host, and NEXT_PUBLIC_API_BASE_URL must be set in every
 * environment that has a parser. The localhost default is for development;
 * in production an unset value means the three parser-backed actions -- PDF
 * upload and the two Excel downloads -- fail with a readable message, while
 * the rest of the portal works normally.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000"
  // A trailing slash here becomes a double slash in every request path, which
  // the platform answers with a 308 redirect -- and a redirected POST can
  // arrive without its multipart body, so an upload fails in a way that looks
  // nothing like the pasted-in slash that caused it.
).replace(/\/+$/, "");
