import type { DesignRecord } from "./design-record.ts";
import type { GateId, Project } from "./project.ts";
import type { PilotSettings } from "./settings.ts";
import { can, type StaffMember, type StaffRole } from "./staff.ts";

/**
 * The compliance checklist: every permission, safety and certification
 * item a job needs, each tied to the gate it holds.
 *
 * The software orchestrates approvals; it never replaces them. Statutory
 * items can only be approved with evidence by a qualified reviewer, never
 * overridden. Internal-process items can be overridden by an admin with a
 * reason. Readiness reads these items to decide what blocks a gate.
 *
 * Working summaries from docs/research (uk-consumer-legal.md §6–7,
 * commissioning-standards.md §5–7), not legal advice: where the guidance
 * says "confirm", a professional confirms.
 *
 * Three items are automatic (design approval, commissioning sign-off,
 * warranty registration): they follow the project's own records through
 * `syncCompliance` and can't be approved by hand. Planning is never
 * concluded automatically: the survey's checklist moves `planning-pd` to
 * "under review", and only a reviewer's written outcome approves it. That
 * outcome is recorded as a choice (`planningOutcome`): "PD checks passed",
 * or "planning permission or listed building consent needed", which (like
 * a listed building on record) holds install day 1 on `planning-consent`
 * until the council's decision notice is attached.
 */

/** How the heat pump's Building Regulations are covered, chosen to approve `heat-pump-building-regs`. */
export type BuildingRegsRoute = "competent-person" | "building-notice" | "full-plans" | "bsr";

export const BUILDING_REGS_ROUTES: readonly BuildingRegsRoute[] = ["competent-person", "full-plans", "building-notice", "bsr"];

export const BUILDING_REGS_ROUTE_TEXT: Record<BuildingRegsRoute, string> = {
  "competent-person": "Competent person scheme (we self-certify)",
  "full-plans": "Full plans application to the council",
  "building-notice": "Building notice to the council (a house only)",
  bsr: "Building Safety Regulator's approval (a higher-risk building)",
};

/** The block a flat is in, as the survey records it: building notice and higher-risk building rules. */
export interface BlockContext {
  flat: boolean;
  higherRisk: boolean;
}

/** Why this route can't be used for this home, or null. */
export function buildingRegsRouteProblem(route: BuildingRegsRoute | undefined, block: BlockContext | undefined): string | null {
  if (!route || !BUILDING_REGS_ROUTES.includes(route)) return "Choose how the heat pump's Building Regulations are covered: our competent person scheme, a full plans application, a building notice, or the Building Safety Regulator.";
  if (block?.higherRisk && (route === "building-notice" || route === "full-plans")) {
    return "A higher-risk building (7 storeys or 18 m and above, per the survey): the council isn't the building control authority there. Work outside our competent person scheme needs the Building Safety Regulator's approval before it starts (apply through GOV.UK); check the scheme covers work in a higher-risk building.";
  }
  if (block?.flat && route === "building-notice") {
    return "A flat in a block: a building notice isn't accepted where the Fire Safety Order covers the building (a block's common parts). Use our competent person scheme, or a full plans application.";
  }
  if (route === "bsr" && block && !block.higherRisk) return "The Building Safety Regulator approves work in higher-risk buildings only (7 storeys or 18 m and above): the survey doesn't record one here.";
  return null;
}

/** The technical lead's planning outcome on `planning-pd`. */
export type PlanningOutcome = "pd" | "consent-needed";

export const PLANNING_OUTCOMES: readonly PlanningOutcome[] = ["pd", "consent-needed"];

export const PLANNING_OUTCOME_TEXT: Record<PlanningOutcome, string> = {
  pd: "PD checks passed: no application needed",
  "consent-needed": "Planning permission or listed building consent needed",
};

export type ComplianceStatus =
  | "not-started"
  | "evidence-required"
  | "under-review"
  | "approved"
  | "rejected"
  | "not-applicable";

export const COMPLIANCE_STATUSES: readonly ComplianceStatus[] = [
  "not-started",
  "evidence-required",
  "under-review",
  "approved",
  "rejected",
  "not-applicable",
];

export const COMPLIANCE_STATUS_TEXT: Record<ComplianceStatus, string> = {
  "not-started": "Not started",
  "evidence-required": "Evidence needed",
  "under-review": "Waiting for review",
  approved: "Approved",
  rejected: "Rejected",
  "not-applicable": "Not applicable",
};

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
  /** May it honestly be marked not applicable (with a reason)? Default true. */
  allowNa?: boolean;
  /**
   * "note": approval needs the reviewer's written outcome, evidence alone isn't enough.
   * "evidence-and-note": a file (the document itself) and a note of what it says.
   * Default: evidence or a note.
   */
  approvalNeeds?: "evidence-or-note" | "note" | "evidence-and-note";
  /** Where a new checklist starts this item. Default "not-started". */
  initialStatus?: ComplianceStatus;
  /** The rule behind it, in a few words. */
  basis?: string;
}

export const COMPLIANCE_CATEGORY_LABEL: Record<ComplianceTemplateItem["category"], string> = {
  permissions: "Permissions",
  planning: "Planning",
  safety: "Safety",
  electrical: "Electrical",
  refrigerant: "Refrigerant",
  design: "Design",
  commissioning: "Commissioning",
  warranty: "Warranty",
  consumer: "Consumer law",
};

/**
 * Keys: ownership-authority, planning-pd, designations, noise-assessment,
 * planning-consent, outdoor-siting, structural-fixings, asbestos, concealed-services,
 * electrical-scope, heat-pump-building-regs, fgas-company, fgas-engineer,
 * manufacturer-requirements, working-at-height, rams,
 * equipment-compatibility, design-approval, commissioning-approval,
 * electrical-certificate, commissioning-notice,
 * heat-pump-compliance-certificate, warranty-registration,
 * cancellation-and-consent.
 *
 * Statutory: planning (PD, designations, noise, and the consent itself when
 * one is needed), asbestos, electrical (Part P
 * scope and certificate), the heat pump as building work (its Part L route
 * before booking, the commissioning notice and the compliance certificate
 * before closing; building control to confirm), F-gas (company, engineers,
 * commissioning), working at height, the risk assessment, and the consumer
 * cancellation rules.
 */
