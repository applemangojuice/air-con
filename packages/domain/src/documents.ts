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

const refPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The printed ref, unique across all documents (`documents.ref` is UNIQUE).
 *
 *   ("proposal", "7f3a91c2", 2)          → "DIH-PR-7F3A91C2-v2"
 *   ("invoice", "7f3a91c2", 1, "0002")   → "DIH-IN-7F3A91C2-0002-v1"
 *
 * `version` counts revisions of ONE document (proposal v1 → v2), not
 * documents of a kind. Kinds a project has several of (invoices, receipts,
 * variations) pass `instance` to tell them apart: the invoice number's
 * digits, the variation's issue number, the receipt's payment id. Use
 * `projectShortId` for the middle part: 4 characters collide across projects.
 */
export function documentRef(kind: DocumentKind, projectShortId: string, version: number, instance?: string): string {
  const short = refPart(projectShortId) || "X";
  const inst = instance === undefined ? "" : refPart(instance);
  return `DIH-${DOCUMENT_KIND_CODE[kind]}-${short}${inst ? `-${inst}` : ""}-v${Math.max(1, Math.floor(version))}`;
}

/** The first 8 letters and digits of a project id (a uuid's first block), upper-case, for refs. */
export function projectShortId(projectId: string): string {
  return refPart(projectId).slice(0, 8) || "X";
}
