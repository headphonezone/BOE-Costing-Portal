import Link from "next/link";
import { getBoeBundle, signDocumentUrls } from "@/lib/actuals";
import { computeActual } from "@/lib/costing";
import { date, inr, inr0, usd } from "@/lib/format";
import { API_BASE_URL } from "@/lib/supabase";
import { CostingTable } from "@/components/CostingTable";
import { StatTile } from "@/components/StatTile";

export const dynamic = "force-dynamic";

export default async function BoePage({
  params,
}: {
  params: Promise<{ be_no: string }>;
}) {
  const { be_no } = await params;
  const decoded = decodeURIComponent(be_no);
  const bundle = await getBoeBundle(decoded);

  if (!bundle) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-12">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Search
        </Link>
        <p className="mt-6 text-sm text-muted">No import record found for {decoded}.</p>
      </main>
    );
  }

  const { boe, items, licences, documents, variableFields } = bundle;
  const actual = computeActual(boe, items, variableFields);
  const licenceTotal = licences.reduce((s, l) => s + (l.debit_duty ?? 0), 0);

  // Links are signed per render because the bucket is private. The BOE PDF
  // gets its own button next to the costing: it is the source document every
  // figure on this page was read from, so it is what people reach for when a
  // number looks wrong.
  const docUrls = await signDocumentUrls(documents);
  const boePdf = documents.find((d) => d.doc_type === "BOE");
  const boePdfUrl = boePdf ? docUrls.get(boePdf.storage_path) : undefined;

  const facts: Array<[string, string]> = [
    ["Supplier", boe.supplier_name ?? "—"],
    ["Invoice", boe.inv_no ?? "—"],
    ["Invoice date", date(boe.inv_date)],
    ["BE date", date(boe.be_date)],
    ["AWB / HAWB", boe.hawb_no ?? "—"],
    ["Importer", boe.importer_name ?? "—"],
  ];

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Search
      </Link>

      <div className="mt-3 mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">BE {boe.be_no}</h1>
          <p className="mt-1 text-sm text-muted">
            {boe.supplier_name ?? "Unknown supplier"} · Invoice {boe.inv_no ?? "—"} ·{" "}
            {date(boe.be_date)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/boe/${encodeURIComponent(boe.be_no)}/simulate`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Simulate costing
          </Link>
          {boePdfUrl && (
            <a
              href={boePdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              View BOE PDF
            </a>
          )}
          <a
            href={`${API_BASE_URL}/boe/${encodeURIComponent(boe.be_no)}/excel`}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Download Excel
          </a>
        </div>
      </div>

      {/* Figures come from the costing totals rather than the raw inputs so a
          tile can never disagree with the table footer below it.

          Exchange rate and freight are the two that are routinely estimated
          and settle later, so each carries its status: green once confirmed,
          red while it is still whatever the BOE said. Anything never marked
          fixed counts as provisional -- silence is not confirmation. */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Exchange rate"
          value={inr(actual.inputs.exchangeRate)}
          status={variableFields?.exchange_rate_status === "fixed" ? "actual" : "provisional"}
        />
        <StatTile label="Invoice value" value={usd(boe.inv_value_usd)} />
        <StatTile
          label="Freight"
          value={inr0(actual.totals.freightShare)}
          status={variableFields?.freight_charges_status === "fixed" ? "actual" : "provisional"}
        />
        <StatTile
          label="Expenses"
          value={inr0(actual.totals.otherExpenseShare)}
          sub="excl. freight"
        />
        <StatTile label="Duty in cost" value={inr0(actual.totals.dutyInCost)} />
        <StatTile
          label="Avg cost / pc"
          value={inr(actual.totals.avgCostPerPiece)}
          tone="accent"
          sub={`${actual.totals.qty} pcs`}
        />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Shipment</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
              <dd className="mt-0.5 truncate text-sm" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Actual costing ({items.length} items)</h2>
        <CostingTable result={actual} />
      </section>

      {licences.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold">
            Licences ({licences.length} · {inr0(licenceTotal)} debited)
          </h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5">Licence no</th>
                  <th className="px-3 py-2.5 text-right">Debit duty</th>
                </tr>
              </thead>
              <tbody>
                {licences.map((lic) => (
                  <tr key={lic.id} className="border-t border-line">
                    <td className="px-3 py-2 text-muted">{lic.itemsn}</td>
                    <td className="tnum px-3 py-2 font-mono text-xs">{lic.lic_no ?? "—"}</td>
                    <td className="tnum px-3 py-2 text-right">{inr(lic.debit_duty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {documents.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold">
            Documents ({documents.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">File</th>
                  <th className="px-3 py-2.5">Uploaded</th>
                  <th className="px-3 py-2.5 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const url = docUrls.get(doc.storage_path);
                  return (
                    <tr key={doc.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          {doc.doc_type ?? "other"}
                        </span>
                      </td>
                      <td className="max-w-[28rem] px-3 py-2">
                        <span className="block truncate" title={doc.file_name ?? undefined}>
                          {doc.file_name ?? doc.storage_path}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{date(doc.uploaded_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Open
                          </a>
                        ) : (
                          <span
                            className="text-xs text-muted"
                            title="Indexed in boe_documents but not readable in Storage."
                          >
                            unavailable
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Links are signed and expire an hour after the page is loaded. Reload to renew.
          </p>
        </section>
      )}
    </main>
  );
}
