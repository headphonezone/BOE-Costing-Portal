"use client";

import { useState } from "react";
import { setScenarioPassword, type ScenarioIndexEntry } from "@/lib/scenarios";
import { date } from "@/lib/format";

/**
 * Choosing a simulation.
 *
 * A BOE with several simulations opens here rather than inside one of them.
 * Which of "Q3 revised" and "supplier B" the reader wanted is not something
 * the page can guess, and guessing wrong costs more than asking: they either
 * work in the wrong one or hunt through tabs for the right one.
 *
 * Locked entries are listed, not hidden. The row-level policy has already
 * withheld their contents, so naming them leaks nothing and their absence
 * would be far more confusing than a padlock -- a colleague's simulation
 * would simply appear not to exist.
 */
export function ScenarioList({
  entries,
  onOpen,
  onCreate,
  busy,
}: {
  entries: ScenarioIndexEntry[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          {entries.length} saved simulation{entries.length === 1 ? "" : "s"}
        </h2>
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          + New simulation
        </button>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onOpen(e.id)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="flex-1 truncate text-sm font-medium">{e.name}</span>

              {e.is_locked && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    e.has_access
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-muted dark:bg-slate-800"
                  }`}
                >
                  {/* Unlocked-for-now is worth distinguishing: the grant
                      expires, and a reader who sees "open" then gets asked
                      for a password later would think something broke. */}
                  &#128274; {e.has_access ? "unlocked" : "password"}
                </span>
              )}

              <span className="hidden w-28 shrink-0 text-right text-xs text-muted sm:block">
                {date(e.created_at)}
              </span>
              <span aria-hidden className="text-muted">&rsaquo;</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The one time a password is offered without being asked for.
 *
 * It appears at the end of a simulation's first save, because that is the
 * moment the reader has decided it is worth keeping and therefore the only
 * moment they have an opinion about who else should see it. Asking earlier
 * interrupts the work; asking from a button on the toolbar means never being
 * asked at all.
 *
 * Skipping is a real answer. Most simulations are working notes, and a
 * password on every one of them would train people to dismiss the question.
 */
export function FirstSavePasswordPrompt({
  scenarioId,
  scenarioName,
  onDone,
}: {
  scenarioId: string;
  scenarioName: string;
  onDone: (didSet: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function save() {
    if (password !== confirm) {
      setError("Those two passwords are not the same.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setScenarioPassword(scenarioId, password);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set the password");
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Password for ${scenarioName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold">Saved &ldquo;{scenarioName}&rdquo;</h2>
        <p className="mt-1.5 text-sm text-muted">
          Anyone signed in to the portal can open this simulation. Give it a
          password to restrict it to the people you share that password with.
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
            aria-label="Repeat password"
            className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 ${
              mismatch ? "border-red-400" : "border-line focus:border-blue-500"
            }`}
          />

          {/* There is no recovery, so this is said before the decision rather
              than discovered after it. An administrator can reset a password
              but cannot read one -- it is stored hashed. */}
          <p className="text-xs text-muted">
            Keep it somewhere safe. It cannot be read back later, only reset by
            an administrator.
          </p>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onDone(false)}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-sm text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={busy || password.length === 0 || mismatch}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? "Setting…" : "Set password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
