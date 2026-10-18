"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { fmtDay } from "@/lib/format";
import type { InstallBlock, SurveySlotDay } from "./schedule";

/**
 * The two choosers on the hub. Real radio inputs under fieldsets (so a
 * screen reader hears "Pick a day, Tue 20 Oct, 2 of 10"), styled as cards
 * big enough for a thumb, wrapping in a grid: never a sideways scroll.
 */

const optionCls = (checked: boolean, disabled = false) =>
  `flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border px-3 py-2.5 text-center text-sm font-semibold transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 ${
    disabled
      ? "cursor-not-allowed border-line bg-surface text-ink-500"
      : checked
        ? "border-accent-600 bg-accent-50 text-accent-700 shadow-sm"
        : "border-line bg-white text-ink-900 hover:border-ink-300"
  }`;

function Radio({
  name,
  value,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="relative">
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className={optionCls(checked, disabled)}>
        {children}
      </label>
    </div>
  );
}

/** Day, then time. `value` is the slot's ISO datetime (UK wall clock). */
export function SlotPicker({
  days,
  value,
  onChange,
  disabled,
  legend = "Pick a day",
}: {
  days: SurveySlotDay[];
  value: string | null;
  onChange: (iso: string | null) => void;
  disabled?: boolean;
  legend?: string;
}) {
  const name = useId();
  const [day, setDay] = useState<string | null>(value?.slice(0, 10) ?? days[0]?.date ?? null);
  // A refreshed list that no longer has the chosen day falls back to the first.
  useEffect(() => {
    if (day && !days.some((d) => d.date === day)) setDay(days[0]?.date ?? null);
  }, [days, day]);
  const slots = days.find((d) => d.date === day)?.slots ?? [];

  if (days.length === 0) return null;
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink-900">{legend}</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {days.map((d) => (
            <Radio
              key={d.date}
              name={`${name}-day`}
              value={d.date}
              checked={day === d.date}
              disabled={disabled}
              onChange={() => {
                setDay(d.date);
                if (value?.slice(0, 10) !== d.date) onChange(null);
              }}
            >
              {fmtDay(d.date)}
            </Radio>
          ))}
        </div>
      </fieldset>
      {day && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-900">Pick a time on {fmtDay(day)}</legend>
          <div className="grid grid-cols-3 gap-2 sm:max-w-md">
            {slots.map((s) => (
              <Radio key={s.iso} name={`${name}-time`} value={s.iso} checked={value === s.iso} disabled={disabled} onChange={() => onChange(s.iso)}>
                {s.time}
              </Radio>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** Install blocks as cards: "Tue 3 – Thu 5 Nov". `value` is the block's start date. */
export function BlockPicker({
  blocks,
  value,
  onChange,
  disabled,
  current,
}: {
  blocks: InstallBlock[];
  value: string | null;
  onChange: (startDate: string) => void;
  disabled?: boolean;
  /** The block already booked, shown as such and not offered again. */
  current?: string;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink-900">Choose your install dates</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {blocks.map((b) => {
          const isCurrent = current === b.startDate;
          return (
            <Radio
              key={b.startDate}
              name={name}
              value={b.startDate}
              checked={value === b.startDate}
              disabled={disabled || isCurrent}
              onChange={() => onChange(b.startDate)}
            >
              <span className="flex w-full items-center justify-between gap-3 text-left">
                <span className="text-base">{b.label}</span>
                <span className="text-xs font-medium text-ink-500">
                  {isCurrent ? "Your dates" : `${b.dates.length} day${b.dates.length === 1 ? "" : "s"}`}
                </span>
              </span>
            </Radio>
          );
        })}
      </div>
    </fieldset>
  );
}
