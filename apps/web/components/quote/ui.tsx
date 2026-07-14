"use client";

import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none transition focus:border-air-500 focus:ring-2 focus:ring-air-100";

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
            className={`rounded-xl border px-3 py-3 text-left transition ${
              selected
                ? "border-air-600 bg-air-50 ring-2 ring-air-100"
                : "border-line bg-white hover:border-ink-300"
            }`}
          >
            <span className={`block text-sm font-semibold ${selected ? "text-air-700" : "text-ink-900"}`}>
              {o.label}
            </span>
            {o.hint && <span className="mt-0.5 block text-xs text-ink-300">{o.hint}</span>}
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
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-8 sm:px-0">
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
            className="h-full rounded-full bg-air-500 transition-all duration-500"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 text-ink-500">{subtitle}</p>}

      <div className="mt-8 space-y-6">{children}</div>

      {(onBack || onNext) && (
        <div className="mt-10 flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-line px-5 py-3 font-semibold text-ink-700 transition hover:bg-mist"
            >
              Back
            </button>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              disabled={nextDisabled || busy}
              className="flex-1 rounded-xl bg-air-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-air-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "One moment…" : nextLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
