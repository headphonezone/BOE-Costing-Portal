const INR = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

const USD = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `₹${INR.format(n)}`;
}

export function inr0(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `₹${INR0.format(n)}`;
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${USD.format(n)}`;
}

export function qty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Signed delta, for comparison columns. */
export function delta(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}₹${INR.format(n)}`;
}

export function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * DD/MM/YYYY. Formatted by slicing the ISO string rather than going through
 * Date, because `new Date("2026-07-23")` is parsed as UTC midnight and can
 * render as the previous day west of Greenwich.
 */
export function dateDMY(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw;
}

export function date(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
