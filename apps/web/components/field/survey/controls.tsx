"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * Survey form controls for a phone in one hand: every choice is a big
 * button (at least 48 px), groups are real fieldsets with legends, inputs
 * have real labels, and ids follow `f-<field>` so the completeness list
 * can jump straight to what's missing. Secondary text is ink-500.
 */

export const fieldId = (field: string) => `f-${field}`;

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Options from a label map, optionally a subset in a given order. */
export const choices = <T extends string>(labels: Record<T, string>, order?: readonly NoInfer<T>[]): Choice<T>[] =>
  (order ?? (Object.keys(labels) as T[])).map((value) => ({ value, label: labels[value] }));

/** A single-choice group (radio buttons drawn as large pills). Nothing is picked until someone picks. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  field,
  value,
  options,
  onChange,
  columns = 2,
  missing,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  field: string;
  value: T | undefined;
  options: Choice<T>[];
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3 | 4;
  missing?: boolean;
}) {
  const name = useId();
  const cols = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns];
  return (
    <fieldset id={fieldId(field)} tabIndex={-1} className="min-w-0 scroll-mt-40 outline-none">
      <legend className="mb-1 text-base font-semibold text-ink-900">
        {legend}
        {missing && <MissingTag />}
      </legend>
      {hint && <p className="mb-2 text-sm text-ink-500">{hint}</p>}
      <div className={`grid gap-2 ${cols}`}>
        {options.map((o) => (
          <label key={o.value} className="relative block min-w-0">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="flex min-h-12 w-full cursor-pointer flex-col justify-center rounded-2xl border border-line bg-white px-3 py-2 text-left text-base font-medium text-ink-900 transition peer-checked:border-accent-600 peer-checked:bg-accent-50 peer-checked:text-accent-700 peer-checked:ring-1 peer-checked:ring-accent-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500 hover:border-ink-300">
              <span className="leading-snug">{o.label}</span>
              {o.hint && <span className="mt-0.5 text-xs font-normal text-ink-500">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A long list the person rarely changes (room type, wall construction): the phone's own picker. */
export function SelectField<T extends string>({
  label,
  hint,
  field,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: ReactNode;
  hint?: ReactNode;
  field: string;
  value: T | undefined;
  options: Choice<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const id = fieldId(field);
  return (
    <div className="min-w-0 scroll-mt-40">
      <label htmlFor={id} className="mb-1 block text-base font-semibold text-ink-900">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-500">
          {hint}
        </p>
      )}
      <div className="relative">
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => e.target.value && onChange(e.target.value as T)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-h-12 w-full appearance-none rounded-full border border-line bg-white px-4 pr-10 text-base text-ink-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        >
          {value === undefined && <option value="">{placeholder ?? "Choose…"}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </div>
    </div>
  );
}

