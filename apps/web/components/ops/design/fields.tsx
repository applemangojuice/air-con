"use client";

import { useEffect, useId, useState } from "react";
import { AnnotatedImage } from "@/components/annotate/annotated-image";
import { inputClass, textareaClass } from "@/components/kit";
import type { StudioMedia } from "@/lib/design-server";

/** A number input that only commits real numbers (blank or junk shows a message instead of saving NaN). */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.1,
  unit,
  badge,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
        {label}
        {unit && <span className="font-normal text-ink-500">({unit})</span>}
        {badge}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const n = Number(t);
          if (t.trim() === "" || !Number.isFinite(n)) setError("Enter a number.");
          else if (n < min || n > max) setError(`Between ${min} and ${max}.`);
          else {
            setError(null);
            onCommit(Math.round(n * 10) / 10);
          }
        }}
        onBlur={() => {
          if (error) {
            setText(String(value));
            setError(null);
          }
        }}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Why the change?" A deviation from the survey or the engine needs a reason before approval. */
export function ReasonField({
  label,
  from,
  to,
  value,
  onChange,
  onRevert,
  revertLabel = "Undo the change",
}: {
  label: string;
  from: string;
  to: string;
  value: string;
  onChange: (text: string) => void;
  onRevert?: () => void;
  revertLabel?: string;
}) {
  const id = useId();
  const missing = value.trim().length < 3;
  return (
    <div className={`rounded-2xl border p-3 ${missing ? "border-amber-300 bg-amber-50" : "border-line bg-surface/50"}`}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink-900">
        Why change {label}? <span className="font-normal text-ink-500">(required to approve)</span>
      </label>
      <p className="mt-0.5 text-xs text-ink-700">
        {from} → {to}
      </p>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${textareaClass} mt-2 min-h-16`}
        placeholder="e.g. measured again on site; customer wants it on the other wall"
      />
      {onRevert && (
        <button type="button" onClick={onRevert} className="mt-1 text-sm font-semibold text-accent-700 underline-offset-2 hover:underline">
          {revertLabel}
        </button>
      )}
    </div>
  );
}

/** A photo with its drawing, and (when editing) a tick to make it part of the approved layout. */
export function PhotoChoice({
  media,
  chosen,
  editing,
  onToggle,
  label,
}: {
  media: StudioMedia;
  chosen: boolean;
  editing: boolean;
  onToggle: () => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white ${chosen ? "border-accent-500 ring-2 ring-accent-100" : "border-line"}`}>
      <AnnotatedImage src={media.url} annotations={media.annotations} width={media.width} height={media.height} alt={media.caption ?? label} labels={false} className="[&>div]:rounded-none" />
      <div className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
        {editing ? (
          <>
            <input id={id} type="checkbox" checked={chosen} onChange={onToggle} className="h-5 w-5 shrink-0 accent-accent-600" />
            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-ink-900">
              Layout photo
              {media.caption && <span className="block truncate text-xs text-ink-500">{media.caption}</span>}
            </label>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-ink-700">
            {chosen ? "Layout photo" : "Survey photo"}
            {media.locked && <span className="ml-1 text-xs text-ink-500">· locked</span>}
            {media.caption && <span className="block truncate text-xs text-ink-500">{media.caption}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
