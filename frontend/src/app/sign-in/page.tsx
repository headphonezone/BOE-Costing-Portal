"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Sign-in.
 *
 * The only page reachable without a session. Everything else redirects here
 * and carries a `next` parameter, so an expired session costs the reader their
 * place for as long as it takes to sign back in, and no longer.
 *
 * Google OAuth proves the reader owns the address they claim; the allowlist
 * (app_users, enforced by a trigger on auth.users -- see sql/011_signin_allowlist.sql)
 * still decides whether that address is permitted in at all. This replaces
 * the email-only placeholder that /auth/email used to serve: that form let
 * anyone in who merely typed an allowlisted address, which was deliberately
 * temporary and is no longer needed now that this portal has its own OAuth
 * client rather than depending on one shared with another project.
 */
function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const error = params.get("error");
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // A successful call navigates the browser away to Google immediately --
    // this only runs if signInWithOAuth itself failed before that redirect
    // (e.g. the provider isn't configured in Supabase yet).
    if (error) {
      setBusy(false);
      router.push(`/sign-in?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">BOE Costing Portal</h1>
      <p className="mt-1.5 text-sm text-muted">Ferrari Video</p>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
      >
        <GoogleIcon />
        {busy ? "Redirecting…" : "Continue with Google"}
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
        Access is granted by email address. If yours has not been added yet,
        ask an administrator.
      </p>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.6 34.9 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C40.9 36.6 44 30.9 44 24c0-1.3-.1-2.6-.4-3.5z"
      />
    </svg>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
