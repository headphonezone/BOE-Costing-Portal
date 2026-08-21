"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dateDMY, usd } from "@/lib/format";
import type { Boe } from "@/lib/types";

const PAGE_SIZE = 10;

type SortKey = "supplier" | "be_no" | "date" | "value";
type SortDir = "asc" | "desc";

type Filters = {
  supplier: string;
  beNo: string;
  from: string;
  to: string;
  min: string;
  max: string;
};

const EMPTY: Filters = { supplier: "", beNo: "", from: "", to: "", min: "", max: "" };

/**
 * Filtering, sorting and paging all run in the browser over the full list
 * fetched once. For a few hundred records that is instant and avoids a round
 * trip per keystroke; `LIST_LIMIT` in actuals.ts is the guard on that choice.
 */
export function BoeTable({ boes, atCap }: { boes: Boe[]; atCap: boolean }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "date",
    dir: "desc",
  });
  const [page, setPage] = useState(1);

  // Any filter change invalidates the current page number, so reset it here
  // rather than reacting to the change afterwards.
  function setFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }

  const filtered = useMemo(() => {
    const supplier = filters.supplier.trim().toLowerCase();
    const beNo = filters.beNo.trim().toLowerCase();
    const min = filters.min.trim() === "" ? null : Number(filters.min);
    const max = filters.max.trim() === "" ? null : Number(filters.max);

    return boes.filter((b) => {
      if (supplier && !(b.supplier_name ?? "").toLowerCase().includes(supplier)) return false;
      if (beNo && !b.be_no.toLowerCase().includes(beNo)) return false;

      // be_date is stored as ISO (YYYY-MM-DD), so a plain string compare is a
      // correct date compare and needs no parsing.
      if (filters.from && (!b.be_date || b.be_date < filters.from)) return false;
      if (filters.to && (!b.be_date || b.be_date > filters.to)) return false;

      const value = b.inv_value_usd;
      if (min !== null && Number.isFinite(min) && (value ?? 0) < min) return false;
      if (max !== null && Number.isFinite(max) && (value ?? 0) > max) return false;

      return true;
    });
  }, [boes, filters]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "supplier":
          return dir * (a.supplier_name ?? "").localeCompare(b.supplier_name ?? "");
        case "be_no":
          return dir * a.be_no.localeCompare(b.be_no, undefined, { numeric: true });
        case "value":
          return dir * ((a.inv_value_usd ?? 0) - (b.inv_value_usd ?? 0));
        case "date":
        default:
          // Undated records sort last whichever way the column is pointing.
          if (!a.be_date) return 1;
          if (!b.be_date) return -1;
          return dir * a.be_date.localeCompare(b.be_date);
      }
    });
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const rows = sorted.slice(start, start + PAGE_SIZE);
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(EMPTY);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-muted">
          {sorted.length} record{sorted.length === 1 ? "" : "s"}
          {isFiltered && ` of ${boes.length}`}
        </p>
        {isFiltered && (
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY);
              setPage(1);
            }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-muted dark:bg-slate-800/60">
              <Th label="Supplier" active={sort} onClick={() => toggleSort("supplier")} sortKey="supplier" />
              <Th label="BOE No" active={sort} onClick={() => toggleSort("be_no")} sortKey="be_no" />
              {/* Date and Value are centred rather than left/right aligned so
                  the header and the figures sit over the middle of the
                  two-box range filters below them. */}
              <Th label="Date" active={sort} onClick={() => toggleSort("date")} sortKey="date" align="center" />
              <Th label="Value" active={sort} onClick={() => toggleSort("value")} sortKey="value" align="center" />
            </tr>
            <tr className="border-t border-line bg-slate-50 dark:bg-slate-800/30">
              <td className="px-3 py-2">
                <Input
                  value={filters.supplier}
                  onChange={(v) => setFilter("supplier", v)}
                  placeholder="Filter supplier…"
                  aria-label="Filter by supplier"
                />
              </td>
              <td className="px-3 py-2">
                <Input
                  value={filters.beNo}
                  onChange={(v) => setFilter("beNo", v)}
                  placeholder="Filter BOE no…"
                  aria-label="Filter by BOE number"
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <Input
                    type="date"
                    value={filters.from}
                    onChange={(v) => setFilter("from", v)}
                    aria-label="Filter from date"
                  />
                  <span className="text-[10px] text-muted">to</span>
                  <Input
                    type="date"
                    value={filters.to}
                    onChange={(v) => setFilter("to", v)}
                    aria-label="Filter to date"
                  />
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={filters.min}
                    onChange={(v) => setFilter("min", v)}
                    placeholder="Min"
                    aria-label="Filter minimum value"
                  />
                  <span className="text-[10px] text-muted">–</span>
                  <Input
                    type="number"
                    value={filters.max}
                    onChange={(v) => setFilter("max", v)}
                    placeholder="Max"
                    aria-label="Filter maximum value"
                  />
                </div>
              </td>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-14 text-center text-sm text-muted">
                  {boes.length === 0
                    ? "No import records yet. Upload a BOE through the existing app first."
                    : "Nothing matches these filters."}
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const href = `/boe/${encodeURIComponent(b.be_no)}`;
                return (
                  <tr
                    key={b.be_no}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open BE ${b.be_no}`}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(href);
                    }}
                    className="cursor-pointer border-t border-line transition hover:bg-blue-50/60 focus:bg-blue-50/60 focus:outline-none dark:hover:bg-blue-950/20 dark:focus:bg-blue-950/20"
                  >
                    <td className="px-3 py-2.5 font-medium">
                      {/* A real link so ctrl/middle click opens a new tab; the
                          row handler covers a plain click anywhere else. */}
                      <Link
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {b.supplier_name ?? "—"}
                      </Link>
                    </td>
                    <td className="tnum px-3 py-2.5">BE {b.be_no}</td>
                    <td className="tnum px-3 py-2.5 text-center">{dateDMY(b.be_date)}</td>
                    <td className="tnum px-3 py-2.5 text-center">{usd(b.inv_value_usd)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted">
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} of {sorted.length}
          </p>
          <Pager page={current} totalPages={totalPages} onChange={setPage} />
        </div>
      )}

      {atCap && (
        <p className="text-xs text-muted">
          Showing the most recent {boes.length} records only. Filters apply to those.
        </p>
      )}
    </div>
  );
}

function Th({
  label,
  sortKey,
  active,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: { key: SortKey; dir: SortDir };
  onClick: () => void;
  align?: "left" | "center" | "right";
}) {
  const on = active.key === sortKey;
  const alignClass = { left: "text-left", center: "text-center", right: "text-right" }[align];
  return (
    <th className={`px-3 py-2.5 ${alignClass}`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
      >
        {label}
        <span className={on ? "text-blue-600" : "text-transparent"}>
          {on && active.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  ...rest
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
} & React.AriaAttributes) {
  return (
    <input
      {...rest}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 rounded border border-line bg-surface px-2 py-1 text-xs font-normal normal-case tracking-normal text-foreground outline-none placeholder:text-muted focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
    />
  );
}

/** Compact pager: first, a window around the current page, last. */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  if (totalPages <= 1) return null;

  const window = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const pages = [...window].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  return (
    <div className="flex items-center gap-1">
      <PageButton disabled={page === 1} onClick={() => onChange(page - 1)}>
        Prev
      </PageButton>

      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && pages[i - 1] !== p - 1 && <span className="px-1 text-xs text-muted">…</span>}
          <PageButton active={p === page} onClick={() => onChange(p)}>
            {p}
          </PageButton>
        </span>
      ))}

      <PageButton disabled={page === totalPages} onClick={() => onChange(page + 1)}>
        Next
      </PageButton>
    </div>
  );
}

function PageButton({
  children,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-8 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-line bg-surface hover:border-blue-400 disabled:hover:border-line"
      }`}
    >
      {children}
    </button>
  );
}