export const COMPLIANCE_TEMPLATE: ComplianceTemplateItem[] = [
  /* ---------------- before the proposal goes out ---------------- */
  {
    key: "ownership-authority",
    label: "Owner's authority to contract",
    category: "permissions",
    statutory: false,
    gate: "proposal-issue",
    ownerRole: "surveyor",
    allowNa: false,
    basis: "Internal: the right person signs",
    guidance:
      "Confirm the person accepting owns the home, or has the owner's written permission: the landlord for a tenant, the freeholder or managing agent for a leasehold flat (most leases need their consent for holes in the outside wall and anything fixed to it). The survey records the tenure and the decision maker. For a leaseholder or tenant, approving needs the written consent attached, and install day 1 waits for it.",
    evidenceHint:
      "The survey's tenure and signatory answers. For a leaseholder or tenant, the freeholder's or landlord's written consent.",
  },
  {
    key: "planning-pd",
    label: "Permitted development checks (Class G)",
    category: "planning",
    statutory: true,
    gate: "proposal-issue",
    ownerRole: "tech-lead",
    allowNa: false,
    approvalNeeds: "note",
    initialStatus: "evidence-required",
    basis: "GPDO 2015 Sch 2 Part 14 Class G, as amended from 29 May 2025",
    guidance:
      "England, Class G as amended by SI 2025/560: the system is not used solely for cooling; the outdoor unit is 1.5 m³ or less (0.6 m³ on a block of flats); one unit on a house that isn't detached, two on a detached house; not on a pitched roof or within 1 m of a flat roof's edge; the MCS 020(a) noise calculation passes; not a listed building; the designated-land and highway-facing wall rules are met. A flat in a mixed-use building gets no permitted development. We never conclude \"no planning needed\" by ourselves: the technical lead chooses the outcome, \"PD checks passed\" or \"planning permission or listed building consent needed\", and writes what they checked. \"Needed\" (or a listed building on record) holds install day 1 until the council's decision notice is on the checklist (\"Planning permission or listed building consent granted\"). Verify the current Class G text.",
    evidenceHint:
      "The survey's permitted development checklist, the MCS 020(a) calculation and the outdoor unit's spec sheet (for volume). Choose the outcome and write what you checked in the note.",
  },
  {
    key: "designations",
    label: "Listed building, conservation area and Article 4",
    category: "planning",
    statutory: true,
    gate: "proposal-issue",
    ownerRole: "surveyor",
    allowNa: false,
    basis: "GPDO Class G.2(i)–(k); Article 4 directions",
    guidance:
      "Check the council's planning map and the National Heritage List: a listed building, or anything in its curtilage (no permitted development; listed building consent needed, for the outdoor unit and for inside work that affects its character, such as core holes and pipe runs), a conservation area or World Heritage Site (no unit on a wall or roof facing a road, or nearer the road than the house), and any Article 4 direction that removes Class G rights. Approving asks one question: is it listed, or in the curtilage of a listed building? \"Yes\" holds install day 1 until listed building consent is granted.",
    evidenceHint: "A screenshot or link from the council's map and the heritage list, with the date you checked.",
  },
  {
    key: "noise-assessment",
    label: "Noise at the nearest neighbour (MCS 020(a))",
    category: "planning",
    statutory: true,
    gate: "proposal-issue",
    ownerRole: "tech-lead",
    allowNa: false,
    basis: "MCS 020(a), required by Class G.1",
    guidance:
      "Run the MCS 020(a) calculation for the chosen outdoor unit and position. It needs the unit's sound power (LWA) from the datasheet or EPREL fiche, the distance to the assessment position (1 m out from the centre of the nearest habitable-room window or door next door), the hard surfaces within 1 m of the unit (Q2, Q4, or Q8 in a corner) and any barrier. The 42 dB(A) limit includes an assumed 40 dB(A) background, so the heat pump's own level must be 37.0 dB(A) or less: confirm the figure and the steps against the current MCS 020(a) issue. The design's noise check is an estimate with no barrier credit. Without the unit's LWA, this can't be approved.",
    evidenceHint: "The completed calculation (PDF or a photo of the worksheet), where the LWA came from, and the measured distance.",
  },
  {
    key: "manufacturer-requirements",
    label: "Manufacturer installation requirements",
    category: "design",
    statutory: false,
    gate: "proposal-issue",
    ownerRole: "tech-lead",
    basis: "Manufacturer manuals and warranty terms",
    guidance:
      "From the installation manual for each chosen model: maximum and minimum pipe lengths (per indoor unit and, on a multi-split, in total) and height difference (outdoor to indoor, and between indoor units on a multi-split, which can depend on whether the outdoor unit is above or below), the fewest indoor units and least connected capacity a multi-split runs with, pre-charged length and extra charge per metre, the factory charge, breaker size and the RCD type it needs (Type A, F or B), the indoor-outdoor interconnect cable, flare torques and any reducers on a multi-split's ports, clearances, condensate fall, and anything the warranty depends on (accredited installer, registration deadline). R32 is mildly flammable: when a system's total charge (factory plus added) is over 1.84 kg, check every room it serves against the manual's minimum floor area table (the design's \"Room size for the R32 charge\" check uses the IEC 60335-2-40 formula; the manual's table can be stricter).",
    evidenceHint: "The manual pages or links for the chosen models, and a note of anything that changed the design.",
  },
  {
    key: "equipment-compatibility",
    label: "Equipment combination verified",
    category: "design",
    statutory: false,
    gate: "proposal-issue",
    ownerRole: "tech-lead",
    basis: "Manufacturer combination tables",
    guidance:
      "Every multi-split combination must come from the manufacturer's combination table: which indoor models, total connected capacity, pipe lengths per room and in total. Single splits use the matched indoor and outdoor pair. Provisional catalogue figures are checked against the datasheet.",
    evidenceHint: "The combination table page, or the design's compatibility check.",
  },
  {
    key: "design-approval",
    label: "Design signed off by the technical lead",
    category: "design",
    statutory: false,
    gate: "proposal-issue",
    ownerRole: "tech-lead",
    auto: "design-approved",
    allowNa: false,
    basis: "Internal: engineer sign-off before a price is fixed",
    guidance:
      "Updates itself when a technical lead with a current F-gas certificate approves the design on the design page.",
    evidenceHint: "The design's approval record (who, their certificate, when).",
  },

  /* ---------------- before the booking is confirmed ---------------- */
  {
    key: "electrical-scope",
    label: "Electrical scope and Part P route",
    category: "electrical",
    statutory: true,
    gate: "booking",
    ownerRole: "electrician",
    allowNa: false,
    basis: "Building Regulations 2010 reg 12(6A), Part P",
    guidance:
      "A new circuit for the outdoor unit is notifiable electrical work. Agree the circuit, protective device, cable route and isolator with an electrician registered with a competent person scheme, who self-certifies it. Without one, a building notice goes to the council before work starts. Check the board: a spare way, the RCD type the outdoor unit's manual asks for (Type A, F or B: inverters can need F or B), earthing, and any asbestos flash guard in an old fuse box. The cable is sized for its route (how it's run, insulation, the outside section, length), not from the breaker alone.",
    evidenceHint: "The electrician's scope note or quote, their scheme registration number, and a photo of the board.",
  },
  {
    key: "supply-and-dno",
    label: "Supply capacity and the network operator (DNO)",
    category: "electrical",
    statutory: false,
    gate: "booking",
    ownerRole: "electrician",
    allowNa: false,
    approvalNeeds: "note",
    basis: "BS 7671 132.16 (existing equipment, including the distributor's, adequate for the addition); ENA connect-and-notify process. Verify the current criteria",
    guidance:
      "Before the booking, the electrician confirms the supply can take the new load: the cut-out (main fuse) rating, whether the service is looped, the earthing, the existing large loads (electric shower, EV charger, other heat pumps) and the maximum demand after diversity, using the outdoor unit's maximum running current. Then the network operator (UK Power Networks in London): under the ENA process a heat pump within the cut-out's capacity (60 A a phase or less, cut-out known, not looped, one device) is connected and notified within 28 days; otherwise the application goes in first and the install waits for the answer. Whether the DNO treats an air-to-air unit as a heat pump wasn't confirmed: if in doubt, notify. Write the outcome in the note.",
    evidenceHint:
      "A photo of the cut-out and its rating, the electrician's maximum demand note, and the DNO's notification or application reference (or why none is needed, in writing).",
  },
  {
    key: "heat-pump-building-regs",
    label: "Building Regulations route for the heat pump",
    category: "permissions",
    statutory: true,
    gate: "booking",
    ownerRole: "admin",
    approvalNeeds: "note",
    basis: "Building Regulations 2010 Part L, Sch 3 (competent person schemes), reg 12; Building Safety Act 2022 for higher-risk buildings. Building control to confirm",
    guidance:
      "Installing a split heat pump or air conditioner is very likely building work under Part L, separate from the electrical circuit. Before the booking, record how this job is covered: the competent person scheme our installer is registered with for this work (scheme and registration number), who then self-certifies it; or, without one, the council's approval before work starts: a building notice for a house, but a full plans application for a flat in a block the Fire Safety Order covers (most blocks: a building notice isn't allowed there). In a higher-risk building (18 m or more, or 7 storeys or more, with two or more homes), work outside a competent person scheme needs the Building Safety Regulator's approval first. Once work has started, a missed notice can only be put right by regularisation. Mark it not applicable only on building control's written word that this install isn't building work.",
    evidenceHint: "Choose the route, then: the scheme name and registration number, or the building notice or full plans reference and the date it went in, or the Building Safety Regulator's approval. A flat can't use a building notice, and a higher-risk building (the survey's block answers) can't use the council at all.",
  },
  {
    key: "fgas-company",
    label: "Company F-gas certificate",
    category: "refrigerant",
    statutory: true,
    gate: "booking",
    ownerRole: "admin",
    allowNa: false,
    basis: "F-gas regulations: company certification for split systems",
    guidance:
      "Installing and commissioning split systems needs company F-gas certification (REFCOM or another approved body). If we don't hold it, the refrigerant work runs under a certified company, and their certificate goes in the handover pack. Check it's current on the install dates.",
    evidenceHint: "The company certificate: body, number and expiry (in settings), or the subcontracting company's certificate.",
  },
  {
    key: "fgas-engineer",
    label: "Engineer F-gas certificates",
    category: "refrigerant",
    statutory: true,
    gate: "booking",
    ownerRole: "admin",
    allowNa: false,
    basis: "F-gas regulations: personal certification",
    guidance:
      "Everyone who handles refrigerant (brazing, pressure testing, evacuation, charging, leak checks) needs a current F-gas certificate: Category I unless the technical lead has confirmed otherwise. The booking page lists each crew member's certificates and expiry dates.",
    evidenceHint: "Certificate number and expiry for each engineer on the crew (from their staff record).",
  },

  /* ---------------- before install day 1 ---------------- */
  {
    key: "planning-consent",
    label: "Planning permission or listed building consent granted",
    category: "planning",
    statutory: true,
    gate: "ready-to-install",
    ownerRole: "admin",
    allowNa: false,
    approvalNeeds: "evidence-and-note",
    basis:
      "Town and Country Planning Act 1990 (development needs planning permission unless permitted); Planning (Listed Buildings and Conservation Areas) Act 1990 ss.7 and 9 (works to a listed building without consent are an offence). Verify the current text",
    guidance:
      "Needed when the technical lead's planning outcome is \"planning permission or listed building consent needed\", or a listed building is on record (the survey, the property record or the designations check). Nothing is drilled until the council has granted it: planning permission for the outdoor unit, and for a listed building, listed building consent, which also covers inside work that affects its character (core holes, pipe and cable runs). Attach the decision notice and write its reference, the date it was granted and its conditions (and how this install meets them). When the outcome is \"PD checks passed\" on a building that isn't listed, this marks itself not applicable.",
    evidenceHint: "The council's decision notice (PDF or photo), and in the note its reference, the date granted and the conditions.",
  },
  {
    key: "outdoor-siting",
    label: "Outdoor unit siting and defrost drainage",
    category: "planning",
    statutory: false,
    gate: "ready-to-install",
    ownerRole: "surveyor",
    basis: "Class G.3 conditions; manufacturer clearances",
    guidance:
      "Manufacturer clearances for airflow and servicing, a solid base or a rated bracket, sited to keep its look and noise to a minimum (a permitted development condition), and defrost water led to a gully, gravel or soakaway: never across a path, step, drive or onto the neighbour's land.",
    evidenceHint: "An annotated photo of the chosen spot, the measured clearances, and the drainage route.",
  },
  {
    key: "structural-fixings",
    label: "Wall and bracket fixings",
    category: "safety",
    statutory: false,
    gate: "ready-to-install",
    ownerRole: "tech-lead",
    basis: "Good practice; manufacturer bracket ratings",
    guidance:
      "Check the wall can carry the bracket and unit (its weight plus service loads), the fixings suit the wall (solid brick, cavity, timber frame, render), and core holes miss lintels and structural timbers.",
    evidenceHint: "The wall type from the survey, the bracket and fixing spec, and a photo of the wall.",
  },
  {
    key: "asbestos",
    label: "Asbestos check before drilling",
    category: "safety",
    statutory: true,
    gate: "ready-to-install",
    ownerRole: "surveyor",
    basis: "Control of Asbestos Regulations 2012",
    guidance:
      "Before drilling or disturbing anything in a home built before 2000, assess whether asbestos could be there: textured ceilings, old fuse-board flash guards, soffits, floor tiles. Suspected asbestos stops the work until it's tested or avoided. It's never \"probably fine\". When the survey says possible or suspected (or a flash guard may be asbestos), approving needs the test result or asbestos survey, or a photo of the route that avoids it, attached, and the note saying which. Not applicable only for a home built in 2000 or later, with the reason written down.",
    evidenceHint: "The survey's asbestos answer, photos of the drilling spots and the fuse board, and any test result (required when the survey suspects asbestos).",
  },
  {
    key: "concealed-services",
    label: "Hidden pipes and cables",
    category: "safety",
    statutory: false,
    gate: "ready-to-install",
    ownerRole: "installer",
    basis: "Good practice; BS 7671 safe zones",
    guidance:
      "Scan every drilling and fixing spot for cables, water and gas pipes, keep clear of cable safe zones, and check the far side of the wall before core drilling.",
    evidenceHint: "A photo of the marked-out positions after scanning.",
  },
  {
    key: "working-at-height",
    label: "Working at height plan",
    category: "safety",
    statutory: true,
    gate: "ready-to-install",
    ownerRole: "tech-lead",
    basis: "Work at Height Regulations 2005",
    guidance:
      "Plan any work off the ground (a high bracket, first-floor holes from outside): avoid it where you can, otherwise the right access (a tower put up by someone PASMA trained, a podium or scaffold) and no long tasks off a ladder: a ladder only for short, low-risk work, never for fixing a bracket and lifting a unit at first-floor height (HSE's ladder leaflet suggests other equipment for tasks over about 30 minutes in one position: confirm against the current issue). Outdoor units are a two-person lift. Not applicable only when everything is done from the ground or from inside.",
    evidenceHint: "The access method, who's trained (PASMA or IPAF), and a photo of the position.",
  },
  {
    key: "rams",
    label: "Risk assessment and method statement",
    category: "safety",
    statutory: true,
    gate: "ready-to-install",
    ownerRole: "tech-lead",
    allowNa: false,
    basis: "Management of Health and Safety at Work Regulations 1999; CDM 2015 (domestic client duties pass to the contractor: construction phase plan, induction, welfare)",
    guidance:
      "Write the risk assessment and method statement for this home: access, height, drilling, electrics, refrigerant, nitrogen and brazing (hot work: fire precautions and a fire watch), pets and children. Under CDM 2015 the household's client duties pass to us, so it also serves as the construction phase plan: site rules, emergency arrangements, the welfare agreed with the household (toilet, washing, water), the induction for everyone on site, and how we coordinate with the electrician. With a subcontractor on the job we're principal contractor and principal designer, and the handover leaves a short health and safety file (where the pipes and cables run hidden, the R32 refrigerant, the isolators). The crew read it before day 1.",
    evidenceHint: "The RAMS and construction phase plan, the crew's acknowledgement, and (with a subcontractor) the health and safety file notes.",
  },
  {
    key: "cancellation-and-consent",
    label: "Cancellation rights, contract copy and early start",
    category: "consumer",
    statutory: true,
    gate: "ready-to-install",
    ownerRole: "admin",
    allowNa: false,
    basis: "Consumer Contracts Regulations 2013 regs 10, 12, 29–31, 36",
    guidance:
      "The pre-contract information and cancellation form went out before acceptance, the contract confirmation reached the customer before work starts, and either the cancellation period has ended or the customer's early-start request is on a durable medium (their own email, or a signed form). Legal review required.",
    evidenceHint:
      "The confirmation email in messages, the customer's early-start email or signed form, and the cancellation dates on the booking page.",
  },

  /* ---------------- at commissioning ---------------- */
  {
    key: "commissioning-approval",
    label: "Commissioning results signed off",
    category: "commissioning",
    statutory: true,
    gate: "commissioned",
    ownerRole: "tech-lead",
    auto: "commissioning-signed",
    allowNa: false,
    basis: "F-gas leak check and records; manufacturer commissioning",
    guidance:
      "Updates itself when the technical lead signs commissioning: strength and tightness test, evacuation and decay, refrigerant added and the F-gas label, heating and cooling performance, condensate and defrost drainage.",
    evidenceHint: "The commissioning record.",
  },

  /* ---------------- before the job closes ---------------- */
  {
    key: "electrical-certificate",
    label: "Electrical certificate and notification",
    category: "electrical",
    statutory: true,
    gate: "closed",
    ownerRole: "electrician",
    allowNa: false,
    basis: "BS 7671; Building Regulations 2010 reg 20(3)",
    guidance:
      "A BS 7671 Electrical Installation Certificate for the new circuit, and the scheme's Building Regulations compliance certificate, which must reach the customer within 30 days of completion. The job can't close without it.",
    evidenceHint: "The EIC (PDF or photo) and the scheme's notification reference.",
  },
  {
    key: "commissioning-notice",
    label: "Commissioning notice to building control",
    category: "permissions",
    statutory: true,
    gate: "closed",
    ownerRole: "admin",
    basis: "Building Regulations 2010 reg 44 (commissioning). Building control to confirm",
    guidance:
      "Within 30 days of completion, give building control notice that the heat pump was commissioned to the manufacturer's instructions (the competent person scheme does it for its members when we register the job with them). The commissioning record is the evidence. Due 30 days after the install completed.",
    evidenceHint: "The scheme's job registration (or the notice sent to building control), with its date.",
  },
  {
    key: "heat-pump-compliance-certificate",
    label: "Building Regulations certificate for the heat pump, to the customer",
    category: "permissions",
    statutory: true,
    gate: "closed",
    ownerRole: "admin",
    basis: "Building Regulations 2010 reg 20 (competent person self-certification)",
    guidance:
      "Under a competent person scheme, the customer (the occupier) gets a Building Regulations compliance certificate for the heat pump work within 30 days of completion, as well as the electrician's one for the circuit. Under a building notice, it's building control's completion certificate instead. Chase it, and add it to the customer's documents. Due 30 days after the install completed.",
    evidenceHint: "The certificate (PDF or photo) and its number, or the council's completion certificate.",
  },
  {
    key: "warranty-registration",
    label: "Manufacturer warranty registered",
    category: "warranty",
    statutory: false,
    gate: "closed",
    ownerRole: "admin",
    auto: "warranty-registered",
    basis: "Manufacturer warranty terms",
    guidance:
      "Updates itself when the warranty is recorded as registered. Register within the manufacturer's deadline (some give 90 days from commissioning; check each brand's terms).",
    evidenceHint: "The manufacturer's registration confirmation.",
  },
];

