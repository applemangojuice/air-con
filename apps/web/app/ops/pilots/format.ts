import type { MetricFormat } from "@aircon/domain";
import { money } from "../../../lib/format.ts";

/**
 * One metric value as the comparison table shows it. Unknown is a dash,
 * never zero (zero is a real answer: nothing logged, nothing raised).
 */
export function formatMetric(value: unknown, format: MetricFormat): string {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "–";
  if (typeof value !== "number") return String(value);
  switch (format) {
    case "money":
      return money(value);
    case "pct":
      return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
    case "hours":
      return `${value % 1 === 0 ? value : value.toFixed(1)} h`;
    case "days":
      return `${value} day${value === 1 ? "" : "s"}`;
    case "minutes":
      return `${Math.round(value)} min`;
    case "score":
      return `${value}/10`;
    default:
      return String(value);
  }
}

/** "a: 3 · b: 2", biggest first, or a dash. */
export function formatBreakdown(r: Record<string, number>, unit = ""): string {
  const entries = Object.entries(r).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}${unit}`).join(" · ") : "–";
}
