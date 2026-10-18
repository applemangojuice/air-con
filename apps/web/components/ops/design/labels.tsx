import type { ReactNode } from "react";
import { effectiveConfidence, type CatalogueItem, type DesignVerdict, type RuleStatus } from "@aircon/domain";
import { Badge, type Tone } from "@/components/kit";
import { fmtDate } from "@/lib/format";

/**
 * Shared labels for the catalogue and the design studio: how sure a figure
 * is, whether kit can be bought, and what a rule light means. Server-safe
 * (no hooks), so client and server components both use them.
 */

const CONFIDENCE: Record<CatalogueItem["confidence"], { tone: Tone; label: string }> = {
  verified: { tone: "success", label: "Verified" },
  provisional: { tone: "warn", label: "Provisional" },
  stale: { tone: "warn", label: "Stale" },
};

/** Verified, provisional, or stale (verified more than 90 days ago). */
export function ConfidenceBadge({ item, today }: { item: Pick<CatalogueItem, "confidence" | "verifiedAt">; today: string }) {
  const c = effectiveConfidence(item, today);
  const chip = CONFIDENCE[c];
  return (
    <Badge tone={chip.tone} dot>
      <span title={item.verifiedAt ? `Last verified ${fmtDate(item.verifiedAt)}` : c === "verified" ? "No verified date recorded" : undefined}>{chip.label}</span>
    </Badge>
  );
}

const AVAILABILITY: Record<CatalogueItem["status"], { tone: Tone; label: string }> = {
  available: { tone: "neutral", label: "Available" },
  uncertain: { tone: "warn", label: "Availability uncertain" },
  discontinued: { tone: "danger", label: "Discontinued" },
};

export function AvailabilityBadge({ status }: { status: CatalogueItem["status"] }) {
  const chip = AVAILABILITY[status];
  return <Badge tone={chip.tone}>{chip.label}</Badge>;
}

export const RULE_LIGHT: Record<RuleStatus, { label: string; dot: string; ring: string; text: string }> = {
  pass: { label: "Pass", dot: "bg-emerald-600", ring: "border-emerald-200 bg-emerald-50/60", text: "text-emerald-800" },
  review: { label: "Check", dot: "bg-amber-500", ring: "border-amber-200 bg-amber-50/70", text: "text-amber-900" },
  fail: { label: "Blocked", dot: "bg-red-600", ring: "border-red-200 bg-red-50/70", text: "text-red-800" },
};

export const VERDICT: Record<DesignVerdict, { tone: Tone; label: string; detail: string }> = {
  "auto-approved": { tone: "success", label: "All checks pass", detail: "Nothing for the engineer to look at beyond the sign-off." },
  "needs-review": { tone: "warn", label: "Needs the engineer's eye", detail: "Some checks want a human look before signing." },
  "cannot-determine": { tone: "danger", label: "Can't be settled yet", detail: "Some checks are missing data or have a problem to fix." },
};

export function VerdictBadge({ verdict }: { verdict: DesignVerdict }) {
  const v = VERDICT[verdict];
  return (
    <Badge tone={v.tone} dot>
      {v.label}
    </Badge>
  );
}

/** "2.5 kW", or a dash when unknown. */
export function kw(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)} kW` : "–";
}

/** A short spec line for pickers and tables: "2.5 kW · 19 dB(A) · LWA unknown". */
export function specLine(item: CatalogueItem): string {
  const s = item.specs ?? {};
  const parts: string[] = [];
  if (typeof s.coolingKw === "number") parts.push(kw(s.coolingKw));
  if (item.kind === "indoor" && typeof s.soundPressureLowDb === "number") parts.push(`${s.soundPressureLowDb} dB(A) low`);
  if (item.kind === "outdoor") parts.push(typeof s.soundPowerDb === "number" ? `LWA ${s.soundPowerDb} dB(A)` : "LWA unknown");
  if (item.kind === "outdoor" && (item.ports ?? 1) > 1) parts.push(`${item.ports} rooms`);
  return parts.join(" · ");
}

/** A definition row: label on the left, value on the right; wraps on phones. */
export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-ink-900">{children}</dd>
    </div>
  );
}
