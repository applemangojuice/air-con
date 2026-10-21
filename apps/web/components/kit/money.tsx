import { money } from "@/lib/format";

/**
 * Integer pence as pounds ("£1,234", "£1,234.50"). `signed` shows a + on
 * increases, for variations and price changes; nulls (unpriced lines) say so
 * rather than printing £0.
 */
export function Money({ pence, signed = false, className = "" }: { pence: number | null | undefined; signed?: boolean; className?: string }) {
  if (pence === null || pence === undefined || !Number.isFinite(pence)) {
    return <span className={`text-ink-500 ${className}`.trim()}>Not priced</span>;
  }
  return (
    <span className={`tabular-nums ${className}`.trim()}>
      {signed && pence > 0 ? "+" : ""}
      {money(pence)}
    </span>
  );
}
