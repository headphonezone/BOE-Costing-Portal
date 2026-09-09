"use client";

import { useState } from "react";
import {
  clearScenarioPassword,
  setScenarioPassword,
  unlockScenario,
  type ScenarioIndexEntry,
} from "@/lib/scenarios";

/**
 * Opening a locked scenario.
 *
 * Shown in place of the workbench when a scenario carries a password this
 * reader has not given. The panel is not the lock — the row-level policy has
 * already withheld the body, and this is only how the password gets offered.
 */
export function LockedScenarioPanel({
  entry,
  isAdmin,
  onUnlocked,
}: {
  entry: ScenarioIndexEntry;
  isAdmin: boolean;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await unlockScenario(entry.id, password)) {
        onUnlocked();
      } else {
        setError("That password does not open this simulation.");
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check that password");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold">{entry.name}</h2>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
          locked
        </span>
      </div>
      <p className="mt-1.5 max-w-prose text-sm text-muted">
        This simulation is password protected. Its inputs and figures are
        withheld until the password is given — the record itself, and every
        other simulation on it, are unaffected.
      </p>

      <form onSubmit={submit} className="mt-5 flex flex-wrap items-start gap-2">
        <div>
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label={`Password for ${entry.name}`}
            className="w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !password}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Open"}
        </button>
        {isAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Remove the password on "${entry.name}"?`)) return;
              setBusy(true);
              try {
                await clearScenarioPassword(entry.id);
                onUnlocked();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not clear the lock");
                setBusy(false);
              }
            }}
            className="rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
            title="Administrators can reset a forgotten password. The password itself is hashed and cannot be read back."
          >
            Reset lock
          </button>
        )}
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Setting, changing or removing a scenario's password.
 *
 * A password takes effect immediately, not on the next save, because it is
 * not one of the scenario's costing inputs — nothing about it is being
 * compared, so deferring it would only create a window where the interface
 * says locked and the database disagrees.
 */
export function ScenarioLockControl({
  scenarioId,
  scenarioName,
  isLocked,
  onChanged,
}: {
  scenarioId: string;
  scenarioName: string;
  isLocked: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
          setPassword("");
        }}
        className="rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800"
        title={isLocked ? "This simulation has a password" : "Set a password on this simulation"}
      >
        {isLocked ? "Locked" : "Lock"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-line bg-surface p-4 shadow-lg">
          <p className="mb-3 text-xs text-muted">
            {isLocked
              ? "This simulation has a password. Set a new one to change it, or remove it entirely."
              : "Anyone signed in can open this simulation. A password restricts it to people you give it to."}
          </p>

          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isLocked ? "New password" : "Password"}
            aria-label={`Password for ${scenarioName}`}
            className="w-full rounded border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || password.length < 4}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await setScenarioPassword(scenarioId, password);
                  setOpen(false);
                  setPassword("");
                  onChanged();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not set the password");
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
            >
              {isLocked ? "Change" : "Set password"}
            </button>

            {isLocked && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await clearScenarioPassword(scenarioId);
                    setOpen(false);
                    onChanged();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not remove the password");
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              >
                Remove
              </button>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>

          <p className="mt-3 text-[11px] leading-snug text-muted">
            Passwords are stored hashed and cannot be read back — not by an
            administrator either. A forgotten one is reset, not recovered.
          </p>
        </div>
      )}
    </div>
  );
}
