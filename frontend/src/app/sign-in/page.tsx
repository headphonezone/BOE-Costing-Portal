"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Sign-in.
 *
 * The only page reachable without a session. Everything else redirects here
 * and carries a `next` parameter, so an expired session costs the reader their
 * place for as long as it takes to sign back in, and no longer.
 *
 * For now an address on the allowlist is the whole of the check: no Google, no
 * password, no emailed code. /auth/email explains why, and what that costs.
 * The form is a plain POST rather than a script, so it works even when the
 * page's JavaScript has not loaded.
 */
function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const error = params.get("error");
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">BOE Costing Portal</h1>
      <p className="mt-1.5 text-sm text-muted">Ferrari Video</p>

      <form
        method="post"
        action="/auth/email"
        onSubmit={() => setBusy(true)}
        className="mt-8 space-y-3"
      >
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email" className="block text-xs font-medium">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="name@ferrarivideo.com"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Access is granted by email address. If yours has not been added yet,
        ask an administrator.
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
