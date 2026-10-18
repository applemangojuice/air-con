import type { GateId } from "./project.ts";
import type { StaffRole } from "./staff.ts";

/**
 * Issues: every defect, snag, shortage, blocker and variation on a job,
 * each with an owner, a next action and a history.
 *
 * A blocking issue holds its gate (see `blockersFor` in project.ts) until
 * it's resolved. Variations carry their own price delta and customer
 * decision, so a change after acceptance never edits the contract.
 *
 * Foundation ships the types, labels and `isOpen`; F6 owns the rest (F5
 * for variations and payments).
 */

export type IssueKind =
  | "defect"
  | "snag"
  | "shortage"
  | "damage"
  | "safety"
  | "clarification"
  | "variation"
  | "customer-instruction"
  | "blocker"
  | "fault";

export type IssueStatus = "open" | "in-progress" | "awaiting-customer" | "resolved" | "closed" | "rejected";

export type Severity = "low" | "medium" | "high" | "critical";

export interface Issue {
  id: string;
  projectId: string;
  number: number;
  kind: IssueKind;
  title: string;
  detail?: string;
  severity: Severity;
  status: IssueStatus;
  blocking: boolean;
  gate?: GateId;
  ownerRole: StaffRole | "customer" | "ops";
  ownerStaffId?: string;
  ownerName?: string;
  nextAction?: string;
  dueOn?: string;
  raisedBy: { kind: "staff" | "customer" | "system"; id?: string; name: string };
  raisedAt: string;
  mediaIds: string[];
  customerVisible: boolean;
  variation?: {
    description: string;
    priceDeltaNetPence: number;
    taxPence: number;
    totalDeltaPence: number;
    status: "proposed" | "accepted" | "declined";
    decidedAt?: string;
    decidedBy?: string;
  };
  resolution?: string;
  resolvedAt?: string;
  history: { at: string; by: string; note: string; status?: IssueStatus }[];
}

export const ISSUE_KIND_LABEL: Record<IssueKind, string> = {
  defect: "Defect",
  snag: "Snag",
  shortage: "Missing kit",
  damage: "Damage",
  safety: "Safety",
  clarification: "Question",
  variation: "Variation",
  "customer-instruction": "Customer request",
  blocker: "Blocker",
  fault: "Fault",
};

const OPEN_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>(["open", "in-progress", "awaiting-customer"]);

/** Still needs someone to do something. Resolved, closed and rejected are done. */
export function isOpen(issue: Issue): boolean {
  return OPEN_STATUSES.has(issue.status);
}

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Open",
  "in-progress": "In progress",
  "awaiting-customer": "Waiting for the customer",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

type KindDefaults = { severity: Severity; blocking: boolean; ownerRole: Issue["ownerRole"]; customerVisible: boolean };

/**
 * Sensible starting values when someone raises an issue of this kind. The
 * person raising it can change any of them; these are what a tired
 * installer gets if they don't.
 *
 *  * safety stops the job (critical, blocking) and goes to the tech lead;
 *  * missing kit, damage and blockers hold the job until the office sorts them;
 *  * snags and faults are the customer's own reports, so they can see them;
 *  * a variation waits for the customer's yes or no, in their portal;
 *  * questions and customer requests are low and don't hold anything up.
 */
const KIND_DEFAULTS: Record<IssueKind, KindDefaults> = {
  defect: { severity: "medium", blocking: false, ownerRole: "installer", customerVisible: false },
  snag: { severity: "low", blocking: false, ownerRole: "installer", customerVisible: true },
  shortage: { severity: "high", blocking: true, ownerRole: "ops", customerVisible: false },
  damage: { severity: "high", blocking: true, ownerRole: "ops", customerVisible: false },
  safety: { severity: "critical", blocking: true, ownerRole: "tech-lead", customerVisible: false },
  clarification: { severity: "low", blocking: false, ownerRole: "ops", customerVisible: false },
  variation: { severity: "medium", blocking: false, ownerRole: "customer", customerVisible: true },
  "customer-instruction": { severity: "low", blocking: false, ownerRole: "installer", customerVisible: false },
  blocker: { severity: "high", blocking: true, ownerRole: "ops", customerVisible: false },
  fault: { severity: "high", blocking: false, ownerRole: "tech-lead", customerVisible: true },
};

