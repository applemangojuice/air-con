/**
 * Documents: immutable snapshots of what the customer was given.
 *
 * Each document freezes the data it was rendered from (`snapshot`), so a
 * proposal or certificate reads the same in a year as the day it was
 * issued. Rendering is print-perfect HTML in the web app; a new version
 * supersedes, it never overwrites. Refs are human-readable and unique.
 */

export type DocumentKind =
  | "proposal"
  | "contract"
  | "variation"
  | "invoice"
  | "receipt"
  | "commissioning-certificate"
  | "handover-pack"
  | "survey-report";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  proposal: "Proposal",
  contract: "Contract confirmation",
  variation: "Variation",
  invoice: "Invoice",
  receipt: "Receipt",
  "commissioning-certificate": "Commissioning certificate",
  "handover-pack": "Handover pack",
  "survey-report": "Survey report",
};

/** Two-letter codes inside refs. Stable: refs are printed on paper. */
export const DOCUMENT_KIND_CODE: Record<DocumentKind, string> = {
  proposal: "PR",
  contract: "CT",
  variation: "VA",
  invoice: "IN",
  receipt: "RC",
  "commissioning-certificate": "CC",
  "handover-pack": "HP",
  "survey-report": "SR",
};

export interface DocumentRecord {
  id: string;
  projectId: string;
  kind: DocumentKind;
  version: number;
  ref: string;
  title: string;
  status: "draft" | "final" | "superseded";
  customerVisible: boolean;
  snapshot: unknown;
  createdAt: string;
  createdBy?: string;
}

/** ("proposal", "7f3a", 2) → "DIH-PR-7F3A-v2". */
export function documentRef(kind: DocumentKind, projectShortId: string, version: number): string {
  const short = projectShortId.toUpperCase().replace(/[^A-Z0-9]/g, "") || "X";
  return `DIH-${DOCUMENT_KIND_CODE[kind]}-${short}-v${Math.max(1, Math.floor(version))}`;
}
