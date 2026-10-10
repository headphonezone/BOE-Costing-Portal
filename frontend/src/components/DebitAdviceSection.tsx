"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/supabase";
import { date, inr, usd } from "@/lib/format";
import type { BoeDebitAdvice, DebitAdviceBank } from "@/lib/types";

const BANK_LABELS: Record<DebitAdviceBank, string> = {
  YES_BANK: "Yes Bank",
  SBI: "SBI",
};

type MismatchWarning = {
  fileName: string;
  message: string;
  billAmount: number | null;
  billCurrency: string | null;
  invoiceTotal: number | null;
  runningTotal: number | null;
};

type State =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "mismatch"; warning: MismatchWarning; file: File; password: string; bank: DebitAdviceBank }
  | { status: "error"; fileName: string; message: string }
  | { status: "done"; be_no: string; computedBankCharges: number; fxRate: number };

/**
 * Upload panel plus history for Yes Bank debit advices against one BOE.
 *
 * A BOE can have more than one debit advice -- a partial advance followed
 * later by a balance payment -- so uploads don't overwrite each other: the
 * BOE's confirmed exchange rate becomes the AVERAGE fx_rate across every
 * debit advice on it, and its debit-advice bank charges become their SUM
 * (see _apply_debit_advice_aggregates in supabase_client.py). Each upload
 * compares the RUNNING TOTAL of every advice so far against boe.inv_value_usd
 * (see check_invoice_value_match) -- landing under it is a normal partial
 * payment, so only exceeding it comes back as a mismatch warning, which the
 * operator can override if they know it's still the right BOE.
 */
export function DebitAdviceSection({
  be_no,
  debitAdvices,
}: {
  be_no: string;
  debitAdvices: BoeDebitAdvice[];
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const [bank, setBank] = useState<DebitAdviceBank>("YES_BANK");
  const [password, setPassword] = useState("");
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(file: File, pw: string, bankChoice: DebitAdviceBank, override: boolean) {
    setState({ status: "uploading", fileName: file.name });

    const body = new FormData();
    body.append("file", file);
    body.append("bank", bankChoice);
    body.append("password", pw);
    body.append("override", String(override));

    try {
      const res = await fetch(
        `${API_BASE_URL}/boe/${encodeURIComponent(be_no)}/debit-advice`,
        { method: "POST", body }
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || `The parser rejected this file (${res.status}).`);
      }

      const data = await res.json();

      if (data.matched === false && !data.debit_advice) {
        setState({
          status: "mismatch",
          file,
          password: pw,
          bank: bankChoice,
          warning: {
            fileName: file.name,
            message: data.message,
            billAmount: data.bill_amount,
            billCurrency: data.bill_currency,
            invoiceTotal: data.invoice_total,
            runningTotal: data.running_total,
          },
        });
        return;
      }

      setState({
        status: "done",
        be_no,
        computedBankCharges: data.debit_advice.computed_bank_charges,
        fxRate: data.debit_advice.fx_rate,
      });
      setPassword("");
      router.refresh();
    } catch (err) {
      setState({
        status: "error",
        fileName: file.name,
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  async function undo(id: number) {
    setUndoingId(id);
    try {
      const res = await fetch(
        `${API_BASE_URL}/boe/${encodeURIComponent(be_no)}/debit-advice/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || `Could not undo (${res.status}).`);
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Undo failed.");
    } finally {
      setUndoingId(null);
    }
  }

  const busy = state.status === "uploading";

  const ratedAdvices = debitAdvices.filter((a) => a.fx_rate != null);
  const combinedRate =
    ratedAdvices.length > 0
      ? ratedAdvices.reduce((sum, a) => sum + (a.fx_rate ?? 0), 0) / ratedAdvices.length
      : null;
  const combinedCharges = debitAdvices.reduce((sum, a) => sum + (a.computed_bank_charges ?? 0), 0);

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold">
        Debit advices {debitAdvices.length > 0 && `(${debitAdvices.length})`}
      </h2>

      {debitAdvices.length > 0 && (
        <div className="mb-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
              <tr>
                <th className="px-3 py-2.5">Uploaded</th>
                <th className="px-3 py-2.5">Bank</th>
                <th className="px-3 py-2.5 text-right">Bill amount</th>
                <th className="px-3 py-2.5 text-right">FX rate</th>
                <th className="px-3 py-2.5 text-right">Bank charges</th>
                <th className="px-3 py-2.5">Match</th>
                <th className="px-3 py-2.5 text-right">Undo</th>
              </tr>
            </thead>
            <tbody>
              {debitAdvices.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-3 py-2 text-muted">{date(a.uploaded_at)}</td>
                  <td className="px-3 py-2">{BANK_LABELS[a.bank] ?? a.bank}</td>
                  <td className="tnum px-3 py-2 text-right">
                    {a.bill_currency ?? ""} {a.bill_amount?.toLocaleString() ?? "—"}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{a.fx_rate ?? "—"}</td>
                  <td className="tnum px-3 py-2 text-right">{inr(a.computed_bank_charges)}</td>
                  <td className="px-3 py-2">
                    {a.invoice_value_matched ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Matched
                      </span>
                    ) : (
                      <span
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        title={`Overridden against invoice total ${a.matched_invoice_total ?? "—"}`}
                      >
                        Overridden
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => undo(a.id)}
                      disabled={undoingId === a.id}
                      className="text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                    >
                      {undoingId === a.id ? "Undoing…" : "Undo"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {debitAdvices.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-slate-50 font-medium dark:bg-slate-800/40">
                  <td className="px-3 py-2" colSpan={3}>
                    Combined (applied to this BOE&apos;s costing)
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {combinedRate !== null ? combinedRate.toFixed(4) : "—"}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{inr(combinedCharges)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Bank</label>
            <select
              value={bank}
              onChange={(e) => setBank(e.target.value as DebitAdviceBank)}
              disabled={busy}
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-sm"
            >
              {(Object.keys(BANK_LABELS) as DebitAdviceBank[]).map((b) => (
                <option key={b} value={b}>
                  {BANK_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted">
              PDF password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Optional"
              className="rounded-lg border border-line bg-background px-3 py-1.5 text-sm"
              disabled={busy}
            />
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Uploading…" : `Upload ${BANK_LABELS[bank]} debit advice`}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) submit(file, password, bank, false);
              e.target.value = "";
            }}
          />
        </div>

        {state.status === "mismatch" && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">Debit advices on this BOE would exceed its invoice value</p>
            <p className="mt-1">
              This upload: {state.warning.billCurrency} {state.warning.billAmount?.toLocaleString()}. Including it,
              every debit advice on this BOE totals {state.warning.billCurrency} {state.warning.runningTotal?.toLocaleString()},
              against an invoice value of {usd(state.warning.invoiceTotal)}.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => submit(state.file, state.password, state.bank, true)}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition hover:bg-amber-700"
              >
                Upload anyway
              </button>
              <button
                type="button"
                onClick={() => setState({ status: "idle" })}
                className="font-medium underline underline-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <p className="font-medium">Could not process {state.fileName}</p>
            <p className="mt-1">{state.message}</p>
          </div>
        )}

        {state.status === "done" && (
          <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            This payment: exchange rate {state.fxRate}, bank charges {inr(state.computedBankCharges)}.
          </div>
        )}

        <p className="mt-3 text-xs text-muted">
          A partial advance followed later by a balance payment both count: the BOE&apos;s
          confirmed exchange rate is the average rate across every debit advice uploaded here,
          and its bank charges are their sum. Undo removes one advice and recomputes both from
          whatever remains.
        </p>
      </div>
    </section>
  );
}