/** The template entry for a key (checklists made from an older template may hold keys this one lacks). */
export function complianceTemplateFor(key: string): ComplianceTemplateItem | undefined {
  return COMPLIANCE_TEMPLATE.find((t) => t.key === key);
}

/** The groups the checklist is shown in, in journey order, with when each one is actually enforced. */
export const COMPLIANCE_GATE_GROUPS: { gate: GateId; title: string; enforced: string }[] = [
  {
    gate: "proposal-issue",
    title: "Before the proposal goes out",
    enforced: "Checked at ready to install: statutory items block day 1 until approved or not applicable.",
  },
  {
    gate: "booking",
    title: "Before the booking is confirmed",
    enforced: "Checked at ready to install: statutory items block day 1 until approved or not applicable.",
  },
  {
    gate: "ready-to-install",
    title: "Before install day 1",
    enforced: "Statutory items block day 1; the rest are flagged.",
  },
  { gate: "commissioned", title: "At commissioning", enforced: "Statutory items block commissioning sign-off." },
  { gate: "closed", title: "Before the job closes", enforced: "Statutory items block closing the job." },
];

export interface ComplianceHistoryEntry {
  at: string;
  by: string;
  byStaffId?: string;
  from: ComplianceStatus;
  to: ComplianceStatus;
  note?: string;
  overrideReason?: string;
  /** Evidence added in this step. */
  mediaIds?: string[];
}

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
  /** The reviewer's staff id, alongside their name. */
  reviewedByStaffId?: string;
  /** Every change, oldest first. */
  history?: ComplianceHistoryEntry[];
  /** The blocking issue raised when this item was rejected, until it's approved again. */
  blockerIssueId?: string;
  /** The latest written evidence (what someone checked), which counts as evidence like a file. */
  evidenceNote?: string;
  /** planning-pd, while approved: the technical lead's outcome. */
  planningOutcome?: PlanningOutcome;
  /** designations, while approved: is it a listed building, or in the curtilage of one? */
  listedBuilding?: "yes" | "no";
  /** heat-pump-building-regs, while approved: how the work is covered. */
  buildingRegsRoute?: BuildingRegsRoute;
}

