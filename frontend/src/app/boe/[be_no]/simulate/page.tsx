import Link from "next/link";
import { getBoeBundle } from "@/lib/actuals";
import { isAdminServer, listScenarioIndexServer, listScenariosServer } from "@/lib/scenarios-server";
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

  // Three reads, deliberately. The scenarios themselves come back only for
  // those this user may open; the index names every one including the locked;
  // and admin status decides whether a lock can be reset from here.
  const [scenarios, index, admin] = await Promise.all([
    listScenariosServer(decoded),
    listScenarioIndexServer(decoded),
    isAdminServer(),
  ]);
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
          {boe.supplier_name ?? "Unknown supplier"} · {boe.inv_no?.includes(",") ? "Invoices" : "Invoice"} {boe.inv_no ?? "—"} ·{" "}
          {date(boe.be_date)} · {items.length} items. Every scenario starts as a copy of the
          actual record; only what you change moves.
        </p>
      </div>

      <SimulationWorkbench
        boe={boe}
        items={items}
        variableFields={variableFields}
        initialScenarios={scenarios}
        initialIndex={index}
        isAdmin={admin}
      />
    </main>
  );
}