/** Several at once (checkbox pills). */
export function MultiChoice<T extends string>({
  legend,
  hint,
  field,
  values,
  options,
  onChange,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  field: string;
  values: T[];
  options: Choice<T>[];
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset id={fieldId(field)} tabIndex={-1} className="min-w-0 scroll-mt-40 outline-none">
      <legend className="mb-1 text-base font-semibold text-ink-900">{legend}</legend>
      {hint && <p className="mb-2 text-sm text-ink-500">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <label key={o.value} className="relative">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
                className="peer sr-only"
              />
              <span className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-4 text-base font-medium text-ink-900 transition peer-checked:border-accent-600 peer-checked:bg-accent-50 peer-checked:text-accent-700 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500">
                {on && (
                  <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                )}
                {o.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Yes / No, unanswered until tapped. */
export function YesNo({
  legend,
  hint,
  field,
  value,
  onChange,
  missing,
  yes = "Yes",
  no = "No",
}: {
  legend: ReactNode;
  hint?: ReactNode;
  field: string;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  missing?: boolean;
  yes?: string;
  no?: string;
}) {
  return (
    <ChoiceGroup
      legend={legend}
      hint={hint}
      field={field}
      missing={missing}
      value={value === undefined ? undefined : value ? "yes" : "no"}
      options={[
        { value: "yes", label: yes },
        { value: "no", label: no },
      ]}
      onChange={(v) => onChange(v === "yes")}
    />
  );
}

/** A number with its unit. Keeps what's typed ("3.") while it's being typed; empty means not answered. */
export function NumberField({
  label,
  hint,
  field,
  value,
  onChange,
  unit,
  min = 0,
  max = 1000,
  integer = false,
  missing,
  allowNegative = false,
  suggestions,
}: {
  label: ReactNode;
  hint?: ReactNode;
  field: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  unit?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  missing?: boolean;
  allowNegative?: boolean;
  /** Quick-pick values shown as chips. */
  suggestions?: number[];
}) {
  const id = fieldId(field);
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  // Follow outside changes (undo, a restored copy) without fighting what's being typed.
  useEffect(() => {
    const t = text.trim().replace(",", ".");
    const parsed = t === "" || t === "-" || t === "." ? undefined : Number(t);
    if (parsed !== value) {
      setText(value === undefined ? "" : String(value));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const set = (raw: string) => {
    setText(raw);
    const t = raw.trim().replace(",", ".");
    if (t === "" || t === "-" || t === ".") {
      setError(null);
      onChange(undefined);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
      setError(integer ? "Whole numbers only." : "That isn't a number.");
      return;
    }
    if (n < min || n > max) {
      setError(`Between ${min} and ${max}${unit ? ` ${unit}` : ""}.`);
      return;
    }
    setError(null);
    onChange(n);
  };
  return (
    <div className="min-w-0 scroll-mt-40">
      <label htmlFor={id} className="mb-1 block text-base font-semibold text-ink-900">
        {label}
        {missing && <MissingTag />}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-500">
          {hint}
        </p>
      )}
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode={integer ? "numeric" : allowNegative ? "text" : "decimal"}
          autoComplete="off"
          value={text}
          onChange={(e) => set(e.target.value)}
          aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined}
          className="min-h-12 w-full rounded-full border border-line bg-white px-4 pr-14 text-lg tabular-nums text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 aria-invalid:border-red-600"
        />
        {unit && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base text-ink-500">{unit}</span>}
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set(String(s))}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition ${value === s ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-700 hover:border-ink-300"}`}
            >
              {s}
              {unit ? ` ${unit}` : ""}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  field,
  value,
  onChange,
  placeholder,
  maxLength = 200,
  missing,
  type = "text",
  autoComplete = "off",
}: {
  label: ReactNode;
  hint?: ReactNode;
  field: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  missing?: boolean;
  type?: "text" | "tel" | "email";
  autoComplete?: string;
}) {
  const id = fieldId(field);
  return (
    <div className="min-w-0 scroll-mt-40">
      <label htmlFor={id} className="mb-1 block text-base font-semibold text-ink-900">
        {label}
        {missing && <MissingTag />}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-500">
          {hint}
        </p>
      )}
      <input
        id={id}
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="min-h-12 w-full rounded-full border border-line bg-white px-4 text-base text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
    </div>
  );
}

export function TextArea({
  label,
  hint,
  field,
  value,
  onChange,
  placeholder,
  maxLength = 1000,
  missing,
  rows = 3,
}: {
  label: ReactNode;
  hint?: ReactNode;
  field: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  missing?: boolean;
  rows?: number;
}) {
  const id = fieldId(field);
  return (
    <div className="min-w-0 scroll-mt-40">
      <label htmlFor={id} className="mb-1 block text-base font-semibold text-ink-900">
        {label}
        {missing && <MissingTag />}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-500">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        rows={rows}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base leading-relaxed text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
    </div>
  );
}

/** A full-width tick row (the label is the target). */
export function Tick({
  label,
  hint,
  field,
  checked,
  onChange,
  missing,
}: {
  label: ReactNode;
  hint?: ReactNode;
  field: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  missing?: boolean;
}) {
  const id = fieldId(field);
  return (
    <label
      htmlFor={id}
      className={`flex min-h-14 cursor-pointer scroll-mt-40 items-start gap-3 rounded-2xl border px-4 py-3 transition ${checked ? "border-accent-600 bg-accent-50" : "border-line bg-white"}`}
    >
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-accent-600" />
      <span className="min-w-0 text-base text-ink-900">
        <span className="font-semibold">{label}</span>
        {missing && !checked && <MissingTag />}
        {hint && <span className="mt-0.5 block text-sm text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

export function MissingTag() {
  return <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-semibold text-amber-900">To do</span>;
}

/** Which way the windows face: four big compass buttons and "not sure". */
export function CompassPicker({
  value,
  onChange,
  missing,
  field = "orientation",
}: {
  value: "north" | "east" | "south" | "west" | "unsure";
  onChange: (v: "north" | "east" | "south" | "west" | "unsure") => void;
  missing?: boolean;
  field?: string;
}) {
  const name = useId();
  const btn = (v: "north" | "east" | "south" | "west", label: string, cls: string) => (
    <label className={`absolute ${cls}`}>
      <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="peer sr-only" />
      <span className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-lg font-bold text-ink-900 shadow-sm transition peer-checked:border-accent-700 peer-checked:bg-accent-700 peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500">
        <span aria-hidden>{label[0]}</span>
        <span className="sr-only">{label}</span>
      </span>
    </label>
  );
  return (
    <fieldset id={fieldId(field)} tabIndex={-1} className="min-w-0 scroll-mt-40 outline-none">
      <legend className="mb-1 text-base font-semibold text-ink-900">
        Which way do the main windows face?
        {missing && <MissingTag />}
      </legend>
      <p className="mb-2 text-sm text-ink-500">Use your phone&apos;s compass, standing at the window and looking out.</p>
      <div className="flex items-center gap-4">
        <div className="relative h-44 w-44 shrink-0 rounded-full border border-dashed border-line bg-surface/60">
          <span aria-hidden className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-300" />
          {btn("north", "North", "left-1/2 top-0 -translate-x-1/2")}
          {btn("east", "East", "right-0 top-1/2 -translate-y-1/2")}
          {btn("south", "South", "bottom-0 left-1/2 -translate-x-1/2")}
          {btn("west", "West", "left-0 top-1/2 -translate-y-1/2")}
        </div>
        <label className="relative">
          <input type="radio" name={name} value="unsure" checked={value === "unsure"} onChange={() => onChange("unsure")} className="peer sr-only" />
          <span className="flex min-h-12 cursor-pointer items-center rounded-full border border-line bg-white px-4 text-base font-medium text-ink-700 transition peer-checked:border-ink-700 peer-checked:bg-surface peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-500">
            Not sure yet
          </span>
        </label>
      </div>
    </fieldset>
  );
}

/** A white card that groups a section's fields. */
export function FieldCard({ title, children, tone = "plain" }: { title?: ReactNode; children: ReactNode; tone?: "plain" | "warn" | "danger" }) {
  const tones = { plain: "border-line bg-white", warn: "border-amber-200 bg-amber-50", danger: "border-red-200 bg-red-50" };
  return (
    <section className={`space-y-5 rounded-2xl border p-4 ${tones[tone]}`}>
      {title && <h3 className="font-display text-lg text-ink-900">{title}</h3>}
      {children}
    </section>
  );
}

/** A calm callout: what to look for, or why we ask. */
export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger"; title?: ReactNode; children: ReactNode }) {
  const tones = {
    info: "border-sage-200 bg-sage-50 text-sage-900",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-red-200 bg-red-50 text-red-950",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {title && <p className="mb-1 text-base font-semibold">{title}</p>}
      {children}
    </div>
  );
}
