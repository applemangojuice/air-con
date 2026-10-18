import type { ReactNode } from "react";

type Tone = "success" | "warn" | "danger" | "neutral";

const TONE: Record<Tone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-line bg-surface text-ink-700",
};

const DOT: Record<Tone, string> = {
  success: "bg-emerald-600",
  warn: "bg-amber-500",
  danger: "bg-red-600",
  neutral: "bg-ink-500",
};

/**
 * The kit Badge's look for long text that has to wrap on a phone (a Badge
 * never wraps). Same tones, same dot.
 */
export function WrapBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex max-w-full items-start gap-1.5 rounded-2xl border px-2.5 py-1 text-xs font-semibold ${TONE[tone]}`}>
      <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="min-w-0">{children}</span>
    </span>
  );
}
