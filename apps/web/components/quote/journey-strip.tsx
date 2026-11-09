import { CUSTOMER_JOURNEY, journeyStepFor, type ProjectStageId } from "@aircon/domain";

/**
 * The whole journey in one line (Price → Virtual survey → Purchase → Install
 * → Aftercare), so the customer can see the price is the first step, not
 * the last. Five customer-facing steps from the domain's CUSTOMER_JOURNEY;
 * the platform's eight stages map onto them. Later steps collapse to dots
 * on a phone.
 */
export function JourneyStrip({ current = "price" }: { current?: ProjectStageId }) {
  const currentIdx = CUSTOMER_JOURNEY.findIndex((s) => s.id === journeyStepFor(current));
  return (
    <div>
      <ol aria-label="Your journey" className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
        {CUSTOMER_JOURNEY.map((step, i) => {
          const state = i < currentIdx ? "done" : i === currentIdx ? "now" : "later";
          return (
            <li key={step.id} className="flex items-center gap-1.5" aria-current={state === "now" ? "step" : undefined}>
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
                {step.label}
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
    </div>
  );
}
