import Link from "next/link";
import { getBoeBundle } from "@/lib/actuals";
import { listScenarios } from "@/lib/scenarios";
import { date } from "@/lib/format";
import { SimulationWorkbench } from "@/components/SimulationWorkbench";

export const dynamic = "force-dynamic";

export default async function SimulatePage({
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

  const scenarios = await listScenarios(decoded);
  const { boe, items, variableFields } = bundle;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link
        href={`/boe/${encodeURIComponent(boe.be_no)}`}
        className="text-sm text-blue-600 hover:underline"
      >
        ← BE {boe.be_no}
      </Link>

      <div className="mt-3 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Simulated costing</h1>
        <p className="mt-1 text-sm text-muted">
          {boe.supplier_name ?? "Unknown supplier"} · Invoice {boe.inv_no ?? "—"} ·{" "}
          {date(boe.be_date)} · {items.length} items. Every scenario starts as a copy of the
          actual record; only what you change moves.
        </p>
      </div>

      <SimulationWorkbench
        boe={boe}
        items={items}
        variableFields={variableFields}
        initialScenarios={scenarios}
      />
    </main>
  );
}
