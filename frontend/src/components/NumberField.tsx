"use client";

import { useState } from "react";
import { StatusChip } from "./StatTile";

/**
 * A numeric input where empty means "inherit the actual value" rather than
 * "zero". The inherited figure shows as the placeholder, so a field that has
 * not been touched still reads as the number it will actually use.
 */
export function NumberField({
  label,
  value,
  inherited,
  onChange,
  prefix,
  suffix,
  hint,
  step = "any",
  disabled,
  autoActualStatus,
}: {
  label: string;
  value: number | null;
  inherited?: number | null;
  onChange: (next: number | null) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  step?: string;
  disabled?: boolean;
  /**
   * No separate "Actual" checkbox for this field -- typing a value marks it
   * actual immediately (a green chip appears), clearing it goes back to
   * provisional/inherited. For a field with no real "estimate until
   * confirmed" step, unlike freight/clearance which keep a manual tick
   * because an operator may want to show a number without yet vouching for
   * it.
   */
  autoActualStatus?: boolean;
}) {
  // Kept as a string so a half-typed "1." or "-" survives a re-render.
  const [text, setText] = useState(value === null ? "" : String(value));

  // Resync when the value changes from outside (a reset, or switching to
  // another scenario). Adjusting state during render rather than in an effect
  // avoids the extra render pass -- and typing never trips it, because the
  // value we just reported back parses to the number we already hold.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value === null ? "" : String(value));
  }

  function commit(raw: string) {
    setText(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

  const isInherited = value === null;

  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
        {autoActualStatus ? (
          // No "provisional" chip when empty: StatusChip's provisional label
          // is "As per BOE", which would be untrue of a field the BOE never
          // carries at all -- so blank just shows nothing, same as any other
          // untouched field, and the chip only appears once there is
          // something to actually call actual.
          !isInherited && <StatusChip status="actual" />
        ) : (
          isInherited &&
          inherited != null && (
            <span className="font-normal normal-case tracking-normal">inherited</span>
          )
        )}
      </span>
      <span className="mt-1 flex items-center rounded-lg border border-line bg-surface focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
        {prefix && <span className="pl-2.5 text-sm text-muted">{prefix}</span>}
        <input
          type="number"
          step={step}
          inputMode="decimal"
          disabled={disabled}
          value={text}
          onChange={(e) => commit(e.target.value)}
          // A number input changes value on mouse-wheel scroll while
          // focused -- useful on nothing here, and a real hazard right
          // after clicking a field: the next scroll of the page silently
          // edits a cost figure. Blurring on wheel hands the scroll back to
          // the page instead of the input.
          onWheel={(e) => e.currentTarget.blur()}
          placeholder={inherited != null ? String(round(inherited)) : "0"}
          className="tnum w-full bg-transparent px-2.5 py-2 text-sm outline-none disabled:opacity-50"
        />
        {suffix && <span className="pr-2.5 text-xs text-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
