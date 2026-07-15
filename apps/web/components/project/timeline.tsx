"use client";

import {
  PROJECT_STAGES,
  STAGE_INFO,
  type ProjectStageId,
  type TimelineEntry,
} from "@aircon/domain";
import { fmtDay } from "@/lib/format";

/**
 * The horizontal project timeline. Every stage is clickable, including
 * greyed-out future ones, which open a preview of what that page will show.
 * Completed stages fill in; the current stage pulses; future stages carry
 * projected ("est.") dates like a project plan.
 */
export function ProjectTimeline({
  entries,
  selected,
  onSelect,
}: {
  entries: TimelineEntry[];
  selected: ProjectStageId;
  onSelect: (stage: ProjectStageId) => void;
}) {
  return (
    <nav aria-label="Project timeline" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <ol className="flex min-w-[640px] items-start">
        {entries.map((entry, i) => {
          const info = STAGE_INFO[entry.stage];
          const isSelected = entry.stage === selected;
          const prev = entries[i - 1];

          return (
            <li key={entry.stage} className="flex flex-1 items-start">
              {i > 0 && (
                <div
                  aria-hidden
                  className={`mt-[15px] h-0.5 flex-1 ${
                    prev && prev.state === "complete"
                      ? "bg-accent-500"
                      : "border-t-2 border-dashed border-line bg-transparent"
                  }`}
                />
              )}
              <button
                type="button"
                onClick={() => onSelect(entry.stage)}
                aria-current={entry.state === "current" ? "step" : undefined}
                className="group flex w-[104px] shrink-0 flex-col items-center px-1 text-center"
              >
                <Node state={entry.state} selected={isSelected} index={i} />
                <span
                  className={`mt-2 text-xs font-semibold leading-tight ${
                    entry.state === "upcoming"
                      ? "text-ink-300 group-hover:text-ink-500"
                      : isSelected
                        ? "text-accent-700"
                        : "text-ink-900"
                  }`}
                >
                  {info.label}
                </span>
                {entry.date && (
                  <span
                    className={`mt-0.5 text-[11px] leading-tight ${
                      entry.date.kind === "estimated"
                        ? "italic text-ink-300"
                        : entry.date.kind === "confirmed"
                          ? "font-semibold text-sage-700"
                          : "text-ink-500"
                    }`}
                  >
                    {entry.date.kind === "estimated" ? "est. " : ""}
                    {fmtDay(entry.date.iso)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Node({
  state,
  selected,
  index,
}: {
  state: TimelineEntry["state"];
  selected: boolean;
  index: number;
}) {
  const ring = selected ? " ring-2 ring-accent-400 ring-offset-2 ring-offset-cream" : "";
  if (state === "complete") {
    return (
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 text-white${ring}`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-accent-500 bg-white${ring}`}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-20" />
        <span className="h-3 w-3 rounded-full bg-accent-500" />
      </span>
    );
  }
  return (
    <span
      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-line bg-cream text-xs font-semibold text-ink-300 transition group-hover:border-ink-300${ring}`}
    >
      {index + 1}
    </span>
  );
}

/**
 * Compact, non-interactive strip for the quote funnel: the moment a
 * postcode goes in, the customer sees the whole journey: quote, dot dot dot.
 */
export function TimelineStrip({ current = "quote" }: { current?: ProjectStageId }) {
  const currentIdx = PROJECT_STAGES.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label="Your journey">
      {PROJECT_STAGES.map((stage, i) => {
        const info = STAGE_INFO[stage];
        const state = i < currentIdx ? "done" : i === currentIdx ? "now" : "later";
        return (
          <div key={stage} className="flex items-center gap-1.5">
            {i > 0 && (
              <span
                aria-hidden
                className={`h-px w-3 sm:w-5 ${state === "later" ? "border-t border-dashed border-ink-300/50" : "bg-accent-500"}`}
              />
            )}
            <span
              className={`whitespace-nowrap text-[11px] font-medium ${
                state === "now"
                  ? "rounded-full bg-accent-100 px-2 py-0.5 text-accent-700"
                  : state === "done"
                    ? "text-ink-500"
                    : "hidden text-ink-300 sm:inline"
              }`}
            >
              {info.label}
            </span>
            {state === "later" && <span className="text-[11px] text-ink-300 sm:hidden">·</span>}
          </div>
        );
      })}
    </div>
  );
}