/** The survey's and the property record's word on listing, before anyone checks the heritage list. */
export interface ListingFacts {
  /** The survey's permitted development answers (`not-listed` "no" means listed). */
  pd?: Partial<Record<string, "yes" | "no" | "unsure">>;
  /** The property record's flag (design site intel). */
  intelListed?: boolean;
}

/**
 * Is a listed building on record? The designations check's own answer
 * (from the heritage list) decides once it's approved; until then, the
 * survey saying it's listed, or the property record flagging it.
 */
export function listedOnRecord(items: Pick<ComplianceItem, "key" | "status" | "listedBuilding">[], facts: ListingFacts = {}): boolean {
  const checked = items.find((i) => i.key === "designations");
  if (checked?.status === "approved" && checked.listedBuilding) return checked.listedBuilding === "yes";
  return facts.pd?.["not-listed"] === "no" || facts.intelListed === true;
}

export function instantiateCompliance(projectId: string, makeId: () => string): ComplianceItem[] {
  return COMPLIANCE_TEMPLATE.map((t) => ({
    id: makeId(),
    projectId,
    key: t.key,
    label: t.label,
    category: t.category,
    statutory: t.statutory,
    gate: t.gate,
    status: t.initialStatus ?? "not-started",
    mediaIds: [],
  }));
}

