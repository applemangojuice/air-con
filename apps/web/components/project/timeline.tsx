"use client";

import { Fragment, type ReactNode } from "react";
import { PROJECT_STAGES, STAGE_INFO, type ProjectStageId, type TimelineEntry } from "@aircon/domain";
import { fmtDay } from "@/lib/format";

/**
 * The customer's eight stages (contract §D3), price → aftercare.
 *
 * One DOM, two layouts, no sideways scroll anywhere:
 *  * phones: a vertical stepper; the selected stage's panel opens right
 *    under its row, so the next thing to do is never a scroll away;
 *  * md and up: a horizontal timeline with the panel underneath.
 * Every stage is a button, future ones included (they open a preview).
 * Dates say what they are: done (actual), booked (confirmed) or "est.".
 */

const COL = ["md:col-start-1", "md:col-start-2", "md:col-start-3", "md:col-start-4", "md:col-start-5", "md:col-start-6", "md:col-start-7", "md:col-start-8"];

const STATE_WORD: Record<TimelineEntry["state"], string> = { complete: "done", current: "now", upcoming: "coming up" };

function DateLine({ date }: { date: TimelineEntry["date"] }) {
  if (!date) return null;
  if (date.kind === "estimated") return <span className="text-ink-500">est. {fmtDay(date.iso)}</span>;
  if (date.kind === "confirmed") return <span className="font-semibold text-sage-700">{fmtDay(date.iso)}</span>;
  return <span className="text-ink-700">{fmtDay(date.iso)}</span>;
}

function Node({ state, selected, index }: { state: TimelineEntry["state"]; selected: boolean; index: number }) {
  const ring = selected ? "ring-2 ring-accent-400 ring-offset-2 ring-offset-cream" : "";
  if (state === "complete") {
    return (
      <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white ${ring}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-accent-600 bg-white ${ring}`}>
        <span aria-hidden className="absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-20 motion-safe:animate-ping" />
        <span aria-hidden className="h-3 w-3 rounded-full bg-accent-600" />
      </span>
    );
  }
  return (
    <span
      className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-line bg-cream text-xs font-semibold text-ink-500 ${ring}`}
    >
      {index + 1}
    </span>
  );
}

export function ProjectStepper({
  entries,
  selected,
  onSelect,
  panelId,
  panel,
  aside,
}: {
  entries: TimelineEntry[];
  selected: ProjectStageId;
  onSelect: (stage: ProjectStageId) => void;
  panelId: string;
  /** The selected stage's panel. */
  panel: ReactNode;
  /** Supporting cards: after the stages on a phone, beside the panel on a wide screen. */
  aside?: ReactNode;
}) {
  const currentIndex = Math.max(
    0,
    entries.findIndex((e) => e.state === "current"),
  );
  const doneShare = entries.every((e) => e.state === "complete") ? 1 : currentIndex / Math.max(1, entries.length - 1);

  return (
    <div className="relative md:grid md:grid-cols-8">
      {/* desktop: the horizontal rail, filled up to the current stage */}
      <span aria-hidden className="absolute left-[6.25%] right-[6.25%] top-4 hidden h-0.5 bg-line md:block" />
      <span
        aria-hidden
        className="absolute left-[6.25%] top-4 hidden h-0.5 bg-accent-500 md:block"
        style={{ width: `calc(87.5% * ${doneShare})` }}
      />
      {entries.map((entry, i) => {
        const info = STAGE_INFO[entry.stage];
        const isSelected = entry.stage === selected;
        return (
          <Fragment key={entry.stage}>
            <button
              id={`step-${entry.stage}`}
              type="button"
              onClick={() => onSelect(entry.stage)}
              aria-expanded={isSelected}
              aria-controls={isSelected ? panelId : undefined}
              aria-current={entry.state === "current" ? "step" : undefined}
              className={`group relative flex min-h-14 w-full scroll-mt-4 items-center gap-3 rounded-2xl py-2 pr-2 text-left md:row-start-1 md:min-h-0 md:flex-col md:items-center md:gap-0 md:px-1 md:py-0 md:text-center ${COL[i]}`}
            >
              {/* phone: the rail, drawn per row so it starts at the first node and ends at the last */}
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute left-[15px] top-0 h-1/2 w-0.5 md:hidden ${entries[i - 1]!.state === "complete" ? "bg-accent-500" : "bg-line"}`}
                />
              )}
              {i < entries.length - 1 && (
                <span
                  aria-hidden
                  className={`absolute bottom-0 left-[15px] top-1/2 w-0.5 md:hidden ${entry.state === "complete" ? "bg-accent-500" : "bg-line"}`}
                />
              )}
              <Node state={entry.state} selected={isSelected} index={i} />
              <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3 md:mt-2 md:flex-none md:flex-col md:items-center md:gap-0.5">
                <span
                  className={`text-base font-semibold leading-tight md:text-sm ${
                    isSelected ? "text-accent-700" : entry.state === "upcoming" ? "text-ink-700 group-hover:text-ink-900" : "text-ink-900"
                  }`}
                >
                  {info.label}
                  <span className="sr-only">, {STATE_WORD[entry.state]}</span>
                </span>
                <span className="shrink-0 text-sm md:text-xs">
                  <DateLine date={entry.date} />
                </span>
              </span>
            </button>
            {isSelected && (
              <div
                id={panelId}
                className="relative z-10 mb-4 mt-2 scroll-mt-4 md:col-span-8 md:col-start-1 md:row-start-2 md:mb-0 md:mt-8 lg:col-span-5"
              >
                {panel}
              </div>
            )}
          </Fragment>
        );
      })}
      {aside && (
        <div className="relative z-10 mt-6 space-y-4 md:col-span-8 md:col-start-1 md:row-start-3 lg:col-span-3 lg:col-start-6 lg:row-start-2 lg:mt-8 lg:pl-6">
          {aside}
        </div>
      )}
    </div>
  );
}

/**
 * Compact, non-interactive strip for the quote funnel: from the moment a
 * postcode goes in, the customer sees the whole journey. Accepts the old
 * "quote" stage name for the first step.
 */
export function TimelineStrip({ current = "price" }: { current?: ProjectStageId | "quote" }) {
  const now: ProjectStageId = current === "quote" ? "price" : current;
  const currentIdx = PROJECT_STAGES.indexOf(now);
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1" aria-label="Your journey">
      {PROJECT_STAGES.map((stage, i) => {
        const info = STAGE_INFO[stage];
        const state = i < currentIdx ? "done" : i === currentIdx ? "now" : "later";
        return (
          <li key={stage} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className={`h-px w-3 sm:w-4 ${state === "later" ? "border-t border-dashed border-ink-300" : "bg-accent-500"}`} />
            )}
            <span
              aria-current={state === "now" ? "step" : undefined}
              className={`whitespace-nowrap text-[11px] font-medium ${
                state === "now"
                  ? "rounded-full bg-accent-100 px-2 py-0.5 text-accent-700"
                  : state === "done"
                    ? "text-ink-500"
                    : "hidden text-ink-500 sm:inline"
              }`}
            >
              {info.label}
            </span>
            {state === "later" && <span className="text-[11px] text-ink-500 sm:hidden" aria-hidden>·</span>}
          </li>
        );
      })}
    </ol>
  );
}
