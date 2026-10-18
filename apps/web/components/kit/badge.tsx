import type { ReactNode } from "react";

/**
 * Small status labels. Tones carry meaning, never decoration: success is
 * done and verified, warn needs attention, danger is blocked or failed,
 * info is in progress, accent is "your move", neutral is everything else.
 */

export type Tone = "neutral" | "info" | "success" | "warn" | "danger" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "border-line bg-surface text-ink-700",
  info: "border-sage-200 bg-sage-50 text-sage-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  accent: "border-accent-100 bg-accent-50 text-accent-700",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-500",
  info: "bg-sage-500",
  success: "bg-emerald-600",
  warn: "bg-amber-500",
  danger: "bg-red-600",
  accent: "bg-accent-500",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`.trim()}
    >
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

/**
 * Every status string the platform stores (projects, proposals, kit, POs,
 * compliance, issues, invoices, payments, messages, runsheet steps), with a
 * tone and a plain label. Shared spellings mean the same thing everywhere.
 */
export const STATUS_CHIP: Record<string, { tone: Tone; label: string }> = {
  // generic progress
  "not-started": { tone: "neutral", label: "Not started" },
  "not-booked": { tone: "neutral", label: "Not booked" },
  "not-issued": { tone: "neutral", label: "Not issued" },
  "not-ordered": { tone: "neutral", label: "Not ordered" },
  planned: { tone: "neutral", label: "Planned" },
  draft: { tone: "neutral", label: "Draft" },
  pending: { tone: "warn", label: "Pending" },
  required: { tone: "warn", label: "Required" },
  booked: { tone: "info", label: "Booked" },
  "in-progress": { tone: "info", label: "In progress" },
  "in-review": { tone: "info", label: "In review" },
  "under-review": { tone: "info", label: "Under review" },
  submitted: { tone: "info", label: "Submitted" },
  issued: { tone: "accent", label: "Issued" },
  ordered: { tone: "info", label: "Ordered" },
  confirmed: { tone: "info", label: "Confirmed" },
  dispatched: { tone: "info", label: "Dispatched" },
  queued: { tone: "info", label: "Queued" },
  open: { tone: "warn", label: "Open" },
  "awaiting-customer": { tone: "accent", label: "Waiting for customer" },
  "evidence-required": { tone: "warn", label: "Evidence needed" },
  "changes-requested": { tone: "warn", label: "Changes requested" },
  "part-paid": { tone: "warn", label: "Part paid" },
  // done
  approved: { tone: "success", label: "Approved" },
  accepted: { tone: "success", label: "Accepted" },
  delivered: { tone: "success", label: "Delivered" },
  inspected: { tone: "success", label: "Checked" },
  complete: { tone: "success", label: "Complete" },
  done: { tone: "success", label: "Done" },
  commissioned: { tone: "success", label: "Commissioned" },
  "handed-over": { tone: "success", label: "Handed over" },
  paid: { tone: "success", label: "Paid" },
  succeeded: { tone: "success", label: "Succeeded" },
  sent: { tone: "success", label: "Sent" },
  resolved: { tone: "success", label: "Resolved" },
  verified: { tone: "success", label: "Verified" },
  available: { tone: "success", label: "Available" },
  final: { tone: "success", label: "Final" },
  pass: { tone: "success", label: "Pass" },
  // stopped or bad
  failed: { tone: "danger", label: "Failed" },
  fail: { tone: "danger", label: "Fail" },
  blocked: { tone: "danger", label: "Blocked" },
  rejected: { tone: "danger", label: "Rejected" },
  declined: { tone: "danger", label: "Declined" },
  expired: { tone: "warn", label: "Expired" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  void: { tone: "neutral", label: "Void" },
  refunded: { tone: "neutral", label: "Refunded" },
  closed: { tone: "neutral", label: "Closed" },
  superseded: { tone: "neutral", label: "Superseded" },
  discontinued: { tone: "danger", label: "Discontinued" },
  // honesty states
  demo: { tone: "warn", label: "Demo, not sent" },
  skipped: { tone: "neutral", label: "Skipped" },
  provisional: { tone: "warn", label: "Provisional" },
  uncertain: { tone: "warn", label: "Uncertain" },
  stale: { tone: "warn", label: "Stale" },
  "not-applicable": { tone: "neutral", label: "Not applicable" },
  na: { tone: "neutral", label: "N/A" },
  "not-required": { tone: "neutral", label: "Not required" },
};

/** "awaiting-parts" → "Awaiting parts", for statuses not in the table. */
function plainLabel(status: string): string {
  const s = status.replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

export function statusChip(status: string): { tone: Tone; label: string } {
  return STATUS_CHIP[status] ?? { tone: "neutral", label: plainLabel(status) };
}

/** A Badge for a stored status string; `label` overrides the plain wording when the screen needs its own. */
export function StatusChip({ status, label, className }: { status: string; label?: string; className?: string }) {
  const chip = statusChip(status);
  return (
    <Badge tone={chip.tone} dot className={className}>
      {label ?? chip.label}
    </Badge>
  );
}
