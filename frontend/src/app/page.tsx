import Link from "next/link";
import { LIST_LIMIT, listBoes } from "@/lib/actuals";
import { BoeTable } from "@/components/BoeTable";
import type { Boe } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let boes: Boe[] = [];
  let error: string | null = null;

  try {
    boes = await listBoes();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not reach Supabase";
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import records</h1>
          <p className="mt-1.5 text-sm text-muted">
            Filter on any column, then open a record to see its costing and run simulations.
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          + Upload BOE
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          Could not load records: {error}
        </div>
      ) : (
        <BoeTable boes={boes} atCap={boes.length >= LIST_LIMIT} />
      )}
    </main>
  );
}
