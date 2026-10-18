import { PROJECT_STAGES, STAGE_INFO, type ProjectStageId } from "@aircon/domain";

/**
 * The whole journey in one line (Price → Survey → … → Aftercare), so the
 * customer can see the price is the first step, not the last. Labels come
 * from the domain's v2 stage list. Later stages collapse to dots on a phone.
 */
export function JourneyStrip({ current = "price" }: { current?: ProjectStageId }) {
  const currentIdx = PROJECT_STAGES.indexOf(current);
  return (
    <nav aria-label="Your journey">
      <ol className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
        {PROJECT_STAGES.map((stage, i) => {
          const state = i < currentIdx ? "done" : i === currentIdx ? "now" : "later";
          return (
            <li key={stage} className="flex items-center gap-1.5" aria-current={state === "now" ? "step" : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={`h-px w-3 sm:w-5 ${state === "later" ? "border-t border-dashed border-ink-300" : "bg-accent-500"}`}
                />
              )}
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${
                  state === "now"
                    ? "rounded-full bg-accent-100 px-2 py-0.5 text-accent-700"
                    : state === "done"
                      ? "text-ink-500"
                      : "sr-only sm:not-sr-only sm:text-ink-500"
                }`}
              >
                {STAGE_INFO[stage].label}
              </span>
              {state === "later" && (
                <span aria-hidden className="text-[11px] text-ink-500 sm:hidden">
                  ·
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
