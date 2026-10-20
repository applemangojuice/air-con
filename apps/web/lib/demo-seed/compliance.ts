import type { ComplianceItem, ComplianceStatus, ComplianceTemplateItem, GateId } from "@aircon/domain";

/**
 * The checklist on the DEMO pilots. The real template is F5's
 * (COMPLIANCE_TEMPLATE, still a stub); this is a hand-built stand-in with
 * the contract's keys, so the demo projects have a checklist that the
 * readiness gates actually read. Gates follow the reducer: everything up to
 * ready-to-install must be approved (or not applicable) before day 1.
 */

type Row = Pick<ComplianceTemplateItem, "key" | "label" | "category" | "statutory" | "gate">;

export const DEMO_CHECKLIST: Row[] = [
  { key: "ownership-authority", label: "Owner's authority to contract", category: "permissions", statutory: false, gate: "proposal-issue" },
  { key: "planning-pd", label: "Permitted development assessment", category: "planning", statutory: true, gate: "ready-to-install" },
  { key: "designations", label: "Listed building, conservation area and Article 4 check", category: "planning", statutory: true, gate: "ready-to-install" },
  { key: "noise-assessment", label: "Noise at the nearest neighbour (MCS 020)", category: "planning", statutory: true, gate: "ready-to-install" },
  { key: "planning-consent", label: "Planning permission or listed building consent granted", category: "planning", statutory: true, gate: "ready-to-install" },
  { key: "outdoor-siting", label: "Outdoor unit siting and clearances", category: "planning", statutory: false, gate: "ready-to-install" },
  { key: "structural-fixings", label: "Wall and bracket fixings", category: "safety", statutory: false, gate: "ready-to-install" },
  { key: "asbestos", label: "Asbestos check where we drill", category: "safety", statutory: true, gate: "ready-to-install" },
  { key: "concealed-services", label: "Hidden pipes and cables scanned", category: "safety", statutory: false, gate: "ready-to-install" },
  { key: "electrical-scope", label: "Electrical scope agreed with the electrician", category: "electrical", statutory: true, gate: "booking" },
  { key: "fgas-company", label: "Company F-gas certificate current", category: "refrigerant", statutory: true, gate: "booking" },
  { key: "fgas-engineer", label: "Engineer F-gas certificate current", category: "refrigerant", statutory: true, gate: "booking" },
  { key: "manufacturer-requirements", label: "Manufacturer installation requirements", category: "design", statutory: false, gate: "proposal-issue" },
  { key: "working-at-height", label: "Working at height plan", category: "safety", statutory: true, gate: "ready-to-install" },
  { key: "rams", label: "Risk assessment and method statement", category: "safety", statutory: true, gate: "ready-to-install" },
  { key: "equipment-compatibility", label: "Equipment combination verified", category: "design", statutory: false, gate: "proposal-issue" },
  { key: "design-approval", label: "Design signed off by the technical lead", category: "design", statutory: false, gate: "proposal-issue" },
  { key: "commissioning-approval", label: "Commissioning results signed off", category: "commissioning", statutory: true, gate: "commissioned" },
  { key: "electrical-certificate", label: "Electrical installation certificate", category: "electrical", statutory: true, gate: "closed" },
  { key: "warranty-registration", label: "Manufacturer warranty registered", category: "warranty", statutory: false, gate: "closed" },
  { key: "cancellation-and-consent", label: "Cancellation information and early-start consent", category: "consumer", statutory: true, gate: "ready-to-install" },
];

export interface ChecklistState {
  status: ComplianceStatus;
  note?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  mediaIds?: string[];
}

/**
 * The checklist for one project: every key, at the status `states` gives
 * (not started otherwise). Ids are deterministic from `makeId`.
 */
export function demoChecklist(
  projectId: string,
  makeId: (key: string) => string,
  states: Partial<Record<string, ChecklistState>>,
): ComplianceItem[] {
  const pdApproved = states["planning-pd"]?.status === "approved";
  return DEMO_CHECKLIST.map((row) => {
    // The DEMO homes aren't listed: once the technical lead records "PD checks passed", no consent is needed
    // (as syncCompliance would mark it), and the approvals carry the answers they ask for.
    const s: ChecklistState | undefined =
      row.key === "planning-consent"
        ? pdApproved
          ? { status: "not-applicable", note: "Not needed: the technical lead recorded \"PD checks passed\", and no listed building is on record (DEMO)." }
          : undefined
        : states[row.key];
    const answers =
      s?.status === "approved" && row.key === "planning-pd"
        ? { planningOutcome: "pd" as const }
        : s?.status === "approved" && row.key === "designations"
          ? { listedBuilding: "no" as const }
          : {};
    return {
      ...answers,
      id: makeId(row.key),
      projectId,
      key: row.key,
      label: row.label,
      category: row.category,
      statutory: row.statutory,
      gate: row.gate,
      status: s?.status ?? "not-started",
      mediaIds: s?.mediaIds ?? [],
      ...(s?.note ? { note: s.note } : {}),
      ...(s?.reviewedBy ? { reviewedBy: s.reviewedBy } : {}),
      ...(s?.reviewedAt ? { reviewedAt: s.reviewedAt } : {}),
    };
  });
}

/** Every key whose gate is at or before `gate` (GATE_IDS order). */
export function keysUpTo(gate: GateId, order: GateId[]): string[] {
  const limit = order.indexOf(gate);
  return DEMO_CHECKLIST.filter((r) => order.indexOf(r.gate) <= limit).map((r) => r.key);
}
