"use client";

import { useState } from "react";
import {
  grantAccess,
  revokeAccess,
  setRole,
  type AppRole,
  type AppUser,
  type LockedScenario,
} from "@/lib/admin";
import { clearScenarioPassword, setScenarioPassword } from "@/lib/scenarios";
import { date } from "@/lib/format";

/**
 * The admin panel.
 *
 * Two jobs: who may use the portal, and resetting simulation passwords.
 *
 * Nothing here is the security boundary — every action calls a database
 * function that re-checks the caller is an administrator. This screen only
 * decides what is worth offering, and the database decides what is allowed.
 */
export function AdminPanel({
  initialUsers,
  initialLocks,
  currentEmail,
}: {
  initialUsers: AppUser[];
  initialLocks: LockedScenario[];
  currentEmail: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [locks, setLocks] = useState(initialLocks);
  const [email, setEmail] = useState("");
  const [role, setNewRole] = useState<AppRole>("user");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
      // Re-read rather than patching local state: the database applies rules
      // this screen does not model, so what it returns is the truth.
      const { listAppUsers, listLockedScenarios } = await import("@/lib/admin");
      setUsers(await listAppUsers());
      setLocks(await listLockedScenarios());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const admins = users.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-10">
      {(error || note) && (
        <div
          role="alert"
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
          }`}
        >
          {error || note}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Who has access</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-muted">
          Access is granted address by address. Only an address on this list
          can sign in, and it can sign in as soon as it is added.
        </p>

        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const addr = email.trim();
            run(() => grantAccess(addr, role), `${addr} can now sign in as ${role}.`).then(
              () => setEmail("")
            );
          }}
        >
          <div>
            <label htmlFor="new-email" className="mb-1 block text-xs font-medium">
              Email address
            </label>
            <input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-72 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label htmlFor="new-role" className="mb-1 block text-xs font-medium">
              Role
            </label>
            <select
              id="new-role"
              value={role}
              onChange={(e) => setNewRole(e.target.value as AppRole)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            Grant access
          </button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Added</th>
                <th className="px-3 py-2.5 text-right">Remove</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.email === currentEmail;
                const lastAdmin = u.role === "admin" && admins === 1;
                return (
                  <tr key={u.email} className="border-t border-line">
                    <td className="px-3 py-2">
                      {u.email}
                      {isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={u.role}
                        disabled={busy || lastAdmin}
                        onChange={(e) =>
                          run(
                            () => setRole(u.email, e.target.value as AppRole),
                            `${u.email} is now ${e.target.value}.`
                          )
                        }
                        title={lastAdmin ? "The last administrator cannot be demoted" : undefined}
                        className="rounded border border-line bg-surface px-2 py-1 text-sm disabled:opacity-50"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-muted">{date(u.added_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={busy || isSelf || lastAdmin}
                        onClick={() => {
                          if (!window.confirm(`Remove access for ${u.email}?`)) return;
                          run(() => revokeAccess(u.email), `${u.email} no longer has access.`);
                        }}
                        title={
                          isSelf
                            ? "You cannot remove your own access"
                            : lastAdmin
                              ? "The last administrator cannot be removed"
                              : undefined
                        }
                        className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline dark:text-red-400"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Locked simulations</h2>
        <p className="mb-4 mt-1 max-w-prose text-sm text-muted">
          Simulations someone has put a password on. As an administrator you can
          open any of them without the password, so this is only for when
          somebody else needs to get back in.{" "}
          <b>The password itself cannot be shown</b> — it is stored hashed, so
          there is nothing to read back. Set a new one, or remove the lock.
        </p>

        {locks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            No simulation currently has a password.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2.5">BOE</th>
                  <th className="px-3 py-2.5">Simulation</th>
                  <th className="px-3 py-2.5">Locked by</th>
                  <th className="px-3 py-2.5">When</th>
                  <th className="px-3 py-2.5 text-right">Password</th>
                </tr>
              </thead>
              <tbody>
                {locks.map((l) => (
                  <tr key={l.scenario_id} className="border-t border-line">
                    <td className="px-3 py-2 font-medium">{l.be_no}</td>
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2 text-muted">{l.set_by_email ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{date(l.set_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const pw = window.prompt(
                            `New password for "${l.name}" on BE ${l.be_no}:`
                          );
                          if (!pw) return;
                          run(
                            () => setScenarioPassword(l.scenario_id, pw),
                            `Password changed on "${l.name}". Tell whoever needs it.`
                          );
                        }}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                      >
                        Change
                      </button>
                      <span className="px-1.5 text-xs text-muted">·</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Remove the password on "${l.name}"?`)) return;
                          run(
                            () => clearScenarioPassword(l.scenario_id),
                            `"${l.name}" is no longer locked.`
                          );
                        }}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
