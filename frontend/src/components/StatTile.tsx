/**
 * A figure that is either confirmed or still an estimate. `status` colours
 * the whole tile rather than adding a small badge alone, because the point is
 * to make an unsettled number impossible to mistake for a settled one at a
 * glance across a row of tiles.
 */
export type FigureStatus = "actual" | "provisional";

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  status,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "accent";
  status?: FigureStatus;
}) {
  const toneClass = {
    default: "text-foreground",
    accent: "text-blue-600 dark:text-blue-400",
    positive: "text-emerald-600 dark:text-emerald-400",
    negative: "text-red-600 dark:text-red-400",
  }[tone];

  const cardClass = status
    ? status === "actual"
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/25"
    : "border-line bg-surface";

  return (
    <div className={`rounded-xl border px-4 py-3 ${cardClass}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
        {status && <StatusChip status={status} />}
      </div>
      <div className={`tnum mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="tnum mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function StatusChip({ status }: { status: FigureStatus }) {
  return status === "actual" ? (
    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
      Actual
    </span>
  ) : (
    <span className="rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
      As per BOE
    </span>
  );
}
