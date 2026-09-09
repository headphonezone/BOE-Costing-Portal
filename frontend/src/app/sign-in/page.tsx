"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readableAuthError } from "@/lib/auth-errors";

/**
 * Sign-in.
 *
 * The only page reachable without a session. Everything else redirects here
 * and carries a `next` parameter, so an expired session costs the reader their
 * place for as long as it takes to sign back in, and no longer.
 *
 * Google is the only way in. There are no passwords to manage, reset or leak,
 * and account lifecycle follows the Google account — someone who leaves loses
 * access when their Google account is closed, without anyone remembering to
 * revoke anything here.
 *
 * Signing in is not the same as being let in. Any Google account can complete
 * this flow; the database then decides, and one that is not on the allowlist
 * sees nothing. That is why the note below says access is by address rather
 * than by having signed in successfully.
 */
function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // The callback needs to know where the reader was heading, because it
        // is a full round trip through Google and nothing else survives it.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError(readableAuthError(error.message));
      setBusy(false);
    }
    // On success the browser leaves for Google; nothing after this runs.
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">BOE Costing Portal</h1>
      <p className="mt-1.5 text-sm text-muted">Ferrari Video</p>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm font-medium transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
          />
        </svg>
        {busy ? "Redirecting to Google…" : "Continue with Google"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Access is granted by email address. Signing in with a Google account
        that has not been granted access will succeed and then show nothing —
        ask an administrator to add your address rather than trying another
        account.
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
