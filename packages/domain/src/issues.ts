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

export function defaultsForKind(kind: IssueKind): {
  severity: Severity;
  blocking: boolean;
  ownerRole: Issue["ownerRole"];
  customerVisible: boolean;
} {
  throw new Error("not implemented: defaultsForKind (F6)");
}

export function transitionIssue(issue: Issue, to: IssueStatus, by: string, note: string, now: string): Issue {
  throw new Error("not implemented: transitionIssue (F6)");
}
