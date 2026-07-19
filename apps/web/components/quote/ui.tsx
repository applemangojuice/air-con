"use client";

import { useEffect, useRef, type ReactNode } from "react";

export const inputCls =
  "w-full rounded-full border border-line bg-white px-5 py-3 text-base outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-900">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-300">{hint}</span>}
    </label>
  );
}

export interface Option<T extends string | number | boolean> {
  value: T;
  label: string;
  hint?: string;
}

export function OptionCards<T extends string | number | boolean>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div className={`grid gap-2 ${columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={`rounded-2xl border px-3 py-3 text-left transition ${
              selected
                ? "border-accent-600 bg-accent-50 ring-2 ring-accent-100"
                : "border-line bg-white hover:border-ink-300"
            }`}
          >
            <span className={`block text-sm font-semibold ${selected ? "text-accent-700" : "text-ink-900"}`}>
              {o.label}
            </span>
            {o.hint && <span className="mt-0.5 block text-xs text-ink-300">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact 1…N+ number picker, narrow buttons in a single row. */
export function NumberRow({
  value,
  onChange,
  max,
  maxLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  max: number;
  maxLabel?: string;
}) {
  const options = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="flex gap-1.5">
      {options.map((n) => {
        const selected = n === value;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(n)}
            className={`h-11 flex-1 rounded-xl border text-sm font-semibold transition ${
              selected
                ? "border-accent-600 bg-accent-50 text-accent-700 ring-2 ring-accent-100"
                : "border-line bg-white text-ink-900 hover:border-ink-300"
            }`}
          >
            {n === max && maxLabel ? maxLabel : n}
          </button>
        );
      })}
    </div>
  );
}

export function StepShell({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  busy = false,
}: {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Speed: land the cursor in the first empty text field of each step, so
  // typing starts immediately (postcode, then name) without a tap.
  useEffect(() => {
    const first = contentRef.current?.querySelector<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    );
    if (first && !first.value) first.focus({ preventScroll: true });
  }, [step]);

  return (
    // A form so Enter in any field advances the step — every child button
    // declares type="button", so submit can only mean "continue".
    <form
      className="mx-auto w-full max-w-xl px-4 pb-24 pt-8 sm:px-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (onNext && !nextDisabled && !busy) onNext();
      }}
      onKeyDown={(e) => {
        // Inputs inside sub-editors (e.g. renaming a room) opt out of
        // Enter-to-advance: Enter there commits the field, not the step.
        if (
          e.key === "Enter" &&
          e.target instanceof HTMLInputElement &&
          e.target.dataset.noSubmit !== undefined
        ) {
          e.preventDefault();
          e.target.blur();
        }
      }}
    >
      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-xs font-medium text-ink-300">
          <span>
            Step {step + 1} of {totalSteps}
          </span>
          <span>{Math.round(((step + 1) / totalSteps) * 100)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent-500 transition-all duration-500"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <h1 className="text-2xl font-display sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 text-ink-500">{subtitle}</p>}

      <div ref={contentRef} className="mt-8 space-y-6">
        {children}
      </div>

      {(onBack || onNext) && (
        <div className="mt-10 flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-line px-5 py-3 font-semibold text-ink-700 transition hover:bg-surface"
            >
              Back
            </button>
          )}
          {onNext && (
            <button
              type="submit"
              disabled={nextDisabled || busy}
              className="flex-1 rounded-full bg-accent-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "One moment…" : nextLabel}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