export function defaultsForKind(kind: IssueKind): KindDefaults {
  const d = KIND_DEFAULTS[kind];
  if (!d) throw new Error(`Unknown issue kind: ${String(kind)}`);
  return { ...d };
}

const DONE_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>(["resolved", "closed"]);

/**
 * Move an issue on, with a note in its history. Pure: returns a new issue.
 * Resolving stamps `resolvedAt` (once: closing a resolved issue keeps it)
 * and records the note as the resolution; reopening clears both. A note on
 * the same status is just an update in the history.
 */
export function transitionIssue(issue: Issue, to: IssueStatus, by: string, note: string, now: string): Issue {
  if (!ISSUE_STATUS_LABEL[to]) throw new Error(`Unknown issue status: ${String(to)}`);
  const next: Issue = JSON.parse(JSON.stringify(issue)) as Issue;
  const text = note.trim() || (to === issue.status ? "Update." : `Marked ${ISSUE_STATUS_LABEL[to].toLowerCase()}.`);
  next.status = to;
  next.history = [...(next.history ?? []), { at: now, by: by.trim() || "Unknown", note: text, status: to }];
  if (DONE_STATUSES.has(to)) {
    if (!next.resolvedAt || !DONE_STATUSES.has(issue.status)) next.resolvedAt = now;
    if (to === "resolved" && note.trim()) next.resolution = note.trim();
  } else if (to === "rejected") {
    delete next.resolvedAt;
    if (note.trim()) next.resolution = note.trim();
  } else {
    // Back in play: whatever "fixed" meant before no longer holds.
    delete next.resolvedAt;
    delete next.resolution;
  }
  return next;
}

/** A variation's money, from the net estimate and the tax rate on the contract. Integer pence. */
export function variationAmounts(priceDeltaNetPence: number, taxRatePct: number): { priceDeltaNetPence: number; taxPence: number; totalDeltaPence: number } {
  const net = Math.round(priceDeltaNetPence);
  const rate = Number.isFinite(taxRatePct) && taxRatePct > 0 ? taxRatePct : 0;
  const taxPence = Math.round((net * rate) / 100);
  return { priceDeltaNetPence: net, taxPence, totalDeltaPence: net + taxPence };
}

/**
 * A new issue with the kind's defaults, overridable, and its first history
 * line. Variations start proposed and wait for the customer.
 */
export function createIssue(input: {
  id: string;
  projectId: string;
  number: number;
  kind: IssueKind;
  title: string;
  detail?: string;
  raisedBy: Issue["raisedBy"];
  raisedAt: string;
  mediaIds?: string[];
  severity?: Severity;
  blocking?: boolean;
  customerVisible?: boolean;
  ownerRole?: Issue["ownerRole"];
  gate?: Issue["gate"];
  nextAction?: string;
  variation?: { description: string; priceDeltaNetPence: number; taxRatePct: number };
}): Issue {
  const d = defaultsForKind(input.kind);
  const title = input.title.trim();
  if (!title) throw new Error("An issue needs a title.");
  const detail = input.detail?.trim();
  const variation = input.variation
    ? {
        description: input.variation.description.trim() || title,
        ...variationAmounts(input.variation.priceDeltaNetPence, input.variation.taxRatePct),
        status: "proposed" as const,
      }
    : undefined;
  const status: IssueStatus = variation ? "awaiting-customer" : "open";
  return {
    id: input.id,
    projectId: input.projectId,
    number: Math.max(1, Math.floor(input.number)),
    kind: input.kind,
    title,
    ...(detail ? { detail } : {}),
    severity: input.severity ?? d.severity,
    status,
    blocking: input.blocking ?? d.blocking,
    ...(input.gate ? { gate: input.gate } : {}),
    ownerRole: input.ownerRole ?? d.ownerRole,
    ...(input.nextAction?.trim() ? { nextAction: input.nextAction.trim() } : {}),
    raisedBy: input.raisedBy,
    raisedAt: input.raisedAt,
    mediaIds: [...new Set(input.mediaIds ?? [])],
    customerVisible: variation ? true : (input.customerVisible ?? d.customerVisible),
    ...(variation ? { variation } : {}),
    history: [{ at: input.raisedAt, by: input.raisedBy.name, note: variation ? "Variation proposed." : "Raised.", status }],
  };
}
