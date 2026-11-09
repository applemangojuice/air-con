"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { primaryBtn, secondaryBtn } from "@/components/site/styles";
import { LegalLinks } from "./legal-links";

/**
 * Funnel primitives. Accessibility rules from the audit:
 *  * text inputs get a real <label for>; option groups are a fieldset with a
 *    legend, never wrapped in a <label>;
 *  * options are native radios (arrow keys, one tab stop, announced as
 *    "2 of 4"), styled as cards, with a visible focus ring;
 *  * no autofocus: it pops the keyboard over the question on a phone. On a
 *    step change focus moves to the step heading instead, so screen readers
 *    hear where they are;
 *  * secondary text is ink-500 and small-text buttons are accent-700, both
 *    AA on white and cream.
 */

export const inputCls =
  "w-full min-h-12 rounded-full border border-line bg-white px-5 py-3 text-base text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 aria-invalid:border-red-600";

export { primaryBtn, secondaryBtn };

/** A labelled text control. The render prop receives the id and description wiring. */
export function TextField({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-900">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-500">(optional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-relaxed text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** A group of options under a real legend. */
export function Group({
  legend,
  hint,
  children,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className="min-w-0" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-ink-900">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="-mt-0.5 mb-2 text-xs leading-relaxed text-ink-500">
          {hint}
        </p>
      )}
      {children}
    </fieldset>
  );
}

export interface Option<T extends string | number | boolean> {
  value: T;
  label: string;
  hint?: string;
}

const cardCls = (selected: boolean, locked = false) =>
  `relative flex h-full flex-col rounded-2xl border px-3 py-3 text-left transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-2 ${
    selected
      ? "border-accent-700 bg-accent-50 ring-1 ring-accent-700"
      : locked
        ? "border-line bg-white opacity-50"
        : "border-line bg-white hover:border-ink-500"
  } ${locked ? "cursor-default" : "cursor-pointer"}`;

/**
 * Option cards as native radios. Put them inside a <Group> for the legend.
 * `locked` shows the answer without letting it change (the price screen:
 * what we assumed, and how you'd change it, once you've gone through Edit).
 */
export function OptionCards<T extends string | number | boolean>({
  options,
  value,
  onChange,
  columns = 2,
  locked = false,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
  locked?: boolean;
}) {
  const name = useId();
  return (
    <div className={`grid gap-2 ${columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <label key={String(o.value)} className={cardCls(selected, locked)}>
            <input
              type="radio"
              name={name}
              value={i}
              checked={selected}
              disabled={locked}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className={`block text-sm font-semibold ${selected ? "text-accent-700" : "text-ink-900"}`}>
              {o.label}
            </span>
            {o.hint && <span className="mt-0.5 block text-xs text-ink-500">{o.hint}</span>}
          </label>
        );
      })}
    </div>
  );
}

/**
 * A locked question on the price screen: the same look as a <Group>, with
 * the answer highlighted and one action, Edit, which opens the form (after
 * the email gate).
 */
export function LockedGroup({
  legend,
  onEdit,
  children,
}: {
  legend: ReactNode;
  onEdit: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p id={id} className="text-sm font-semibold text-ink-900">
          {legend}
        </p>
        <button
          type="button"
          onClick={onEdit}
          className="min-h-9 shrink-0 rounded-full border border-line bg-white px-3 text-xs font-semibold text-accent-700 transition hover:bg-accent-50"
        >
          Edit<span className="sr-only">: {legend}</span>
        </button>
      </div>
      {children}
    </div>
  );
}

/** Compact 1…N+ picker, as radios in one row. Put it inside a <Group>. */
export function NumberRow({
  value,
  onChange,
  max,
  maxLabel,
  locked = false,
}: {
  value: number;
  onChange: (value: number) => void;
  max: number;
  maxLabel?: string;
  locked?: boolean;
}) {
  const name = useId();
  const options = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="flex gap-1.5">
      {options.map((n) => {
        const selected = n === value;
        return (
          <label
            key={n}
            className={`flex h-12 flex-1 items-center justify-center rounded-xl border text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-2 ${
              selected
                ? "border-accent-700 bg-accent-50 text-accent-700 ring-1 ring-accent-700"
                : locked
                  ? "border-line bg-white text-ink-900 opacity-50"
                  : "border-line bg-white text-ink-900 hover:border-ink-500"
            } ${locked ? "cursor-default" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={selected}
              disabled={locked}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            {n === max && maxLabel ? maxLabel : n}
          </label>
        );
      })}
    </div>
  );
}

/** Step progress as a real progressbar: announced as "Step 2 of 5". */
export function Progress({ step, totalSteps }: { step: number; totalSteps: number }) {
  const n = step + 1;
  const pct = Math.round((n / totalSteps) * 100);
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between text-xs font-medium text-ink-500" aria-hidden>
        <span>
          Step {n} of {totalSteps}
        </span>
        <span>{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Your quote"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={n}
        aria-valuetext={`Step ${n} of ${totalSteps}`}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-accent-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function StepShell({
  step,
  totalSteps,
  progressStep,
  title,
  subtitle,
  badge,
  children,
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  busy = false,
  busyLabel = "One moment…",
  footer,
}: {
  /** Which screen this is (focus moves to the heading when it changes). */
  step: number;
  /** Steps in the progress bar; omit it (or 0) on screens outside the numbered form, such as the price itself. */
  totalSteps?: number;
  /** The step's position in the progress bar, when it differs from `step`. */
  progressStep?: number;
  title: string;
  subtitle?: ReactNode;
  badge?: string;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /** Extra content under the buttons (e.g. a save error with a retry). */
  footer?: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Focus the heading when the step changes (not on first load): screen
  // readers hear the new question, and no keyboard pops up over it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  return (
    // A form so Enter in a text field advances the step. Every other button
    // declares type="button", so submit can only mean "continue".
    <form
      noValidate
      className="mx-auto w-full max-w-xl px-4 pb-16 pt-8 sm:px-0"
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
      {totalSteps ? <Progress step={progressStep ?? step} totalSteps={totalSteps} /> : <div className="mb-8" />}

      <div className="flex flex-wrap items-center gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-display outline-none sm:text-3xl">
          {title}
        </h1>
        {badge && (
          <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-xs font-semibold text-ink-700">
            {badge}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-2 text-ink-500">{subtitle}</p>}

      <div className="mt-8 space-y-7">{children}</div>

      {(onBack || onNext) && (
        <div className="mt-10 flex items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className={secondaryBtn}>
              Back
            </button>
          )}
          {onNext && (
            <button
              type="submit"
              disabled={nextDisabled || busy}
              aria-busy={busy || undefined}
              className={`${primaryBtn} flex-1`}
            >
              {busy ? busyLabel : nextLabel}
            </button>
          )}
        </div>
      )}
      {footer}
      <LegalLinks className="mt-8" />
    </form>
  );
}
