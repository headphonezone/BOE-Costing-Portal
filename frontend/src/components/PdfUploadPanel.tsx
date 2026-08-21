"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/supabase";

type Result = {
  fileName: string;
  be_no: string;
  items_saved: number;
  licences_saved: number;
};

type State =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "error"; fileName: string; message: string; offline: boolean }
  | { status: "done"; result: Result };

export function PdfUploadPanel({ onFallback }: { onFallback: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setState({
        status: "error",
        fileName: file.name,
        message: "That is not a PDF. Upload the Bill of Entry PDF from ICEGATE.",
        offline: false,
      });
      return;
    }

    setState({ status: "uploading", fileName: file.name });

    const body = new FormData();
    body.append("file", file);

    try {
      const res = await fetch(`${API_BASE_URL}/boe/upload`, { method: "POST", body });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || `The parser rejected this file (${res.status}).`);
      }

      const data = await res.json();
      setState({
        status: "done",
        result: {
          fileName: file.name,
          be_no: data.be_no,
          items_saved: data.items_saved,
          licences_saved: data.licences_saved,
        },
      });
      // The records list is server-rendered, so it needs telling its data is
      // stale -- otherwise the new BOE will not appear on it.
      router.refresh();
    } catch (err) {
      // A fetch that never reached the server throws TypeError rather than
      // returning a status: the signature of the parser service being down.
      const offline = err instanceof TypeError;
      setState({
        status: "error",
        fileName: file.name,
        message: offline
          ? `Could not reach the parser service at ${API_BASE_URL}.`
          : err instanceof Error
            ? err.message
            : "Upload failed.",
        offline,
      });
    }
  }

  const busy = state.status === "uploading";

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Choose a Bill of Entry PDF"
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
          busy
            ? "cursor-wait border-line bg-surface"
            : dragOver
              ? "cursor-pointer border-blue-500 bg-blue-50 dark:bg-blue-950/30"
              : "cursor-pointer border-line bg-surface hover:border-blue-400"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Reset so re-picking the same file still fires onChange.
            e.target.value = "";
          }}
        />

        {busy ? (
          <>
            <div className="mb-3 size-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm font-medium">Reading {state.fileName}…</p>
            <p className="mt-1 text-xs text-muted">
              Large BOEs with many invoices can take a few seconds
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">Drag a BOE PDF here, or click to browse</p>
            <p className="mt-1 text-xs text-muted">PDF only</p>
          </>
        )}
      </div>

      {state.status === "error" && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-medium">Could not import {state.fileName}</p>
          <p className="mt-1">{state.message}</p>

          {state.offline && (
            <div className="mt-3 rounded border border-red-200 bg-white/60 p-3 text-xs dark:border-red-900 dark:bg-black/20">
              <p className="mb-1.5 font-medium">Start the parser service, then try again:</p>
              <code className="block break-all font-mono">
                uvicorn backend.main:app --port 8000
              </code>
              <p className="mt-1.5 opacity-80">
                Run it from the BOE-Costing-Sheet folder, with SUPABASE_URL and SUPABASE_KEY set.
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setState({ status: "idle" })}
              className="font-medium underline underline-offset-2"
            >
              Try another file
            </button>
            <button
              type="button"
              onClick={onFallback}
              className="font-medium underline underline-offset-2"
            >
              Enter it by hand instead
            </button>
          </div>
        </div>
      )}

      {state.status === "done" && (
        <div className="mt-6 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="font-medium">Imported BE {state.result.be_no}</p>
          <p className="mt-1">
            {state.result.items_saved} item{state.result.items_saved === 1 ? "" : "s"} and{" "}
            {state.result.licences_saved} licence row
            {state.result.licences_saved === 1 ? "" : "s"} saved from {state.result.fileName}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push(`/boe/${encodeURIComponent(state.result.be_no)}`)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white transition hover:bg-emerald-700"
            >
              Open record
            </button>
            <button
              type="button"
              onClick={() => setState({ status: "idle" })}
              className="rounded-lg border border-emerald-300 px-3 py-1.5 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              Upload another
            </button>
          </div>
        </div>
      )}

      <p className="mt-8 text-xs text-muted">
        Re-uploading the same BOE replaces its items and licences rather than duplicating
        them, so it is safe to import a file again after a parser fix.
      </p>
    </>
  );
}