/** Done, as far as readiness is concerned. */
export function isComplianceSettled(item: Pick<ComplianceItem, "status">): boolean {
  return item.status === "approved" || item.status === "not-applicable";
}

const AUTO_SOURCE: Record<NonNullable<ComplianceTemplateItem["auto"]>, string> = {
  "design-approved": "the design is approved",
  "commissioning-signed": "commissioning is signed off",
  "warranty-registered": "the warranty is recorded as registered",
};

const AUTO_REOPEN: Record<NonNullable<ComplianceTemplateItem["auto"]>, string> = {
  "design-approved": "the design is no longer the approved version",
  "commissioning-signed": "commissioning is no longer signed off",
  "warranty-registered": "the warranty is no longer recorded as registered",
};

function withHistory(item: ComplianceItem, entry: ComplianceHistoryEntry): ComplianceHistoryEntry[] {
  return [...(item.history ?? []), entry];
}

/** Drops undefined keys so the stored item stays JSON-clean. */
function clean(item: ComplianceItem): ComplianceItem {
  return JSON.parse(JSON.stringify(item)) as ComplianceItem;
}

/**
 * Move an item to a new status, as `reviewer`.
 *
 *  * approved: needs `compliance.review`, and evidence (an attached file) or
 *    a written note of what was checked. Statutory items can never be
 *    overridden, and some (planning) need the written outcome itself.
 *    Internal items may be approved without evidence only by an admin with
 *    an override reason, which is recorded.
 *  * not-applicable: `compliance.review` plus the reason, and only where
 *    "doesn't apply" can be true (never planning, F-gas, Part P, RAMS…).
 *  * rejected: `compliance.review` plus the reason (the server raises a
 *    blocking issue from it).
 *  * not-started / evidence-required / under-review: anyone who can review
 *    or edit the project; reopening an approved item needs a reviewer and a
 *    reason.
 * Automatic items follow the project's records and can't be approved by hand.
 */
/* ------------------------------------------------------------------ */
/* The company F-gas certificate                                       */
/* ------------------------------------------------------------------ */

const shortDate = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/**
 * Why the company F-gas certificate in settings doesn't cover this job, or
 * null when it does: a certifying body and a number on record, and an expiry
 * (if it has one) no earlier than the last booked install day (today while
 * nothing's booked). Refrigerant work is locked to certified holders, with
 * no override (plan §6).
 */
export function companyFgasCertProblem(
  cert: PilotSettings["company"]["fgasCompanyCert"],
  project: Pick<Project, "booking">,
  today: string,
): string | null {
  const last = [...(project.booking.dates ?? [])].sort().at(-1) ?? today.slice(0, 10);
  if (!cert || !cert.body?.trim() || !cert.number?.trim()) return "There's no company F-gas certificate in settings.";
  if (cert.expiresOn && cert.expiresOn.slice(0, 10) < last) {
    return `The company F-gas certificate (${cert.body.trim()} ${cert.number.trim()}) expires on ${shortDate(cert.expiresOn)}, before the last install day (${shortDate(last)}).`;
  }
  return null;
}

/**
 * The subcontracting route (plan §1, §10): the refrigerant work runs under a
 * certified company, and its certificate is attached to the item. Without an
 * attachment, the item rests on the certificate in settings.
 */
const restsOnSettingsCert = (item: Pick<ComplianceItem, "key" | "mediaIds">) => item.key === "fgas-company" && item.mediaIds.length === 0;

/**
 * What a review needs to know beyond the item: the company certificate's
 * standing (companyFgasCertProblem), whether a listed building is on record
 * (listedOnRecord), and the reviewer's own answer where an approval asks a
 * question (planning-pd's outcome, designations' "listed?").
 */
export interface ComplianceReviewContext {
  companyFgasProblem?: string | null;
  listed?: boolean;
  planningOutcome?: PlanningOutcome;
  listedBuilding?: "yes" | "no";
  /** For syncCompliance: the survey's and property record's word on listing (listedOnRecord reads it with the checklist). */
  listing?: ListingFacts;
  /** The survey's tenure: a leaseholder or tenant needs the freeholder's or landlord's written consent attached. */
  tenure?: "owner" | "leaseholder" | "tenant" | "unknown";
  /** The survey says asbestos is possible or suspected, or a flash guard may be: approving the asbestos check needs the result. */
  asbestosSuspected?: boolean;
  /** The reviewer's answer to approve heat-pump-building-regs. */
  buildingRegsRoute?: BuildingRegsRoute;
  /** A flat in a block, and whether it's a higher-risk building (the survey's block answers). */
  block?: BlockContext;
}

