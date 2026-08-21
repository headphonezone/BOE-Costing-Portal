"use client";

import { useState } from "react";
import Link from "next/link";
import { PdfUploadPanel } from "@/components/PdfUploadPanel";
import { ManualBoeForm } from "@/components/ManualBoeForm";

type Mode = "pdf" | "manual";

export default function AddRecordPage() {
  const [mode, setMode] = useState<Mode>("pdf");

  return (
    <main
      className={`mx-auto px-6 py-10 ${mode === "pdf" ? "max-w-2xl" : "max-w-6xl"}`}
    >
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Import records
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">Add an import record</h1>
      <p className="mt-1.5 text-sm text-muted">
        Upload the ICEGATE Bill of Entry and it is read automatically, or type the figures
        in by hand if there is no PDF.
      </p>

      <div className="mt-6 mb-8 flex gap-2 border-b border-line pb-3">
        <Tab active={mode === "pdf"} onClick={() => setMode("pdf")}>
          Upload ICEGATE PDF
        </Tab>
        <Tab active={mode === "manual"} onClick={() => setMode("manual")}>
          Enter manually
        </Tab>
      </div>

      {mode === "pdf" ? (
        <PdfUploadPanel onFallback={() => setMode("manual")} />
      ) : (
        <ManualBoeForm />
      )}
    </main>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-blue-600 text-white"
          : "border border-line bg-surface hover:border-blue-400"
      }`}
    >
      {children}
    </button>
  );
}
