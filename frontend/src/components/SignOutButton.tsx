"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Sign out.
 *
 * The refresh after the push is what matters: signOut clears the cookie, but
 * the server components already rendered still hold their data. Refreshing
 * re-runs them with no session, so nothing signed-in stays on screen.
 */
export function SignOutButton({ email }: { email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-xs text-muted sm:inline" title={email}>
        {email}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await supabase.auth.signOut();
          router.push("/sign-in");
          router.refresh();
        }}
        className="rounded border border-line px-2.5 py-1 text-xs transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