/** Tenures whose authority to contract rests on someone else's written consent. */
export const CONSENT_TENURES = ["leaseholder", "tenant"] as const;

/** Does the survey's answer need a test result before the asbestos check can be approved? */
export function asbestosSuspectedAtSurvey(m: { house?: { asbestosRisk?: string }; electrics?: { asbestosFlashGuard?: string } } | null | undefined): boolean {
  const r = m?.house?.asbestosRisk;
  const g = m?.electrics?.asbestosFlashGuard;
  return r === "possible" || r === "suspected" || g === "possible" || g === "yes";
}

export function reviewCompliance(
  item: ComplianceItem,
  to: ComplianceStatus,
  reviewer: StaffMember,
  note: string | undefined,
  overrideReason: string | undefined,
  now: string,
  context: ComplianceReviewContext = {},
): { ok: true; item: ComplianceItem } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!COMPLIANCE_STATUSES.includes(to)) return fail("Unknown status.");
  if (!reviewer.active) return fail("Only an active staff member can change the checklist.");
  if (to === item.status) return fail(`This is already ${COMPLIANCE_STATUS_TEXT[to].toLowerCase()}.`);

  const t = complianceTemplateFor(item.key);
  const text = note?.trim() || undefined;
  const override = overrideReason?.trim() || undefined;
  const reviews = can(reviewer, "compliance.review");
  const hasEvidence = item.mediaIds.length > 0 || Boolean(item.evidenceNote?.trim());
  const statutory = item.statutory || Boolean(t?.statutory);
  let usedOverride: string | undefined;

  if (override && !(to === "approved" && !statutory)) {
    return fail(
      statutory
        ? "Statutory items can't be overridden. Attach the evidence, or write down what you checked."
        : "An override only applies when approving.",
    );
  }

  switch (to) {
    case "approved": {
      if (t?.auto) return fail(`This one updates itself when ${AUTO_SOURCE[t.auto]}.`);
      if (!reviews) return fail(`${reviewer.name} can't approve compliance items: that needs the compliance review permission.`);
      if (statutory) {
        if (item.key === "planning-pd") {
          if (!context.planningOutcome || !PLANNING_OUTCOMES.includes(context.planningOutcome)) {
            return fail("Choose the outcome: PD checks passed, or planning permission or listed building consent needed.");
          }
          if (context.planningOutcome === "pd" && context.listed) {
            return fail(
              "A listed building is on record (the survey, the property record or the designations check): a listed building, or anything in its curtilage, has no permitted development rights. Choose \"consent needed\", or correct the designations check if it isn't listed.",
            );
          }
        }
        if (item.key === "designations" && context.listedBuilding !== "yes" && context.listedBuilding !== "no") {
          return fail("Answer the question: is it a listed building, or in the curtilage of one?");
        }
        if (item.key === "heat-pump-building-regs") {
          const problem = buildingRegsRouteProblem(context.buildingRegsRoute, context.block);
          if (problem) return fail(problem);
        }
        if ((t?.approvalNeeds ?? "evidence-or-note") === "note" && !text) {
          return fail("Write what you checked in the note: the outcome alone can't approve this.");
        }
        if (item.key === "asbestos" && context.asbestosSuspected && (item.mediaIds.length === 0 || !text)) {
          return fail(
            "The survey says asbestos is possible or suspected here: attach the test result or asbestos survey (or a photo of the route that avoids it) and say in the note how it's cleared or avoided.",
          );
        }
        if (t?.approvalNeeds === "evidence-and-note" && (item.mediaIds.length === 0 || !text)) {
          return fail("Attach the council's decision notice and write its reference, the date it was granted and its conditions: both are needed to approve this.");
        }
        if (!hasEvidence && !text) return fail("Attach the evidence, or write down what you checked, before approving.");
        // A note can't stand in for the certificate itself: settings must hold a current one, or the subcontractor's is attached.
        if (restsOnSettingsCert(item) && context.companyFgasProblem) {
          return fail(`${context.companyFgasProblem} Add the current certificate in settings, or attach the certified company's certificate here if they do the refrigerant work.`);
        }
      } else if (t?.approvalNeeds === "note" && !text) {
        return fail("Write the outcome in the note: what was checked and what was decided. Evidence alone (or an override) can't approve this.");
      } else if (item.key === "ownership-authority" && context.tenure && (CONSENT_TENURES as readonly string[]).includes(context.tenure) && item.mediaIds.length === 0) {
        return fail(
          `The survey records a ${context.tenure}: attach the ${context.tenure === "tenant" ? "landlord's" : "freeholder's or managing agent's"} written consent to the work (holes in the outside wall, the outdoor unit). A note or an override can't stand in for it.`,
        );
      } else if (!hasEvidence && !text) {
        if (!override) return fail("Attach evidence or write a note. To approve without either, an admin overrides with a reason.");
        if (!reviewer.roles.includes("admin")) return fail("Only an admin can approve without evidence (with a reason).");
        usedOverride = override;
      }
      break;
    }
    case "not-applicable": {
      if (!reviews) return fail(`${reviewer.name} can't mark compliance items not applicable: that needs the compliance review permission.`);
      if (t && t.allowNa === false) return fail(`"${item.label}" always applies, so it can't be marked not applicable.`);
      if (!text) return fail("Say why it doesn't apply.");
      break;
    }
    case "rejected": {
      if (!reviews) return fail(`${reviewer.name} can't reject compliance items: that needs the compliance review permission.`);
      if (!text) return fail("Say why it's rejected and what's needed.");
      break;
    }
    default: {
      const reopening = isComplianceSettled(item);
      if (reopening) {
        if (!reviews) return fail("Only a reviewer can reopen an approved item.");
        if (!text) return fail("Say why you're reopening it.");
      } else if (!reviews && !can(reviewer, "projects.edit") && !can(reviewer, "install.work")) {
        return fail(`${reviewer.name} can't change the checklist.`);
      }
      if (t?.auto && reopening) return fail(`This one updates itself when ${AUTO_SOURCE[t.auto]}.`);
    }
  }

  const decided = to === "approved" || to === "not-applicable" || to === "rejected";
  const next: ComplianceItem = {
    ...item,
    status: to,
    ...(text ? { note: text } : {}),
    history: withHistory(item, {
      at: now,
      by: reviewer.name,
      byStaffId: reviewer.id,
      from: item.status,
      to,
      ...(text ? { note: text } : {}),
      ...(usedOverride ? { overrideReason: usedOverride } : {}),
    }),
  };
  if (decided) {
    next.reviewedBy = reviewer.name;
    next.reviewedByStaffId = reviewer.id;
    next.reviewedAt = now;
  } else {
    delete next.reviewedBy;
    delete next.reviewedByStaffId;
    delete next.reviewedAt;
  }
  if (usedOverride) next.overrideReason = usedOverride;
  else delete next.overrideReason;
  // The answers an approval records hold only while it stands.
  if (to === "approved" && item.key === "planning-pd") next.planningOutcome = context.planningOutcome;
  else delete next.planningOutcome;
  if (to === "approved" && item.key === "designations") next.listedBuilding = context.listedBuilding;
  else delete next.listedBuilding;
  if (to === "approved" && item.key === "heat-pump-building-regs") next.buildingRegsRoute = context.buildingRegsRoute;
  else delete next.buildingRegsRoute;
  return { ok: true, item: clean(next) };
}

