import type { GateId } from "./project.ts";
import type { StaffMember, StaffRole } from "./staff.ts";

/**
 * The compliance checklist: every permission, safety and certification
 * item a job needs, each tied to the gate it holds.
 *
 * The software orchestrates approvals; it never replaces them. Statutory
 * items can only be approved with evidence by a qualified reviewer, never
 * overridden. Internal-process items can be overridden by an admin with a
 * reason. Readiness reads these items to decide what blocks a gate.
 *
 * Foundation ships the types; F5 owns the template and the review logic.
 */

export type ComplianceStatus =
  | "not-started"
  | "evidence-required"
  | "under-review"
  | "approved"
  | "rejected"
  | "not-applicable";

export interface ComplianceTemplateItem {
  key: string;
  label: string;
  category:
    | "permissions"
    | "planning"
    | "safety"
    | "electrical"
    | "refrigerant"
    | "design"
    | "commissioning"
    | "warranty"
    | "consumer";
  statutory: boolean;
  gate: GateId;
  ownerRole: StaffRole;
  guidance: string;
  evidenceHint: string;
  auto?: "design-approved" | "commissioning-signed" | "warranty-registered";
}

/**
 * Keys: ownership-authority, planning-pd, designations, noise-assessment,
 * outdoor-siting, structural-fixings, asbestos, concealed-services,
 * electrical-scope, fgas-company, fgas-engineer, manufacturer-requirements,
 * working-at-height, rams, equipment-compatibility, design-approval,
 * commissioning-approval, electrical-certificate, warranty-registration,
 * cancellation-and-consent.
 */
export const COMPLIANCE_TEMPLATE: ComplianceTemplateItem[] = []; // F5: replace

export interface ComplianceItem {
  id: string;
  projectId: string;
  key: string;
  label: string;
  category: ComplianceTemplateItem["category"];
  statutory: boolean;
  gate: GateId;
  status: ComplianceStatus;
  mediaIds: string[];
  note?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  overrideReason?: string;
}

export function instantiateCompliance(projectId: string, makeId: () => string): ComplianceItem[] {
  throw new Error("not implemented: instantiateCompliance (F5)");
}

/** Statutory items cannot be overridden to approved without evidence and a qualified reviewer. */
export function reviewCompliance(
  item: ComplianceItem,
  to: ComplianceStatus,
  reviewer: StaffMember,
  note: string | undefined,
  overrideReason: string | undefined,
  now: string,
): { ok: true; item: ComplianceItem } | { ok: false; error: string } {
  throw new Error("not implemented: reviewCompliance (F5)");
}
