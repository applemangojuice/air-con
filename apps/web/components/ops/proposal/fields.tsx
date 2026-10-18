"use client";

import { useEffect, useId, useState } from "react";
import { inputClass, textareaClass } from "@/components/kit";

/**
 * Small controlled fields for the proposal builder: a one-item-per-line
 * list editor and a pounds input that stores integer pence.
 */

/** One item per line; blank lines dropped on save (not while typing). */
export function LinesField({
  label,
  hint,
  value,
  onChange,
  rows = 6,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  rows?: number;
}) {
  const id = useId();
  const [text, setText] = useState(value.join("\n"));
  // Follow outside changes (a reset to defaults) without fighting the cursor.
  useEffect(() => {
    if (value.join("\n") !== text.split("\n").filter((l) => l.trim()).join("\n")) setText(value.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-900">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className={`${textareaClass} text-sm`}
        value={text}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean));
        }}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/** "1,234.50" → 123450; "" → undefined; junk → NaN (the caller says so). */
export function parsePounds(raw: string): number | undefined {
  const clean = raw.replace(/[£,\s]/g, "");
  if (!clean) return undefined;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
}

export const poundsText = (pence: number | null | undefined) =>
  pence === null || pence === undefined || !Number.isFinite(pence) ? "" : (pence / 100).toFixed(pence % 100 === 0 ? 0 : 2);

/** A pounds amount held as pence. Keeps the typed text while it's being typed. */
export function PoundsInput({
  id,
  value,
  onChange,
  placeholder,
  compact = false,
  ariaLabel,
  describedBy,
}: {
  id?: string;
  value: number | undefined | null;
  onChange: (pence: number | undefined) => void;
  placeholder?: string;
  compact?: boolean;
  ariaLabel?: string;
  describedBy?: string;
}) {
  const [text, setText] = useState(poundsText(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const parsed = parsePounds(text);
    if (parsed !== (value ?? undefined) && !(Number.isNaN(parsed) && bad)) setText(poundsText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={`relative ${compact ? "w-28" : ""}`}>
      <span aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-500 ${compact ? "left-3 text-sm" : "left-4"}`}>
        £
      </span>
      <input
        id={id}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={bad || undefined}
        placeholder={placeholder}
        className={compact ? "min-h-10 w-full rounded-full border border-line bg-white py-1.5 pl-6 pr-3 text-right text-sm tabular-nums outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 aria-invalid:border-red-600" : `${inputClass} pl-8 tabular-nums`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = parsePounds(e.target.value);
          if (p !== undefined && Number.isNaN(p)) {
            setBad(true);
            return;
          }
          setBad(false);
          onChange(p);
        }}
      />
    </div>
  );
}

/** A number with a step, for days and percentages. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-900">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-h-11 w-24 rounded-full border border-line bg-white px-4 text-base tabular-nums outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
        {suffix && <span className="text-sm text-ink-500">{suffix}</span>}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      )}
    </div>
  );
}