/**
 * Add evidence (files) and/or a note. An item still waiting for evidence
 * (or rejected) moves to "waiting for review"; a settled one keeps its
 * status, with the addition in its history.
 */
export function addComplianceEvidence(
  item: ComplianceItem,
  input: { mediaIds?: string[]; note?: string },
  by: { name: string; staffId?: string },
  now: string,
): { ok: true; item: ComplianceItem } | { ok: false; error: string } {
  const added = [...new Set((input.mediaIds ?? []).map((m) => m.trim()).filter(Boolean))].filter((m) => !item.mediaIds.includes(m));
  const text = input.note?.trim() || undefined;
  if (added.length === 0 && !text) return { ok: false, error: "Add a file or write a note first." };
  if (!by.name.trim()) return { ok: false, error: "Who's adding this?" };
  const moves = item.status === "not-started" || item.status === "evidence-required" || item.status === "rejected";
  const to: ComplianceStatus = moves ? "under-review" : item.status;
  const next: ComplianceItem = {
    ...item,
    status: to,
    mediaIds: [...item.mediaIds, ...added],
    ...(text ? { note: text, evidenceNote: text } : {}),
    history: withHistory(item, {
      at: now,
      by: by.name,
      ...(by.staffId ? { byStaffId: by.staffId } : {}),
      from: item.status,
      to,
      ...(text ? { note: text } : {}),
      ...(added.length ? { mediaIds: added } : {}),
    }),
  };
  return { ok: true, item: clean(next) };
}

const lastEvent = (p: Project, type: string) => [...p.events].reverse().find((e) => e.type === type);
const lastEventAt = (p: Project, type: string) => lastEvent(p, type)?.at;

/**
 * Bring the automatic items into line with the project's own records, and
 * move the planning check to "waiting for review" once the survey (with its
 * permitted development checklist) is in. Returns only the items that
 * changed. Never approves planning, and never approves anything the
 * project hasn't recorded.
 */
/** The note the design verdict leaves, so a later sync knows which approvals were its own. */
const FROM_DESIGN = "From the approved design";

/** How the planning consent item says it isn't needed. */
const NOT_NEEDED = "Not needed";

/**
 * "Equipment combination verified", read from the approved design (F3):
 * every system in every option passes its compatibility check, and any
 * combination the catalogue only has a provisional rule for was confirmed
 * against the manufacturer's table when the design was approved. Null when
 * the design doesn't settle it (not approved, an error, or a provisional
 * rule nobody confirmed): then a technical lead reviews it by hand.
 */
export function designCompatibilityVerdict(design: DesignRecord | null | undefined): { by: string; at: string; note: string } | null {
  if (!design || design.status !== "approved" || !design.approval) return null;
  const systems = (design.variants ?? []).flatMap((v) => v.systems ?? []);
  if (systems.length === 0) return null;
  if (systems.some((s) => !s.compatibility?.ok || (s.compatibility.errors ?? []).length > 0)) return null;
  const provisional = systems.some((s) => s.topology === "multi" && s.ruleConfidence !== "verified");
  const ack = design.acknowledgements?.combinationTable;
  if (provisional && !ack) return null;
  const parts = [
    `${FROM_DESIGN} (v${design.version}, signed off by ${design.approval.name}): every system passes the compatibility check`,
    ...(provisional && ack ? [`${ack.by} confirmed the manufacturer's combination table`] : []),
  ];
  return { by: design.approval.name, at: design.approval.at, note: `${parts.join("; ")}.` };
}

/**
 * The automatic items brought up to date from the project's own records,
 * and "equipment combination verified" from the approved design when one is
 * given (designCompatibilityVerdict). Returns only the items that changed.
 */
export function syncCompliance(
  items: ComplianceItem[],
  project: Project,
  now: string,
  design?: DesignRecord | null,
  context: ComplianceReviewContext = {},
): ComplianceItem[] {
  const changed: ComplianceItem[] = [];
  const set = (item: ComplianceItem, to: ComplianceStatus, by: string, at: string, note: string) => {
    const next: ComplianceItem = {
      ...item,
      status: to,
      history: withHistory(item, { at: now, by, from: item.status, to, note }),
    };
    if (to === "approved") {
      next.reviewedBy = by;
      next.reviewedAt = at;
      delete next.reviewedByStaffId;
      delete next.overrideReason;
    } else {
      delete next.reviewedBy;
      delete next.reviewedAt;
      delete next.reviewedByStaffId;
      delete next.planningOutcome;
      delete next.listedBuilding;
      delete next.buildingRegsRoute;
    }
    // A status the system decided says why, where the item shows its note.
    if (to === "not-applicable" || (item.key === "planning-consent" && to === "evidence-required")) next.note = note;
    changed.push(clean(next));
  };
  const beforeDay1 = project.install.status === "not-started" && !project.closure.closed;
  const planningPd = items.find((i) => i.key === "planning-pd");
  const listed = listedOnRecord(items, context.listing);

  for (const item of items) {
    const auto = complianceTemplateFor(item.key)?.auto;
    if (auto) {
      if (item.status === "not-applicable") continue; // a reviewer decided it doesn't apply
      let done: { by: string; at: string } | null = null;
      if (auto === "design-approved" && project.design.status === "approved") {
        done = { by: project.design.approvedBy ?? "Technical lead", at: project.design.approvedAt ?? now };
      }
      if (auto === "commissioning-signed" && project.handover.status !== "pending") {
        done = { by: project.handover.commissionedBy ?? "Technical lead", at: project.handover.commissionedAt ?? now };
      }
      if (auto === "warranty-registered" && project.handover.warrantyRegistered) {
        // Whoever recorded the registration ("Approved by DEMO Ada"), never a phrase that reads as a name.
        const e = lastEvent(project, "warranty-registered");
        done = { by: e?.actorName ?? "the office", at: e?.at ?? now };
      }
      if (done && item.status !== "approved") {
        set(item, "approved", done.by, done.at, `Updated automatically: ${AUTO_SOURCE[auto]}.`);
      } else if (!done && item.status === "approved") {
        set(item, "under-review", "System", now, `Reopened automatically: ${AUTO_REOPEN[auto]}.`);
      }
      continue;
    }
    if (item.key === "equipment-compatibility" && design !== undefined) {
      const verdict = designCompatibilityVerdict(design);
      const ours = (item.history ?? []).at(-1)?.note?.startsWith(FROM_DESIGN) ?? false;
      if (verdict && (item.status === "not-started" || item.status === "evidence-required" || item.status === "under-review")) {
        set(item, "approved", verdict.by, verdict.at, verdict.note);
        continue;
      }
      if (!verdict && item.status === "approved" && ours) {
        set(item, "under-review", "System", now, "Reopened automatically: the design is no longer the approved version, or its compatibility check changed.");
        continue;
      }
    }
    // Planning and noise were reviewed before the approved design version existed (against an
    // earlier one, or none): that version (more outdoor units, a bigger or louder one, a new
    // position) needs them looked at again. A review made while this version was drafted or in
    // review stands.
    if (
      (item.key === "planning-pd" || item.key === "noise-assessment") &&
      item.status === "approved" &&
      design?.status === "approved" &&
      item.reviewedAt &&
      Date.parse(item.reviewedAt) < Date.parse(design.createdAt)
    ) {
      set(
        item,
        "under-review",
        "System",
        now,
        `Reopened automatically: design version ${design.version} was approved after this was reviewed. Check its unit count, size and noise results on this page.`,
      );
      continue;
    }
    // Approved on the strength of the company certificate in settings, which no longer covers the job: back to review.
    if (item.status === "approved" && restsOnSettingsCert(item) && context.companyFgasProblem) {
      set(item, "under-review", "System", now, `Reopened automatically: ${context.companyFgasProblem}`);
      continue;
    }
    // The route recorded no longer fits the home (the survey now says a flat, or a higher-risk building), or was
    // never a choice: asked again before day 1, so a building notice in a block can't stand.
    if (
      beforeDay1 &&
      item.key === "heat-pump-building-regs" &&
      item.status === "approved" &&
      (!item.buildingRegsRoute || (context.block && buildingRegsRouteProblem(item.buildingRegsRoute, context.block)))
    ) {
      set(
        item,
        "under-review",
        "System",
        now,
        item.buildingRegsRoute
          ? `Reopened automatically: ${buildingRegsRouteProblem(item.buildingRegsRoute, context.block)}`
          : "Reopened automatically: choose the route (our competent person scheme, full plans, a building notice, or the Building Safety Regulator), so the checklist can tell whether it fits this home.",
      );
      continue;
    }
    // Approved before the outcome (or the listing answer) was a recorded choice: the free-text note
    // can't tell the checklist whether a consent must be granted first, so it's asked again before day 1.
    if (beforeDay1 && item.status === "approved" && ((item.key === "planning-pd" && !item.planningOutcome) || (item.key === "designations" && !item.listedBuilding))) {
      set(
        item,
        "under-review",
        "System",
        now,
        item.key === "planning-pd"
          ? "Reopened automatically: choose the outcome (PD checks passed, or planning permission or listed building consent needed), so the checklist knows whether a consent must be granted before day 1."
          : "Reopened automatically: answer whether it's a listed building (or in the curtilage of one), so the checklist knows whether listed building consent must be granted before day 1.",
      );
      continue;
    }
    if (item.key === "planning-consent") {
      const outcome = planningPd?.status === "approved" ? planningPd.planningOutcome : undefined;
      const needed = listed || outcome === "consent-needed";
      const notNeeded = !listed && outcome === "pd";
      if (item.status === "approved" || item.status === "rejected") continue; // a person decided
      if (notNeeded) {
        if (item.status !== "not-applicable") {
          const when = planningPd?.reviewedAt ? ` on ${shortDate(planningPd.reviewedAt)}` : "";
          set(item, "not-applicable", "System", now, `${NOT_NEEDED}: ${planningPd?.reviewedBy ?? "the technical lead"} recorded "PD checks passed"${when}, and no listed building is on record.`);
        }
        continue;
      }
      if (item.status === "not-applicable" || (needed && item.status === "not-started")) {
        const why = listed
          ? "a listed building is on record (the survey, the property record or the designations check)"
          : outcome === "consent-needed"
            ? `${planningPd?.reviewedBy ?? "the technical lead"} recorded "planning permission or listed building consent needed"`
            : "the planning outcome is no longer recorded";
        set(
          item,
          needed ? "evidence-required" : "not-started",
          "System",
          now,
          needed ? `Needed: ${why}. Attach the council's decision notice once it's granted.` : `Reopened automatically: ${why}.`,
        );
      }
      continue;
    }
    if (
      item.key === "planning-pd" &&
      project.survey.status === "submitted" &&
      (item.status === "not-started" || item.status === "evidence-required")
    ) {
      set(
        item,
        "under-review",
        "System",
        now,
        "The survey's permitted development checklist is in. A technical lead confirms the outcome: planning is never concluded automatically.",
      );
    }
  }
  return changed;
}

/**
 * The checklist as the day-1 gate must read it, without waiting for someone
 * to open the compliance page: the planning consent item added if this
 * checklist predates it, and brought in line with the planning outcome and
 * the listing on record (syncCompliance), so "PD checks passed" on a
 * building that isn't listed settles it, and "consent needed" or a listed
 * building holds day 1. Nothing is saved: the compliance page saves the
 * same change when it's next opened.
 */
export function planningConsentForGate(items: ComplianceItem[], project: Project, listing: ListingFacts, now: string): ComplianceItem[] {
  if (items.length === 0) return items;
  const all: ComplianceItem[] = items.some((i) => i.key === "planning-consent")
    ? items
    : [...items, ...instantiateCompliance(project.id, () => "planning-consent-pending").filter((i) => i.key === "planning-consent")];
  const relevant = all.filter((i) => i.key === "planning-consent" || i.key === "planning-pd" || i.key === "designations");
  const changed = new Map(syncCompliance(relevant, project, now, undefined, { listing }).map((c) => [c.id, c]));
  return all.map((i) => changed.get(i.id) ?? i);
}

/** Counts for a summary strip: how far the checklist is, and what still holds a gate. */
export function complianceProgress(items: ComplianceItem[]): {
  total: number;
  settled: number;
  open: number;
  statutoryOpen: number;
  rejected: number;
  awaitingReview: number;
} {
  const open = items.filter((i) => !isComplianceSettled(i));
  return {
    total: items.length,
    settled: items.length - open.length,
    open: open.length,
    statutoryOpen: open.filter((i) => i.statutory).length,
    rejected: items.filter((i) => i.status === "rejected").length,
    awaitingReview: items.filter((i) => i.status === "under-review").length,
  };
}
