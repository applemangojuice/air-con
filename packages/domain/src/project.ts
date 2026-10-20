import type { ConfidenceBand, ElectricsCondition, QuoteResult, Survey } from "./types.ts";
import { getArchetype, getPermutation } from "./archetypes.ts";
import type { ComplianceStatus } from "./compliance.ts";
import {
  INSTALL_LEAD_DAYS,
  RESCHEDULE_FEES,
  daysBetween,
  type ElectricsPlanStatus,
  type InstallerProfile,
  type PrepItem,
  type TimelineDateKind,
} from "./project-v1.ts";
import type { IssueKind, IssueStatus, VariationStatus } from "./issues.ts";
import { DEFAULT_SETTINGS, schedule2Missing, type PilotSettings } from "./settings.ts";
import { ROLE_LABEL, can, meetsRequirement, type StaffMember, type StaffRole } from "./staff.ts";
import { addWorkingDays, nextWorkingDay, notWorkingReason } from "./working-days.ts";

// Unchanged from v1: one declaration, shared by both machines.
export { daysBetween };
export type { ElectricsPlanStatus, InstallerProfile, PrepItem, TimelineDateKind };

/**
 * The project workflow, v2: the pilot journey from instant price to aftercare.
 *
 *   price → survey → proposal → booking → kit → install → handover → aftercare
 *
 * Same design rules as v1 (project-v1.ts), stricter states:
 *  * The Project is a plain JSON snapshot (`schemaVersion: 2`). It persists
 *    to JSONB as-is; `migrateProject` lifts v1 snapshots on read.
 *  * Every transition goes through `applyProjectAction`, a pure reducer.
 *    The server runs it with a ReadinessContext built from the database
 *    (the authority); demo mode runs it client-side with a demo context.
 *  * Gates live here, not in the UI. `readiness()` lists every blocker with
 *    an owner and a next action, and gated actions refuse with exactly those
 *    blockers so the screen can say what's missing.
 *  * Honest states only: nothing is paid, delivered, approved or signed
 *    until an action records it, and nothing is inferred from a date.
 */

/* ------------------------------------------------------------------ */
/* Stages                                                             */
/* ------------------------------------------------------------------ */

export const PROJECT_SCHEMA_VERSION = 2;

export const PROJECT_STAGES = [
  "price",
  "survey",
  "proposal",
  "booking",
  "kit",
  "install",
  "handover",
  "aftercare",
] as const;

export type ProjectStageId = (typeof PROJECT_STAGES)[number];

export interface StageInfo {
  id: ProjectStageId;
  /** Short label on the timeline node. */
  label: string;
  title: string;
  /** One-liner under the title on the stage page. */
  strap: string;
  /** "What happens here", shown even when the stage is greyed out in the future. */
  explainer: string[];
}

// Facts that settings control (warranty terms, survey length, install days,
// the cancellation period) never appear here: STAGE_INFO is the generic copy,
// and `stageInfo(stage, settings)` fills them in from the live settings.
export const STAGE_INFO: Record<ProjectStageId, StageInfo> = {
  price: {
    id: "price",
    label: "Price",
    title: "Your instant price",
    strap: "A real price for your home in about two minutes. No sales visit, no clipboard, no waiting by the phone.",
    explainer: [
      "You told us about your home and we priced the whole job on the spot: heating and cooling, fitted.",
      "Next we come round and see it properly. The survey turns your price into a real design.",
      "If the survey finds something that changes the price, your proposal says exactly what and why before you agree to anything.",
    ],
  },
  survey: {
    id: "survey",
    label: "Survey",
    title: "Your home survey",
    strap: "One visit to measure up and check the details.",
    explainer: [
      "A surveyor comes to your home and measures each room, checks your walls and windows, and looks at where the outdoor unit could go.",
      "We photograph the spots we'd use, check your fuse board and the cable route, and note anything that needs a closer look.",
      "Please make sure we can get to your fuse board and loft, if you have one. Have a think about where you'd like the units.",
    ],
  },
  proposal: {
    id: "proposal",
    label: "Proposal",
    title: "Your proposal",
    strap: "Your design and fixed price, drawn on photos of your own rooms.",
    explainer: [
      "We design your system from the survey: the right unit for each room, where it goes and how the pipes run.",
      "A qualified engineer checks and signs off the design before you see a price.",
      "Your proposal shows each room with the unit drawn on your own photo, what's included, and the price in writing. Accept it, ask for changes, or say no thanks.",
    ],
  },
  booking: {
    id: "booking",
    label: "Booking",
    title: "Booking your install",
    strap: "Pick your install dates and meet the people who'll be there.",
    explainer: [
      "Choose install dates that suit you. We only offer dates we can actually do.",
      "You'll see who's coming: names, roles and the qualifications they actually hold.",
      "You can cancel without giving a reason during your cancellation period. We start after it ends, or sooner if you ask us to by email or on a signed form.",
    ],
  },
  kit: {
    id: "kit",
    label: "Kit",
    title: "Your kit",
    strap: "Your exact equipment, ordered for your design and checked before it goes up.",
    explainer: [
      "We order the units and materials your design calls for. No van of mystery stock.",
      "We'll tell you when the supplier confirms a date and when it's arrived. Nothing says delivered until someone has actually seen it.",
      "Your installer checks every box against your design before anything goes on the wall.",
    ],
  },
  install: {
    id: "install",
    label: "Install",
    title: "Install days",
    strap: "A tidy crew, and an update at the end of every day.",
    explainer: [
      "Roughly: first we mark out and drill, then the units go up, and last come the pipes, power and testing.",
      "The power goes off for up to 30 minutes while we connect the new circuit. We'll tell you before it happens.",
      "Every step is photographed and checked, and you get a short update with photos at the end of each day.",
    ],
  },
  handover: {
    id: "handover",
    label: "Handover",
    title: "Handover",
    strap: "Commissioned, explained, and all your paperwork in one place.",
    explainer: [
      "Before we leave, a qualified engineer tests and commissions the system and signs it off.",
      "We show you the remote, the app, heating mode and filter cleaning, plus what's normal (a puff of steam on defrost is fine).",
      "Your handover pack holds your equipment and serial numbers, certificates, warranty details and care guide. Sign off when you're happy, or tell us about any snags.",
    ],
  },
  aftercare: {
    id: "aftercare",
    label: "Aftercare",
    title: "Aftercare",
    strap: "We don't vanish when the van leaves.",
    explainer: [
      "We check in after a week to see how it's running, ask what you think after a month, and check again when the season first turns.",
      "Something not right? Report it here and we'll arrange a callback.",
      "We'll remind you when the yearly service is due.",
    ],
  },
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A stage's copy with the numbers settings control filled in: the survey
 * length, the install block and the cancellation period. Customer screens
 * use this; STAGE_INFO is the generic fallback. With the project, the
 * cancellation sentence is that contract's own (cancellationCopy).
 */
export function stageInfo(stage: ProjectStageId, settings: PilotSettings, project?: Project): StageInfo {
  const base = STAGE_INFO[stage];
  const info: StageInfo = { ...base, explainer: [...base.explainer] };
  const { surveyDurationMinutes, installBlockDays, cancellationDays } = settings.scheduling;
  const days = Math.max(1, Math.round(installBlockDays));
  switch (stage) {
    case "survey":
      if (surveyDurationMinutes > 0) {
        info.strap = `One visit, about ${Math.round(surveyDurationMinutes)} minutes, to measure up and check the details.`;
      }
      break;
    case "booking":
      info.explainer[0] =
        days === 1
          ? "Choose an install day that suits you. We only offer dates we can actually do."
          : `Choose a ${numberWord(days)}-day block that suits you. We only offer dates we can actually do.`;
      if (project) {
        info.explainer[2] = `${cancellationCopy(project, { settings })} We start after it ends, or sooner if you ask us to by email or on a signed form.`;
      } else if (cancellationDays > 0) {
        info.explainer[2] = `You can cancel without giving a reason until ${cancellationDays} days after your equipment is delivered (or ${cancellationDays} days after you accept, if you're supplying the equipment yourself). We start after that, or sooner if you ask us to by email or on a signed form.`;
      }
      break;
    case "install":
      info.strap =
        days === 1
          ? "One day, a tidy crew, and an update at the end of it."
          : `${capitalise(numberWord(days))} days, a tidy crew, and an update at the end of each one.`;
      if (days === 3) {
        info.explainer[0] =
          "Roughly: day one is marking out and drilling, day two the units go up, day three is pipes, power and testing.";
      }
      break;
  }
  return info;
}

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

export type ProjectActor = "customer" | "ops" | "field" | "system";

export interface ProjectEvent {
  at: string; // ISO datetime
  type: string;
  /** Customer-facing update line, unless `internal`. */
  label: string;
  actor: ProjectActor;
  actorName?: string;
  /** Ops-only: never shown on customer screens. */
  internal?: boolean;
  feeGbp?: number;
}

/** The London calendar date (yyyy-mm-dd) of an instant. */
function londonDateOf(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** How a customer told us they're cancelling. Any clear statement counts (CCR reg 32(3)). */
export type CancellationChannel = "email" | "letter" | "phone" | "in-person" | "portal";
export const CANCELLATION_CHANNELS: readonly CancellationChannel[] = ["email", "letter", "phone", "in-person", "portal"];

/**
 * A cancellation of the contract, recorded when it reached us: the proof of
 * when and how (reg 32(5) puts that on the customer, but we keep it), and
 * the refund deadline it sets (reg 34: 14 days after the day we were told).
 */
export interface CancellationRecord {
  /** When the customer's notice reached us (not when it was recorded). */
  receivedAt: string;
  channel: CancellationChannel;
  /** The email's date and subject, the letter, the call note: where the notice is on file. */
  evidenceRef: string;
  recordedAt: string;
  recordedBy?: string;
  /** Inside the statutory cancellation period when it arrived (or the period hadn't started). */
  withinPeriod: boolean;
  /** The last day for the refund: 14 days after the day the notice reached us. */
  refundDueBy: string;
  /**
   * What the family pays for the work done before they cancelled, after
   * they'd expressly asked us to start early (CCR reg 36(4)): recorded by the
   * office (`cancellation-charge-recorded`, cancellationChargeProblem), and
   * billed on a `cancellation-charge` invoice. The rest of what they paid is
   * refunded (cancellationSettlement).
   */
  charge?: CancellationCharge;
}

/** The proportionate charge for services supplied before a cancellation (reg 36(4)-(6)). */
export interface CancellationCharge {
  /** VAT included, as every customer figure: never more than the contract total. */
  amountPence: number;
  /** How it was worked out, in writing: printed on the invoice and in the email. */
  basis: string;
  recordedAt: string;
  recordedBy: string;
  /** The form's one-off id: recording it again (a double click, a retry) changes nothing. */
  requestId?: string;
  /** Taken off since by credit notes against its invoice (`cancellation-charge-credited`): already out of `amountPence`. */
  creditedPence?: number;
  creditNoteIds?: string[];
}

export interface CrewMember {
  staffId: string;
  name: string;
  role: StaffRole;
  external: boolean;
}

/**
 * Who supplies the kit, which decides the cancellation clock (CCR 2013 reg 5,
 * 30): `supply-and-install` has goods and services as its object, so it's a
 * sales contract and the period runs from delivery of the goods;
 * `install-only` (the customer bought the kit) is a service contract and the
 * period runs from acceptance. Legal review required: see cancellationStatus.
 */
export type ContractType = "supply-and-install" | "install-only";
export const CONTRACT_TYPES: readonly ContractType[] = ["supply-and-install", "install-only"];

/**
 * How the customer agreed to get contract documents by email instead of on
 * paper (CCR reg 10(2)). The pilot has no paper route: without this
 * agreement no proposal can be issued, and the copy says so (never "we'll
 * post them").
 */
export type DocumentsConsentChannel = "portal" | "in-person" | "email";

/** The portal's tick box (the hub's proposal panel and the survey booking form), word for word. */
export const DOCUMENTS_CONSENT_LABEL = "I'm happy to receive my proposal and contract documents by email";
export const DOCUMENTS_CONSENT_HINT =
  "Your proposal, contract and cancellation form are legal documents, so we need your OK to email them. During the pilot we can't send them on paper: if you'd rather not have them by email, leave this unticked and we'll get in touch to talk it through.";

/**
 * The words each way of agreeing used, versioned. Reg 10(2) lets the
 * pre-contract information and the contract go by email instead of on paper
 * only with the customer's agreement, and we must be able to show that
 * agreement (reg 17), so the record keeps the words, their version, the
 * address it covers and, when staff recorded it, who did and where the
 * evidence is.
 */
export const DOCUMENTS_CONSENT_WORDING: Record<DocumentsConsentChannel, { version: string; text: string }> = {
  // portal-1 (until 20 Oct 2026) ended "otherwise we'll arrange paper copies, which takes a little longer."
  portal: { version: "docs-by-email/portal-2", text: `${DOCUMENTS_CONSENT_LABEL}. ${DOCUMENTS_CONSENT_HINT}` },
  "in-person": {
    version: "docs-by-email/in-person-1",
    text: "Asked in person: \"Are you happy to receive your proposal and contract documents by email?\" The customer said yes.",
  },
  email: {
    version: "docs-by-email/email-1",
    text: "The customer told us by email that they're happy to receive their proposal and contract documents by email.",
  },
};

/** The customer's agreement to get the contract documents by email, as recorded. */
export interface DocumentsConsentRecord {
  at: string;
  channel: DocumentsConsentChannel;
  /** DOCUMENTS_CONSENT_WORDING[channel]: what they agreed to. Absent on agreements recorded before it was kept. */
  wordingVersion?: string;
  text?: string;
  /** The address the agreement covers: the customer's email when they gave it. */
  email?: string;
  /** Recorded by staff (in person, by email): who recorded it. */
  recordedBy?: { staffId: string; name: string };
  /** Recorded by staff: how and when they agreed, and where the proof is (the email's date and subject, say). */
  evidence?: string;
  /** A photo or screenshot of the evidence, when there is one. */
  evidenceMediaId?: string;
}

/**
 * Does the recorded agreement cover the address we'd send to? An agreement
 * given for one address doesn't carry over to a different one; older
 * records without an address are taken as covering the one on file.
 */
export function documentsConsentCovers(project: Pick<Project, "proposal" | "customer">): boolean {
  const c = project.proposal.documentsByEmailConsent;
  if (!c) return false;
  if (!c.email) return true;
  const now = project.customer.email?.trim().toLowerCase();
  return !now || c.email.trim().toLowerCase() === now;
}

/**
 * The customer's request to start inside the cancellation period (CCR reg
 * 36(1)): an express request, made by the customer on a durable medium for
 * an off-premises contract. The portal tick records the request; it only
 * counts once `evidencedAt` records the durable copy (their email reply with
 * the early-start wording, or a signed form), and the trader carries the
 * burden of proof (reg 17), so the copy itself is stored with the project
 * (`mediaIds`: the email saved as a PDF or a screenshot, or the signed form)
 * with when it reached us and, for an email, the address it came from.
 */
export interface EarlyStartRecord {
  requested: boolean;
  requestedAt?: string;
  /** Where the request was made: the portal tick, then the durable copy's medium once evidenced. */
  channel?: "email" | "paper" | "portal";
  /** Which email or form it is, so anyone can find the original: its date and subject, or the form's reference. */
  evidenceRef?: string;
  /** The stored copy: the customer's email (PDF or screenshot) or the signed form, in the project's media. */
  mediaIds?: string[];
  /** The London day the request reached us (on or after acceptance, never in the future). */
  receivedOn?: string;
  /** For an email: the address it came from, which is the customer's own. */
  fromAddress?: string;
  evidencedAt?: string;
  /** The signed-in staff member who recorded the evidence. */
  recordedBy?: string;
  /** EARLY_START_WORDING_VERSION of the words the customer was asked to use. */
  wordingVersion: string;
}

export interface InstallDay {
  n: number;
  date: string; // yyyy-mm-dd
  status: "planned" | "in-progress" | "done";
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  customerUpdate?: { text: string; mediaIds: string[]; sentAt: string };
}

export interface Project {
  schemaVersion: 2;
  id: string;
  quoteId: string;
  createdAt: string;
  pilot?: { number: number; label: string };
  customer: {
    name: string;
    email?: string;
    phone?: string;
    postcode: string;
    addressLine: string;
    customerId?: string;
    accessNotes?: string;
    parkingNotes?: string;
  };
  owner?: { staffId: string; name: string };
  nextAction?: { text: string; dueOn?: string; ownerRole?: StaffRole | "customer" };
  quoteSummary: {
    totalGbp: number;
    installDays: number;
    roomCount: number;
    confidenceBand: ConfidenceBand;
    systems: string[];
    roomDesigns: { name: string; floor: string; unitLabel: string }[];
  };
  roughPlan: { archetypeName?: string; pattern?: { label: string; summary: string; pipeRoute: string } };
  survey: {
    status: "not-booked" | "booked" | "in-progress" | "submitted";
    mode: "in-person" | "video";
    scheduledFor?: string;
    durationMinutes: number;
    feeGbp: number;
    paymentStatus: "not-required" | "unpaid" | "paid";
    surveyor?: { staffId: string; name: string };
    onMyWay?: { at: string; etaMinutes: number };
    startedAt?: string;
    submittedAt?: string;
    surveyRecordId?: string;
    rescheduleFeesGbp: number;
  };
  electrics: { status: ElectricsPlanStatus; summary: string; surveyCondition: ElectricsCondition };
  design: {
    status: "not-started" | "draft" | "in-review" | "approved";
    designId?: string;
    version?: number;
    approvedAt?: string;
    approvedBy?: string;
  };
  proposal: {
    status: "not-issued" | "issued" | "changes-requested" | "accepted" | "declined" | "expired";
    proposalId?: string;
    version?: number;
    issuedAt?: string;
    viewedAt?: string;
    validUntil?: string;
    optionCount?: number;
    acceptedAt?: string;
    acceptedOptionLabel?: string;
    contractTotalPence?: number;
    /** Set at issue; supply-and-install until then. */
    contractType: ContractType;
    /** Agreement to get the contract documents by email (the law's default is paper, which the pilot can't do). Proposal issue needs it. */
    documentsByEmailConsent?: DocumentsConsentRecord;
    /**
     * When the issue email carrying the Schedule 2 information, the
     * cancellation instructions and the model form (the durable medium)
     * reached the provider for this version: recorded by the outbox
     * (`pre-contract-info-sent`), never at issue, so a failed send leaves it
     * unset and the proposal can't be accepted until it goes.
     */
    preContractInfoSentAt?: string;
    /** When the acceptance confirmation (the contract copy) was sent. Needed before work starts (reg 12(4)). */
    confirmationSentAt?: string;
    /** Kept in step with `earlyStart.requested` for older readers. */
    earlyStartRequested?: boolean;
    earlyStart?: EarlyStartRecord;
    /** supply-and-install: the day the last of the goods arrived (reg 30(3)–(4)), which starts the countdown. */
    goodsReceivedOn?: string;
    /**
     * The reg 30 end date, inclusive: install-only from acceptance,
     * supply-and-install from `goodsReceivedOn` (unset until then). Read it
     * through cancellationStatus, which also applies reg 31.
     */
    cancellationEndsOn?: string;
    changeRequest?: string;
    declineReason?: string;
  };
  booking: {
    status: "not-booked" | "booked";
    startDate?: string;
    dates: string[];
    installDays: number;
    crew: CrewMember[];
    depositStatus: "not-required" | "requested" | "paid";
    rescheduleFeesGbp: number;
    prep: PrepItem[];
  };
  kit: {
    status: "not-ordered" | "ordered" | "confirmed" | "dispatched" | "delivered" | "inspected";
    expectedDate?: string;
    deliveredAt?: string;
    inspectedAt?: string;
    summary?: string;
    shortages: number;
    /**
     * Where the delivered kit is: "customer" when every required item went
     * to the customer's home, "elsewhere" when any of it went to our storage,
     * the installer or a subcontractor (it then reaches the customer with
     * the crew, on install day 1). Decides when a supply-and-install
     * cancellation period starts (reg 30(3)).
     */
    deliveredTo?: "customer" | "elsewhere";
  };
  install: {
    status: "not-started" | "in-progress" | "complete";
    days: InstallDay[];
    startedAt?: string;
    completedAt?: string;
    onMyWay?: { at: string; etaMinutes: number; by: string };
  };
  handover: {
    status: "pending" | "commissioned" | "handed-over";
    commissionedAt?: string;
    commissionedBy?: string;
    handedOverAt?: string;
    signoff?: { at: string; name: string; outcome: "all-good" | "snags"; snagCount: number };
    packDocumentId?: string;
    electricalCert: "pending" | "received" | "not-required";
    /** The certificate document (kind "certificate") behind "received". */
    electricalCertDocumentId?: string;
    warrantyRegistered: boolean;
    /** The warranty registration document behind "registered". */
    warrantyDocumentId?: string;
    warrantyDueOn?: string;
  };
  closure: { closed: boolean; closedAt?: string; reason?: string };
  /** The customer's cancellation of the contract, as received (cancellation-received). */
  cancellation?: CancellationRecord;
  aftercare: {
    checkIn7dSentAt?: string;
    feedbackRequestedAt?: string;
    feedback?: { at: string; score: number; comments?: string };
    reviewRequestedAt?: string;
    seasonalCheckSentAt?: string;
    /** The customer asked for no more follow-ups (check-ins, feedback, review, seasonal, service reminders). */
    followUpsOptedOutAt?: string;
    serviceDueOn?: string;
  };
  money: {
    contractTotalPence?: number;
    invoicedPence: number;
    paidPence: number;
    changeFeesPence: number;
    /** Payment ids already counted in paidPence: a retried apply can't count one twice. */
    paymentIds?: string[];
  };
  events: ProjectEvent[];
}

/** payment-recorded's refusal for a payment id the totals already count (a retried apply). */
export const PAYMENT_ALREADY_COUNTED = "That payment is already counted in the project's totals.";

/** Manufacturers want registering soon after install; terms vary, so this is a safe default. */
export const WARRANTY_REGISTRATION_DAYS = 30;
export const SERVICE_INTERVAL_MONTHS = 12;

/* ------------------------------------------------------------------ */
/* Date + money formatting (hand-rolled, runtime-stable)              */
/* ------------------------------------------------------------------ */

// ICU data differs between runtimes, and event labels must come out
// identical wherever the reducer runs (server, browser, tests).
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * Working days from the survey to the proposal, as promised to customers:
 * the reducer's survey-submitted update, the timeline estimate, the
 * survey-complete email and the hub all use this one number. Drafting the
 * design from the measured survey is automatic; the technical lead's sign-off
 * and the proposal builder fit comfortably inside it.
 */
export const PROPOSAL_TURNAROUND_WORKING_DAYS = 3;

const dateOf = (iso: string) => iso.slice(0, 10);

const fmtDate = (iso: string) => {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
};

// Slot datetimes are UK wall-clock encoded as UTC; format in UTC to round-trip.
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(iso)}, ${hh}:${mm}`;
};

const fmtRange = (dates: string[]) => {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return "";
  return first === last ? fmtDate(first) : `${fmtDate(first)} to ${fmtDate(last)}`;
};

/** 123456 → "£1,234.56"; 120000 → "£1,200". */
const fmtPence = (pence: number) => {
  const abs = Math.abs(Math.round(pence));
  const pounds = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const p = abs % 100;
  return `${pence < 0 ? "-" : ""}£${pounds}${p ? `.${String(p).padStart(2, "0")}` : ""}`;
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Working days (weekdays in settings, less England and Wales bank holidays) come from working-days.ts.

/**
 * The day we told the customer their proposal would be with them (the
 * survey-complete email, the hub): PROPOSAL_TURNAROUND_WORKING_DAYS after the
 * survey was submitted. Null before the survey.
 */
export function proposalPromisedBy(project: Pick<Project, "survey">): string | null {
  const at = project.survey.submittedAt;
  return at ? addWorkingDays(dateOf(at), PROPOSAL_TURNAROUND_WORKING_DAYS) : null;
}

/**
 * The promised day has gone (today is after it) and the first proposal still
 * isn't issued. A revision after a change request carries no promised date.
 */
export function proposalOverdue(project: Pick<Project, "survey" | "proposal" | "closure">, todayIso: string): boolean {
  const by = proposalPromisedBy(project);
  return Boolean(by && !project.closure.closed && project.proposal.status === "not-issued" && dateOf(todayIso) > by);
}

/** Calendar months, clamped: 31 Jan + 1 month = 28 Feb (29 in a leap year). */
function addMonths(iso: string, months: number): string {
  const [y, m, day] = dateOf(iso).split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

const laterOf = (a: string, b: string) => (a >= b ? a : b);

/* ------------------------------------------------------------------ */
/* Creation                                                           */
/* ------------------------------------------------------------------ */

const ELECTRICS_ASSESSMENT: Record<ElectricsCondition, { status: ElectricsPlanStatus; summary: string }> = {
  "modern-spare-ways": {
    status: "provisional",
    summary:
      "Your fuse board has spare ways, so this looks like a simple dedicated circuit. We'll confirm the cable route at your survey.",
  },
  "modern-full": {
    status: "attention",
    summary:
      "Your fuse board is modern but full, so we may need to free up a way or add a small extra box. The survey confirms exactly what's needed, and your proposal prices it.",
  },
  "older-fuse-box": {
    status: "attention",
    summary:
      "You've got an older fuse board. We check it at your survey, and if it needs work your proposal says so and prices it before anything is booked.",
  },
  unsure: {
    status: "provisional",
    summary:
      "We couldn't tell much about your electrics from your answers, so the fuse board is top of the list at your survey.",
  },
};

/** The v1 list, ids unchanged, with the site-visit wording brought up to date. */
export const DEFAULT_PREP_ITEMS: Omit<PrepItem, "done">[] = [
  {
    id: "indoor-space",
    label: "Clear space where each indoor unit goes",
    detail: "About a metre in front of each wall spot on your plan, so we can work and lay dust sheets.",
    confirmable: true,
  },
  {
    id: "outdoor-access",
    label: "Clear the route to the outdoor unit spot",
    detail: "Move bins, planters and anything fragile along the way and around the spot itself.",
    confirmable: true,
  },
  {
    id: "parking",
    label: "Sort parking for one van",
    detail: "As close as you can get us. A permit or a coned space if you're in a controlled zone.",
    confirmable: true,
  },
  {
    id: "pets-kids",
    label: "Plan for pets and kids",
    detail: "Doors will be open and tools about, so a closed room or a day out works best.",
    confirmable: true,
  },
  {
    id: "power-off",
    label: "The power goes off for up to 30 minutes",
    detail: "We switch off the supply while we connect the new circuit in your proposal.",
    confirmable: false,
  },
  {
    id: "adult-home",
    label: "Someone 18+ at home",
    detail: "For letting us in, decisions on the day, and the handover at the end.",
    confirmable: true,
  },
];

export interface CreateProjectInput {
  id: string;
  quoteId: string;
  createdAt: string; // ISO datetime
  customerName: string;
  survey: Survey;
  quote: QuoteResult;
  customerEmail?: string;
  customerPhone?: string;
  customerId?: string;
  /** From settings.scheduling.surveyFeeGbp; 0 (free) when omitted. */
  surveyFeeGbp?: number;
  /** From settings.scheduling.surveyDurationMinutes; 90 when omitted. */
  surveyDurationMinutes?: number;
  /** From settings.scheduling.installBlockDays; 3 when omitted. */
  installDays?: number;
}

/** Every section at its starting state. createProject and migrateProject both build on it. */
function blankProject(id: string, quoteId: string, createdAt: string): Project {
  return {
    schemaVersion: 2,
    id,
    quoteId,
    createdAt,
    customer: { name: "", postcode: "", addressLine: "" },
    quoteSummary: {
      totalGbp: 0,
      installDays: 3,
      roomCount: 0,
      confidenceBand: "low",
      systems: [],
      roomDesigns: [],
    },
    roughPlan: {},
    survey: {
      status: "not-booked",
      mode: "in-person",
      durationMinutes: DEFAULT_SETTINGS.scheduling.surveyDurationMinutes,
      feeGbp: 0,
      paymentStatus: "not-required",
      rescheduleFeesGbp: 0,
    },
    electrics: { ...ELECTRICS_ASSESSMENT.unsure, surveyCondition: "unsure" },
    design: { status: "not-started" },
    proposal: { status: "not-issued", contractType: "supply-and-install" },
    booking: {
      status: "not-booked",
      dates: [],
      installDays: DEFAULT_SETTINGS.scheduling.installBlockDays,
      crew: [],
      depositStatus: "not-required",
      rescheduleFeesGbp: 0,
      prep: DEFAULT_PREP_ITEMS.map((item) => ({ ...item, done: false })),
    },
    kit: { status: "not-ordered", shortages: 0 },
    install: { status: "not-started", days: [] },
    handover: { status: "pending", electricalCert: "pending", warrantyRegistered: false },
    closure: { closed: false },
    aftercare: {},
    money: { invoicedPence: 0, paidPence: 0, changeFeesPence: 0 },
    events: [],
  };
}

/** Seed a v2 project from a saved quote. Nothing is booked, designed or priced beyond the quote. */
export function createProject(input: CreateProjectInput): Project {
  const { survey, quote } = input;
  const archetype = survey.archetypeId ? getArchetype(survey.archetypeId) : undefined;
  const permutation =
    survey.archetypeId && survey.permutationId
      ? getPermutation(survey.archetypeId, survey.permutationId)
      : undefined;
  const floorByRoomId = new Map(survey.rooms.map((r) => [r.id, r.floor]));
  const roomDesigns = quote.systems.flatMap((system) =>
    system.rooms.map((room) => ({
      name: room.roomName,
      floor: floorByRoomId.get(room.roomId) ?? "ground",
      unitLabel: room.unitLabel,
    })),
  );
  const feeGbp = Math.max(0, Math.round(input.surveyFeeGbp ?? 0));

  const p = blankProject(input.id, input.quoteId, input.createdAt);
  p.customer = {
    name: input.customerName,
    postcode: survey.postcode,
    addressLine: survey.addressLine,
    ...(input.customerEmail ? { email: input.customerEmail } : {}),
    ...(input.customerPhone ? { phone: input.customerPhone } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
  };
  p.quoteSummary = {
    totalGbp: quote.totalGbp,
    installDays: quote.installDays,
    roomCount: survey.rooms.length,
    confidenceBand: quote.confidence.band,
    systems: quote.systems.map((s) => s.outdoorLabel),
    roomDesigns,
  };
  p.roughPlan = {
    ...(archetype ? { archetypeName: archetype.name } : {}),
    ...(permutation
      ? { pattern: { label: permutation.label, summary: permutation.summary, pipeRoute: permutation.pipeRoute } }
      : {}),
  };
  p.survey.feeGbp = feeGbp;
  p.survey.paymentStatus = feeGbp > 0 ? "unpaid" : "not-required";
  if (input.surveyDurationMinutes) p.survey.durationMinutes = input.surveyDurationMinutes;
  if (input.installDays) p.booking.installDays = input.installDays;
  p.electrics = { ...ELECTRICS_ASSESSMENT[survey.electrics.condition], surveyCondition: survey.electrics.condition };
  p.events.push({
    at: input.createdAt,
    type: "project-created",
    label: "Your project is set up. Everything from here happens on this timeline.",
    actor: "system",
  });
  return p;
}

/* ------------------------------------------------------------------ */
/* Stage status                                                       */
/* ------------------------------------------------------------------ */

export function isStageComplete(project: Project, stage: ProjectStageId): boolean {
  switch (stage) {
    case "price":
      return project.survey.status !== "not-booked";
    case "survey":
      return project.survey.status === "submitted";
    case "proposal":
      return project.proposal.status === "accepted";
    case "booking":
      return project.booking.status === "booked";
    case "kit":
      return project.kit.status === "delivered" || project.kit.status === "inspected";
    case "install":
      return project.install.status === "complete";
    case "handover":
      return project.handover.status === "handed-over";
    case "aftercare":
      return project.closure.closed;
  }
}

export function currentStage(project: Project): ProjectStageId {
  for (const stage of PROJECT_STAGES) {
    if (!isStageComplete(project, stage)) return stage;
  }
  return "aftercare";
}

export type StageState = "complete" | "current" | "upcoming";

export function stageState(project: Project, stage: ProjectStageId): StageState {
  if (isStageComplete(project, stage)) return "complete";
  return stage === currentStage(project) ? "current" : "upcoming";
}

/* ------------------------------------------------------------------ */
/* Gates + readiness                                                  */
/* ------------------------------------------------------------------ */

export type GateId =
  | "survey-complete"
  | "proposal-issue"
  | "proposal-accept"
  | "booking"
  | "ready-to-install"
  | "install-complete"
  | "commissioned"
  | "handed-over"
  | "closed";

/** In journey order: "gates ≤ ready-to-install" means up to and including it here. */
export const GATE_IDS: GateId[] = [
  "survey-complete",
  "proposal-issue",
  "proposal-accept",
  "booking",
  "ready-to-install",
  "install-complete",
  "commissioned",
  "handed-over",
  "closed",
];

export const GATE_LABEL: Record<GateId, string> = {
  "survey-complete": "Survey complete",
  "proposal-issue": "Proposal ready to issue",
  "proposal-accept": "Proposal accepted",
  booking: "Booking confirmed",
  "ready-to-install": "Ready to install",
  "install-complete": "Install complete",
  commissioned: "Commissioned",
  "handed-over": "Handed over",
  closed: "Closed",
};

/**
 * One thing standing in the way of a gate. `code` is stable for the rule;
 * rules that repeat per item add `:<item>` (`compliance:asbestos`,
 * `issue:<id>`). `warn` never blocks, it just gets said out loud.
 */
export interface Blocker {
  gate: GateId;
  code: string;
  message: string;
  severity: "block" | "warn";
  owner: StaffRole | "customer" | "ops";
  action?: string;
}

export interface ReadinessContext {
  today: string;
  settings: PilotSettings;
  actor?: StaffMember; // the person doing the action (gates that need qualifications)
  surveyCompleteness?: { pct: number; missing: string[] };
  design?: { status: string; approvedBy?: string; compatibilityErrors: string[] };
  proposalCheck?: {
    belowMinMargin: boolean;
    marginOverride: boolean;
    taxConfirmed: boolean;
    taxOverride: boolean;
    expired: boolean;
    /** Cost lines with no price, across the options: the margin can't be checked (fails closed). */
    unpricedCostLines?: number;
  };
  /**
   * The payment schedule the customer agreed (the accepted proposal's frozen
   * terms, or the contract document's), when there's a contract. The booking
   * gate reads the deposit from it, never from a settings change made after.
   */
  agreedPayments?: Pick<PilotSettings["payments"], "depositPct" | "depositTiming" | "balanceDueDays">;
  compliance: { key: string; label: string; status: ComplianceStatus; statutory: boolean; gate: GateId }[];
  crew: StaffMember[]; // full records of booking.crew
  kit?: { requiredLines: number; deliveredLines: number; inspectedLines: number; damaged: number };
  openIssues: { id: string; title: string; kind: string; severity: string; blocking: boolean; gate?: GateId }[];
  runsheet?: { complete: boolean; openExceptions: number; missing: number; blocked: number; walkthroughDone: boolean };
  commissioning?: { signed: boolean; signedBy?: string };
  /**
   * Invoices and payments, reconciled. `unbilledPence` is what's agreed but
   * on no invoice yet (the balance, accepted variations, change fees):
   * money's stillToBillPence.
   */
  money?: { depositDuePence: number; depositPaidPence: number; outstandingPence: number; unbilledPence: number };
}

const gateIndex = (g: GateId) => GATE_IDS.indexOf(g);

const COMPLIANCE_STATUS_LABEL: Record<ComplianceStatus, string> = {
  "not-started": "not started",
  "evidence-required": "evidence needed",
  "under-review": "waiting for review",
  approved: "approved",
  rejected: "rejected",
  "not-applicable": "not applicable",
};

/** Has the project's own state moved past this gate? Passed gates are history, not blockers. */
export function isGatePassed(project: Project, gate: GateId): boolean {
  switch (gate) {
    case "survey-complete":
      return project.survey.status === "submitted";
    case "proposal-issue":
      return project.proposal.status === "issued" || project.proposal.status === "accepted";
    case "proposal-accept":
      return project.proposal.status === "accepted";
    case "booking":
      return project.booking.status === "booked";
    case "ready-to-install":
      return project.install.status !== "not-started";
    case "install-complete":
      return project.install.status === "complete";
    case "commissioned":
      return project.handover.status !== "pending";
    case "handed-over":
      return project.handover.status === "handed-over";
    case "closed":
      return project.closure.closed;
  }
}

/**
 * Has the contract's deposit been paid? Recorded as paid on the booking, or
 * verified payments on deposit invoices covering what the contract asked.
 */
export function depositIsPaid(p: Pick<Project, "booking">, ctx: Pick<ReadinessContext, "money">): boolean {
  return (
    p.booking.depositStatus === "paid" ||
    (ctx.money !== undefined && ctx.money.depositDuePence > 0 && ctx.money.depositPaidPence >= ctx.money.depositDuePence)
  );
}

/**
 * The contract takes the deposit "before we order your equipment"
 * (depositTiming "before-kit-order"): until it's paid, nothing is ordered
 * from a supplier. Null when ordering is fine; otherwise why not. An admin
 * can still order, with a reason (purchasing-server advanceOrder).
 */
export function kitOrderDepositProblem(p: Pick<Project, "booking">, ctx: Pick<ReadinessContext, "money" | "agreedPayments" | "settings">): string | null {
  const pay = ctx.agreedPayments ?? ctx.settings.payments;
  if (!(pay.depositPct > 0) || pay.depositTiming !== "before-kit-order") return null;
  if (depositIsPaid(p, ctx)) return null;
  return "The contract takes the deposit before we order the equipment, and it hasn't been paid yet.";
}

/** The next gate the project has to clear, or null once closed. */
export function nextGate(project: Project): GateId | null {
  if (project.closure.closed) return null;
  return GATE_IDS.find((g) => !isGatePassed(project, g)) ?? null;
}

/** Blockers for every gate the project hasn't passed yet, in journey order. */
export function readiness(project: Project, ctx: ReadinessContext): Blocker[] {
  if (project.closure.closed) return [];
  return GATE_IDS.filter((g) => !isGatePassed(project, g)).flatMap((g) => blockersFor(project, ctx, g));
}

/** Everything standing between the project and one gate, block and warn. */
export function blockersFor(project: Project, ctx: ReadinessContext, gate: GateId): Blocker[] {
  const out: Blocker[] = [];
  const add = (severity: Blocker["severity"], code: string, message: string, owner: Blocker["owner"], action?: string) =>
    out.push({ gate, code, message, severity, owner, ...(action ? { action } : {}) });
  const block = (code: string, message: string, owner: Blocker["owner"], action?: string) =>
    add("block", code, message, owner, action);
  const warn = (code: string, message: string, owner: Blocker["owner"], action?: string) =>
    add("warn", code, message, owner, action);

  const p = project;
  const s = ctx.settings;
  const today = dateOf(ctx.today);

  // Compliance items for this gate. Ready-to-install also sweeps up every
  // earlier gate's items: nothing gets drilled until the paperwork is right.
  const complianceFor = (inclusiveOfEarlier: boolean) => {
    for (const item of ctx.compliance) {
      const idx = gateIndex(item.gate);
      const applies = inclusiveOfEarlier ? idx <= gateIndex(gate) : item.gate === gate;
      if (!applies || item.status === "approved" || item.status === "not-applicable") continue;
      const message = `${item.label}: ${COMPLIANCE_STATUS_LABEL[item.status]}.`;
      if (item.statutory) block(`compliance:${item.key}`, message, "tech-lead", "Review the compliance item");
      else warn(`compliance:${item.key}`, message, "tech-lead", "Review the compliance item");
    }
  };

  // An open blocking issue holds its gate (untagged: ready-to-install) and
  // every gate after it until it's resolved.
  const issues = () => {
    for (const issue of ctx.openIssues) {
      const holds = issue.blocking && gateIndex(issue.gate ?? "ready-to-install") <= gateIndex(gate);
      const serious = gate === "closed" && (issue.severity === "high" || issue.severity === "critical");
      if (holds || serious) {
        block(`issue:${issue.id}`, `Open ${issue.severity} issue: ${issue.title}`, "ops", "Resolve the issue");
      } else if (gate === "closed") {
        // Closing doesn't wait for a small one, but nobody should close a project without seeing it.
        warn(`issue:${issue.id}`, `Open ${issue.severity} issue: ${issue.title}. It stays open after the project closes.`, "ops", "Resolve the issue");
      }
    }
  };

  switch (gate) {
    case "survey-complete": {
      if (p.survey.status === "not-booked") {
        block("survey-not-booked", "The home survey isn't booked yet.", "customer", "Book your home survey");
      }
      // A family can book their own slot from their page: nobody is on it until the office says so.
      if (p.survey.status === "booked" && !p.survey.surveyor) {
        block("survey-no-surveyor", "The home survey is booked but nobody is down to do it.", "ops", "Assign a surveyor");
      }
      if (!ctx.surveyCompleteness) {
        block("survey-not-started", "There's no survey record yet.", "surveyor", "Start the survey");
      } else {
        ctx.surveyCompleteness.missing.forEach((item, i) =>
          block(`survey-missing:${i + 1}`, `Survey: ${item}`, "surveyor", "Complete the survey"),
        );
      }
      break;
    }

    case "proposal-issue": {
      const pc = ctx.proposalCheck;
      if (p.survey.status !== "submitted") {
        block("survey-not-submitted", "The survey hasn't been submitted yet.", "surveyor", "Submit the survey");
      }
      const designStatus = ctx.design?.status ?? p.design.status;
      if (s.pricing.requireEngineerSignoff && designStatus !== "approved") {
        block("design-not-approved", "The design needs a technical lead's sign-off.", "tech-lead", "Review and approve the design");
      }
      (ctx.design?.compatibilityErrors ?? []).forEach((e, i) =>
        block(`design-compatibility:${i + 1}`, `Design: ${e}`, "tech-lead", "Fix the equipment combination"),
      );
      const taxOk = !s.tax.vatRegistered || s.tax.accountantConfirmed || Boolean(pc?.taxConfirmed) || Boolean(pc?.taxOverride);
      if (!taxOk) {
        block(
          "tax-unconfirmed",
          "The VAT treatment hasn't been confirmed by the accountant.",
          "admin",
          "Confirm the tax code, or record an admin override with a reason",
        );
      }
      // The issue email is the durable medium for the pre-contract information
      // (CCR reg 10): by email only with the customer's agreement, and only
      // when every Schedule 2 item from settings is there to put in it.
      if (!p.proposal.documentsByEmailConsent) {
        block(
          "documents-consent-missing",
          "The customer hasn't agreed to get the contract documents by email. The pilot can't send them on paper, so the proposal can't go until they do.",
          "customer",
          "Get in touch: ask if they're happy to get documents by email, and record it if they are",
        );
      } else if (!documentsConsentCovers(p)) {
        block(
          "documents-consent-missing",
          `The customer agreed to get documents by email at ${p.proposal.documentsByEmailConsent.email}, not at ${p.customer.email}.`,
          "customer",
          "Ask the customer to confirm they're happy to get documents at their new address",
        );
      }
      if (!p.customer.email?.trim()) {
        block(
          "no-customer-email",
          "There's no email address for the customer, so the pre-contract information can't be sent.",
          "ops",
          "Add the customer's email address",
        );
      }
      const missing = schedule2Missing(s);
      if (missing.length) {
        block(
          "schedule2-incomplete",
          `The pre-contract information is missing from settings: ${missing.join(", ")}.`,
          "admin",
          "Fill in the company details in settings",
        );
      }
      if (!pc) {
        block("proposal-not-drafted", "There's no proposal draft to issue yet.", "ops", "Build the proposal");
      } else {
        if (pc.belowMinMargin && !pc.marginOverride) {
          block(
            "margin-below-minimum",
            `The margin is below the ${s.pricing.minMarginPct}% minimum.`,
            "admin",
            "Adjust the price, or record an admin override with a reason",
          );
        } else if ((pc.unpricedCostLines ?? 0) > 0 && !pc.marginOverride) {
          // The margin on the priced lines alone overstates the real one: fail closed.
          const n = pc.unpricedCostLines!;
          block(
            "costs-unpriced",
            `${n} cost line${n === 1 ? " has" : "s have"} no price, so the ${s.pricing.minMarginPct}% minimum margin can't be checked.`,
            "ops",
            "Enter the missing costs in the proposal builder, or an admin records an override with a reason",
          );
        }
        if (pc.expired) {
          block("validity-passed", "The proposal's valid-until date has already passed.", "ops", "Set a new valid-until date");
        }
      }
      if (!s.legal.termsReviewed || !s.legal.cancellationReviewed) {
        warn(
          "terms-unreviewed",
          `The terms (${s.legal.termsVersion}) and cancellation wording haven't had legal review yet.`,
          "admin",
          "Get the terms reviewed",
        );
      }
      break;
    }

    case "proposal-accept": {
      const issued = p.proposal.status === "issued" || p.proposal.status === "changes-requested";
      const lapsed = (p.proposal.validUntil !== undefined && dateOf(p.proposal.validUntil) < today) || Boolean(ctx.proposalCheck?.expired);
      if (!issued) {
        block("proposal-not-issued", "There's no issued proposal to accept.", "ops", "Issue the proposal");
      } else if (!p.proposal.preContractInfoSentAt) {
        // Schedule 2 information, the cancellation instructions and the
        // model form must reach the customer on a durable medium before the
        // contract (CCR regs 10 and 12): the outbox records it once the
        // issue email has gone (to the project's current address).
        block(
          "pre-contract-info-not-sent",
          "The proposal email (the pre-contract information and cancellation form) hasn't been delivered yet, so it can't be accepted.",
          "ops",
          "Check the proposal email in messages and resend it",
        );
      } else if (!documentsConsentCovers(p)) {
        // The durable medium is their email only with their agreement for that address (reg 10(2)).
        block(
          "documents-consent-missing",
          p.proposal.documentsByEmailConsent?.email
            ? `The customer agreed to get documents by email at ${p.proposal.documentsByEmailConsent.email}, not at ${p.customer.email}.`
            : "The customer hasn't agreed to get the contract documents by email.",
          "customer",
          "Confirm you're happy to get your documents by email at your current address",
        );
      } else if (lapsed) {
        block(
          "proposal-expired",
          p.proposal.validUntil
            ? `This proposal was valid until ${fmtDate(p.proposal.validUntil)}.`
            : "This proposal has expired.",
          "ops",
          "Issue a fresh proposal",
        );
      }
      break;
    }

    case "booking": {
      if (p.proposal.status !== "accepted") {
        block("proposal-not-accepted", "The proposal hasn't been accepted yet.", "customer", "Review your proposal");
      }
      if (!ctx.crew.some((m) => meetsRequirement(m, "fgas", today))) {
        block(
          "no-fgas-engineer",
          "Nobody on the crew holds a current F-gas certificate.",
          "ops",
          "Assign an F-gas certified engineer",
        );
      }
      if (!ctx.crew.some((m) => meetsRequirement(m, "electrical", today))) {
        block("no-electrician", "Nobody on the crew is a Part P registered electrician.", "ops", "Assign a Part P electrician");
      }
      if (!ctx.crew.some((m) => meetsRequirement(m, "tech-lead", today))) {
        warn("no-tech-lead", "Nobody on the crew can sign off commissioning.", "ops", "Assign a technical lead");
      }
      // The deposit the contract says, not today's settings.
      const pay = ctx.agreedPayments ?? s.payments;
      const depositRequired = pay.depositPct > 0 && pay.depositTiming === "on-acceptance";
      if (depositRequired && !depositIsPaid(p, ctx)) {
        block("deposit-unpaid", "The deposit hasn't been paid yet.", "customer", "Pay your deposit");
      }
      const start = p.booking.startDate;
      if (!start || p.booking.dates.length !== p.booking.installDays) {
        block("dates-not-chosen", "Install dates haven't been chosen yet.", "customer", "Choose your install dates");
      } else if (!earlyStartRequestedOf(p)) {
        const cs = cancellationStatus(p, today, s);
        const days = s.scheduling.cancellationDays;
        if (cs.endsOn && start <= cs.endsOn) {
          block(
            "dates-inside-cancellation",
            `Install would start ${fmtDate(start)}, inside the cancellation period (ends ${fmtDate(cs.endsOn)}), and no early start was requested.`,
            "ops",
            "Move the dates",
          );
        } else if (!cs.endsOn && cs.basis === "goods-delivery") {
          warn(
            "no-early-start",
            `No early start was requested, so the install can only start once ${days} days have passed after the kit is delivered: it needs to arrive by ${fmtDate(addDays(start, -(days + 1)))}.`,
            "ops",
            "Get the kit delivered early enough, or ask the customer whether they want to start sooner",
          );
        }
      }
      break;
    }

    case "ready-to-install": {
      if (p.booking.status !== "booked") {
        block("booking-not-confirmed", "The booking isn't confirmed yet.", "ops", "Confirm the booking");
      }
      // Whichever the timing (on acceptance, or before the kit is ordered), an agreed deposit is paid before we drill.
      const agreed = ctx.agreedPayments ?? s.payments;
      if (agreed.depositPct > 0 && !depositIsPaid(p, ctx)) {
        block("deposit-unpaid", "The deposit the contract asks for hasn't been paid yet.", "customer", "Pay your deposit");
      }
      const kit = ctx.kit;
      if (!kit || kit.requiredLines <= 0) {
        block("kit-not-planned", "No kit has been planned for this job.", "ops", "Raise purchase orders from the design");
      } else {
        if (kit.deliveredLines < kit.requiredLines) {
          block("kit-not-delivered", `${kit.deliveredLines} of ${kit.requiredLines} kit lines delivered.`, "ops", "Chase the supplier");
        } else if (kit.inspectedLines < kit.requiredLines) {
          warn("kit-not-inspected", `${kit.inspectedLines} of ${kit.requiredLines} kit lines checked.`, "installer", "Check the kit against the design");
        }
        if (kit.damaged > 0) {
          warn("kit-damaged", `${kit.damaged} kit item${kit.damaged === 1 ? "" : "s"} recorded as damaged.`, "ops", "Raise an issue and arrange a replacement");
        }
      }
      if (ctx.compliance.length === 0) {
        block("compliance-missing", "The compliance checklist hasn't been set up.", "ops", "Create the compliance checklist");
      }
      complianceFor(true);
      // The customer's copy of the contract must reach them before work
      // begins (reg 12(4)); the outbox records it once the email has gone.
      if (!p.proposal.confirmationSentAt) {
        block(
          "confirmation-not-sent",
          "The contract confirmation (the customer's durable copy) hasn't been sent. It must reach them before work starts.",
          "ops",
          "Check the confirmation email in messages and resend it",
        );
      }
      // The cancellation period includes its last day: work starts the day
      // after, or inside it only on an express request on a durable medium
      // (reg 36(1)). Legal review required: see cancellationStatus.
      const cs = cancellationStatus(p, today, s);
      if (!cs.ended && !cs.earlyStartEvidenced) {
        const days = s.scheduling.cancellationDays;
        const runs = cs.endsOn
          ? `runs until the end of ${fmtDate(cs.endsOn)}`
          : p.kit.deliveredTo === "elsewhere"
            ? `hasn't started: the kit went to our storage or the installer, so it reaches the customer with the crew on day 1 and the ${days} days run from then`
            : `runs until ${days} days after the kit is delivered to the customer`;
        if (cs.basis === "unknown") {
          block("cancellation-unknown", "The cancellation period can't be worked out: there's no accepted contract on record.", "ops", "Check the acceptance record");
        } else if (earlyStartRequestedOf(p)) {
          block(
            "early-start-unevidenced",
            `The cancellation period ${runs}. The customer ticked "start early", but that request isn't on a durable medium yet: record their email reply with the early-start wording, or a signed form.`,
            "ops",
            "Record the customer's early-start email or signed form",
          );
        } else {
          block(
            "cancellation-period",
            `The cancellation period ${runs}, and the customer hasn't asked to start early. Work can start the day after it ends, or sooner only on their request by email or signed form.`,
            "ops",
            "Wait for the period to end",
          );
        }
      }
      break;
    }

    case "install-complete": {
      if (p.install.status === "not-started") {
        block("install-not-started", "The install hasn't started.", "installer", "Start day 1");
      }
      const rs = ctx.runsheet;
      if (!rs) {
        block("runsheet-missing", "There's no runsheet for this job yet.", "ops", "Generate the runsheet from the design");
      } else {
        // A step held only by an out-of-range reading is the exception below, not also "missing".
        if (!rs.complete && (rs.missing > 0 || rs.blocked > 0 || rs.openExceptions === 0)) {
          block(
            "runsheet-incomplete",
            `The runsheet isn't finished: ${rs.missing} missing, ${rs.blocked} blocked.`,
            "installer",
            "Finish the remaining steps",
          );
        }
        if (rs.openExceptions > 0) {
          block(
            "exceptions-open",
            `${rs.openExceptions} exception${rs.openExceptions === 1 ? "" : "s"} waiting for the technical lead.`,
            "tech-lead",
            "Review the exceptions",
          );
        }
      }
      complianceFor(false);
      break;
    }

    case "commissioned": {
      if (p.install.status !== "complete") {
        block("install-not-complete", "The install isn't complete.", "installer", "Complete the install");
      }
      if (!ctx.commissioning?.signed) {
        block("commissioning-unsigned", "Commissioning hasn't been signed off.", "tech-lead", "Record and sign the commissioning results");
      }
      complianceFor(false);
      break;
    }

    case "handed-over": {
      if (p.handover.status === "pending") {
        block("not-commissioned", "The system hasn't been commissioned.", "tech-lead", "Sign off commissioning");
      }
      if (!p.handover.packDocumentId) {
        block("pack-not-published", "The handover pack isn't published.", "ops", "Publish the handover pack");
      }
      if (!p.handover.signoff) {
        block("signoff-missing", "The customer hasn't signed off the handover.", "customer", "Sign off your handover");
      }
      if (!ctx.runsheet?.walkthroughDone) {
        block("walkthrough-not-done", "The customer walkthrough isn't done.", "installer", "Walk the customer through the system");
      }
      complianceFor(false);
      break;
    }

    case "closed": {
      if (p.handover.status !== "handed-over") {
        block("not-handed-over", "The handover isn't signed off.", "installer", "Complete the handover");
      }
      if (!ctx.money) {
        block("money-unknown", "Invoices and payments haven't been reconciled.", "ops", "Check invoices and payments");
      } else {
        // Nothing agreed is left off an invoice: a job with nothing invoiced owes "nothing" until it's billed.
        if (ctx.money.unbilledPence > 0) {
          block(
            "balance-not-invoiced",
            `${fmtPence(ctx.money.unbilledPence)} of the agreed price isn't on an invoice yet (the balance, accepted variations or date change fees).`,
            "ops",
            "Issue the balance invoice",
          );
        }
        if (ctx.money.outstandingPence > 0) {
          block("balance-outstanding", `${fmtPence(ctx.money.outstandingPence)} is still outstanding.`, "customer", "Pay your balance");
        } else if (ctx.money.outstandingPence < 0) {
          warn(
            "customer-in-credit",
            `The customer is ${fmtPence(-ctx.money.outstandingPence)} in credit: refund it from the money page, or note why it stays.`,
            "ops",
            "Refund the credit",
          );
        }
      }
      if (p.handover.electricalCert === "pending") {
        block("electrical-cert-pending", "The electrical installation certificate hasn't arrived.", "electrician", "Upload the certificate");
      }
      if (!p.handover.warrantyRegistered) {
        block("warranty-not-registered", "The manufacturer warranty isn't registered.", "ops", "Register the warranty");
      }
      complianceFor(false);
      break;
    }
  }

  issues();
  return out;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                           */
/* ------------------------------------------------------------------ */

export interface TimelineEntry {
  stage: ProjectStageId;
  state: StageState;
  date?: { kind: TimelineDateKind; iso: string };
}

/**
 * The dates on the timeline: actuals where a step happened, confirmed where
 * a date is booked, estimates everywhere else (never in the past), so the
 * future always shows projected dates, like a project plan.
 */
export function projectTimeline(project: Project, todayIso: string): TimelineEntry[] {
  const p = project;
  const today = dateOf(todayIso);
  const est = (iso: string) => laterOf(dateOf(iso), today);
  const dates: Partial<Record<ProjectStageId, TimelineEntry["date"]>> = {};

  dates.price = { kind: "actual", iso: p.createdAt };

  // Survey: the visit itself.
  const surveyEst = addWorkingDays(today, 5);
  if (p.survey.status === "submitted") {
    const at = p.survey.submittedAt ?? p.survey.scheduledFor;
    if (at) dates.survey = { kind: "actual", iso: at };
  } else if (p.survey.scheduledFor) {
    dates.survey = { kind: "confirmed", iso: p.survey.scheduledFor };
  } else {
    dates.survey = { kind: "estimated", iso: surveyEst };
  }
  const surveyBase =
    p.survey.status === "submitted"
      ? dateOf(p.survey.submittedAt ?? p.survey.scheduledFor ?? today)
      : est(p.survey.scheduledFor ?? surveyEst);

  // Proposal: lands on acceptance.
  const issuedOn = p.proposal.issuedAt && p.proposal.status !== "accepted" ? est(p.proposal.issuedAt) : undefined;
  const acceptance = p.proposal.acceptedAt
    ? dateOf(p.proposal.acceptedAt)
    : (issuedOn ?? est(addWorkingDays(surveyBase, PROPOSAL_TURNAROUND_WORKING_DAYS)));
  dates.proposal = p.proposal.acceptedAt
    ? { kind: "actual", iso: p.proposal.acceptedAt }
    : { kind: "estimated", iso: acceptance };

  // Booking: confirmation day.
  const bookingEst = est(addWorkingDays(acceptance, 2));
  if (p.booking.status === "booked") {
    const ev = [...p.events].reverse().find((e) => e.type === "booking-confirmed" || e.type === "installation-booked");
    dates.booking = ev ? { kind: "actual", iso: ev.at } : undefined;
  } else {
    dates.booking = { kind: "estimated", iso: bookingEst };
  }

  // Install: booked dates, else after the cancellation period (or a week on
  // an early-start request), never inside the crew lead time. Before the
  // period's end is known (supply-and-install before delivery), assume it
  // runs from acceptance: an estimate, never a promise.
  let installStart = p.booking.startDate;
  if (!installStart) {
    const coolingOffEnds =
      cancellationStatus(p, today).endsOn ?? addDays(acceptance, DEFAULT_SETTINGS.scheduling.cancellationDays);
    const earliest = earlyStartRequestedOf(p)
      ? addDays(acceptance, 7)
      : laterOf(addDays(acceptance, 7), addDays(coolingOffEnds, 1));
    installStart = nextWorkingDay(laterOf(est(earliest), addDays(today, INSTALL_LEAD_DAYS)));
  }
  if (p.install.completedAt) {
    dates.install = { kind: "actual", iso: p.install.completedAt };
  } else if (p.install.startedAt) {
    // Under way: the day it really started (a crew can start early), not the booked one.
    dates.install = { kind: "actual", iso: p.install.startedAt };
  } else if (p.booking.startDate) {
    dates.install = { kind: p.booking.status === "booked" ? "confirmed" : "estimated", iso: p.booking.startDate };
  } else {
    dates.install = { kind: "estimated", iso: installStart };
  }

  // Kit: lands before install. "Confirmed" only once the supplier has said so.
  const kitArrived = p.kit.deliveredAt ?? p.kit.inspectedAt;
  if ((p.kit.status === "delivered" || p.kit.status === "inspected") && kitArrived) {
    dates.kit = { kind: "actual", iso: kitArrived };
  } else if (p.kit.expectedDate && (p.kit.status === "confirmed" || p.kit.status === "dispatched")) {
    dates.kit = { kind: "confirmed", iso: p.kit.expectedDate };
  } else {
    dates.kit = { kind: "estimated", iso: est(p.kit.expectedDate ?? addWorkingDays(installStart, -2)) };
  }

  // Handover: the last install day. Always an estimate until it happens.
  const lastPlanned =
    p.install.days[p.install.days.length - 1]?.date ??
    p.booking.dates[p.booking.dates.length - 1] ??
    addWorkingDays(installStart, Math.max(0, p.booking.installDays - 1));
  const handoverOn = p.handover.handedOverAt ? dateOf(p.handover.handedOverAt) : est(lastPlanned);
  dates.handover = p.handover.handedOverAt
    ? { kind: "actual", iso: p.handover.handedOverAt }
    : { kind: "estimated", iso: handoverOn };

  // Aftercare: the 7-day check-in, until the project closes.
  dates.aftercare = p.closure.closedAt
    ? { kind: "actual", iso: p.closure.closedAt }
    : { kind: "estimated", iso: est(addDays(handoverOn, 7)) };

  return PROJECT_STAGES.map((stage) => ({ stage, state: stageState(p, stage), date: dates[stage] }));
}

/* ------------------------------------------------------------------ */
/* Migration                                                          */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const ELECTRICS_STATUSES = ["provisional", "attention", "validated"] as const;
const ELECTRICS_CONDITIONS = ["modern-spare-ways", "modern-full", "older-fuse-box", "unsure"] as const;
const CONFIDENCE_BANDS = ["high", "medium", "low"] as const;
const V1_KEYS = ["floorPlan", "finalQuote", "siteVisit", "delivery", "installation"];
const V2_SECTIONS = [
  "customer",
  "quoteSummary",
  "roughPlan",
  "survey",
  "electrics",
  "design",
  "proposal",
  "booking",
  "kit",
  "install",
  "handover",
  "closure",
  "aftercare",
  "money",
] as const;

function validEvents(v: unknown): ProjectEvent[] {
  return list<unknown>(v)
    .map(rec)
    .filter((e) => typeof e.at === "string" && typeof e.type === "string")
    .map((e) => ({ ...(e as unknown as ProjectEvent), label: str(e.label), actor: oneOf(e.actor, ["customer", "ops", "field", "system"], "system") }));
}

/** `n` working days from `start` (inclusive), for v1 bookings that only stored a start date. */
function consecutiveWorkingDays(start: string, n: number): string[] {
  const out: string[] = [];
  let d = nextWorkingDay(start);
  while (out.length < n) {
    out.push(d);
    d = addWorkingDays(d, 1);
  }
  return out;
}

/** A v2 snapshot with any missing section or array filled from the blank state. */
function normaliseV2(raw: Rec): Project {
  const blank = blankProject(str(raw.id), str(raw.quoteId), str(raw.createdAt));
  const out: Rec = { ...clone(raw), schemaVersion: 2, id: blank.id, quoteId: blank.quoteId, createdAt: blank.createdAt };
  for (const key of V2_SECTIONS) out[key] = { ...(blank[key] as object), ...clone(rec(raw[key])) };
  const p = out as unknown as Project;
  p.quoteSummary.systems = list(p.quoteSummary.systems);
  p.quoteSummary.roomDesigns = list(p.quoteSummary.roomDesigns);
  p.booking.dates = list(p.booking.dates);
  p.booking.crew = list(p.booking.crew);
  p.booking.prep = Array.isArray(rec(raw.booking).prep) ? list(p.booking.prep) : blank.booking.prep;
  p.install.days = list(p.install.days);
  p.proposal.contractType = oneOf(p.proposal.contractType, CONTRACT_TYPES, "supply-and-install");
  p.events = validEvents(raw.events);
  return p;
}

/**
 * v1 → v2. The mapping is literal: nothing becomes "paid", "approved" or
 * "designed" that v1 didn't record. Reschedule fees (including v1 delivery
 * fees) carry over so the balance doesn't change.
 *
 * v1's "final quote" was the instant price, issued automatically and accepted
 * with a click, and the old site told customers accepting it didn't tie them
 * in: no proposal, Schedule 2 information or cancellation form was ever sent.
 * So it becomes a v2 contract only once work really went ahead on it (the kit
 * dispatched or delivered, or the installation finished: `committed`).
 * Before that, the project starts again at the price stage's v2 steps: the
 * proposal is not issued, a v1 install date isn't a booking, and a v1 site
 * visit (which left no survey record to design from) isn't a survey; an
 * internal note says what the old system had, for the office (§K43).
 */
function fromV1(raw: Rec): Project {
  const customer = rec(raw.customer);
  const qs = rec(raw.quoteSummary);
  const fp = rec(raw.floorPlan);
  const fq = rec(raw.finalQuote);
  const sv = rec(raw.siteVisit);
  const el = rec(raw.electrics);
  const dl = rec(raw.delivery);
  const inst = rec(raw.installation);
  const events = validEvents(raw.events);
  const lastEvent = (type: string) => [...events].reverse().find((e) => e.type === type)?.at;
  const notes: Array<[type: string, label: string]> = [];
  const instStatus = oneOf(inst.status, ["not-booked", "booked", "completed"], "not-booked");
  const dlStatus = oneOf(dl.status, ["pending", "scheduled", "dispatched", "delivered"], "pending");
  const committed = dlStatus === "dispatched" || dlStatus === "delivered" || instStatus === "completed";

  const p = blankProject(str(raw.id), str(raw.quoteId), str(raw.createdAt));
  p.customer = { name: str(customer.name), postcode: str(customer.postcode), addressLine: str(customer.addressLine) };
  p.quoteSummary = {
    totalGbp: num(qs.totalGbp, 0),
    installDays: num(qs.installDays, 1),
    roomCount: num(qs.roomCount, 0),
    confidenceBand: oneOf(qs.confidenceBand, CONFIDENCE_BANDS, "low"),
    systems: list(qs.systems),
    roomDesigns: list(qs.roomDesigns),
  };
  const pattern = rec(fp.pattern);
  p.roughPlan = {
    ...(optStr(fp.archetypeName) ? { archetypeName: str(fp.archetypeName) } : {}),
    ...(optStr(pattern.label)
      ? { pattern: { label: str(pattern.label), summary: str(pattern.summary), pipeRoute: str(pattern.pipeRoute) } }
      : {}),
  };

  // Site visit → survey. An unbooked v1 visit defaulted to video; v2's default
  // is the in-person home survey, so only a booked visit keeps its mode.
  // An unbooked visit was never agreed, so it takes the v2 terms (free) rather
  // than v1's default fee; a booked one keeps its fee and payment as-is.
  const svStatus = oneOf(sv.status, ["not-booked", "booked", "completed"], "not-booked");
  const agreed = svStatus !== "not-booked";
  const feeGbp = agreed ? num(sv.feeGbp, 0) : 0;
  const scheduledFor = optStr(sv.scheduledFor);
  const v1Paid = agreed && sv.paymentStatus === "paid";
  const visitedAt = svStatus === "completed" ? (lastEvent("site-visit-completed") ?? scheduledFor) : undefined;
  // A v1 site visit left no survey record, so before any work went ahead the
  // home survey is still to do (its fee and payment stay, as agreed).
  const resurvey = svStatus === "completed" && !committed;
  p.survey = {
    status: svStatus === "completed" && !resurvey ? "submitted" : svStatus === "booked" && scheduledFor ? "booked" : "not-booked",
    mode: agreed && !resurvey ? oneOf(sv.mode, ["video", "in-person"], "video") : "in-person",
    durationMinutes: agreed && !resurvey ? 60 : p.survey.durationMinutes,
    feeGbp,
    paymentStatus: v1Paid ? "paid" : feeGbp > 0 ? "unpaid" : "not-required",
    rescheduleFeesGbp: num(sv.rescheduleFeesGbp, 0),
    ...(scheduledFor && !resurvey ? { scheduledFor } : {}),
  };
  if (svStatus === "completed" && !resurvey && visitedAt) p.survey.submittedAt = visitedAt;

  const condition = oneOf(el.surveyCondition, ELECTRICS_CONDITIONS, "unsure");
  p.electrics = {
    status: oneOf(el.status, ELECTRICS_STATUSES, ELECTRICS_ASSESSMENT[condition].status),
    summary: str(el.summary, ELECTRICS_ASSESSMENT[condition].summary),
    surveyCondition: condition,
  };

  // Final quote → proposal (no proposal record behind it, so no proposalId).
  const fqStatus = oneOf(fq.status, ["pending", "issued", "accepted"], "pending");
  const issuedAt = optStr(fq.issuedAt);
  const acceptedAt = optStr(fq.acceptedAt);
  // v1 always supplied the kit, so every v1 contract is supply-and-install:
  // its cancellation period runs from delivery (set below with the kit), and
  // v1 never sent pre-contract information on a durable medium, so
  // cancellationStatus applies reg 31 to it.
  const finalTotalPence = Math.round(num(fq.totalGbp, p.quoteSummary.totalGbp) * 100);
  if (fqStatus !== "pending" && !committed) {
    // Not a proposal and not a contract here (see above): the office surveys,
    // designs and issues a real proposal, so the proposal stays not issued.
    const when = fqStatus === "accepted" ? acceptedAt : issuedAt;
    notes.push([
      "migrated-final-quote",
      fqStatus === "accepted"
        ? `Moved from the old system: the customer accepted its instant final quote (${fmtPence(finalTotalPence)})${when ? ` on ${fmtDateFull(when)}` : ""}. The old site told them that didn't tie them in, and no proposal, contract or cancellation information was ever sent, so it isn't a contract here. Survey, design and send a proposal as usual.`
        : `Moved from the old system: its instant final quote (${fmtPence(finalTotalPence)}) was issued${when ? ` on ${fmtDateFull(when)}` : ""}. It was never a proposal, so nothing is issued here. Survey, design and send a proposal as usual.`,
    ]);
  } else if (fqStatus === "issued") {
    p.proposal = { status: "issued", contractType: "supply-and-install", ...(issuedAt ? { issuedAt } : {}) };
  } else if (fqStatus === "accepted") {
    const contractTotalPence = finalTotalPence;
    p.proposal = {
      status: "accepted",
      contractType: "supply-and-install",
      ...(issuedAt ? { issuedAt } : {}),
      ...(acceptedAt ? { acceptedAt } : {}),
      contractTotalPence,
    };
    p.money.contractTotalPence = contractTotalPence;
  }

  if (resurvey) {
    notes.push([
      "migrated-site-visit",
      `Moved from the old system: the site visit${visitedAt ? ` on ${fmtDateFull(visitedAt)}` : ""} was done there, but it left no survey record to design from. Book a home survey.`,
    ]);
  }

  // Installation → booking + install.
  const installDays = Math.max(1, Math.round(num(inst.installDays, p.quoteSummary.installDays)));
  const startDate = optStr(inst.date)?.slice(0, 10);
  const installer = rec(inst.installer);
  const prep = list<PrepItem>(inst.prep);
  p.booking = {
    ...p.booking,
    installDays,
    rescheduleFeesGbp: num(inst.rescheduleFeesGbp, 0) + num(dl.rescheduleFeesGbp, 0),
    prep: prep.length ? prep : p.booking.prep,
    crew: optStr(installer.name) && committed
      ? [{ staffId: "legacy", name: str(installer.name), role: "installer", external: false }]
      : [],
  };
  if (instStatus !== "not-booked" && startDate && committed) {
    p.booking.status = "booked";
    p.booking.startDate = startDate;
    p.booking.dates = consecutiveWorkingDays(startDate, installDays);
  } else if (instStatus === "booked" && startDate) {
    // Booked on a click with no contract behind it: not a booking here.
    notes.push([
      "migrated-install-booking",
      `Moved from the old system: the install was booked there for ${fmtDateFull(startDate)}, but nothing is booked here until the customer accepts a proposal. Call them about the date.`,
    ]);
  }
  if (instStatus === "completed") {
    p.install = { status: "complete", days: [], ...(optStr(inst.completedAt) ? { completedAt: str(inst.completedAt) } : {}) };
  }

  // Delivery → kit. A "scheduled" v1 delivery was only the target date its
  // install booking set, so it's an order only once work went ahead.
  const courier = optStr(dl.courier);
  const trackingRef = optStr(dl.trackingRef);
  p.kit = {
    status: dlStatus === "pending" || !committed ? "not-ordered" : dlStatus === "scheduled" ? "ordered" : dlStatus,
    shortages: 0,
    ...(optStr(dl.expectedDate) && committed ? { expectedDate: str(dl.expectedDate) } : {}),
    ...(optStr(dl.deliveredAt) ? { deliveredAt: str(dl.deliveredAt) } : {}),
    ...(courier ? { summary: trackingRef ? `${courier}, tracking ${trackingRef}` : courier } : {}),
  };
  if (p.proposal.status === "accepted" && p.proposal.acceptedAt && p.kit.status === "delivered" && p.kit.deliveredAt) {
    const days = DEFAULT_SETTINGS.scheduling.cancellationDays;
    p.proposal.goodsReceivedOn = dateOf(p.kit.deliveredAt);
    p.proposal.cancellationEndsOn = laterOf(addDays(p.kit.deliveredAt, days), addDays(p.proposal.acceptedAt, days));
  }

  p.money.changeFeesPence = (p.survey.rescheduleFeesGbp + p.booking.rescheduleFeesGbp) * 100;
  p.events = events;
  for (const [type, label] of notes) {
    p.events.push({ at: events[events.length - 1]?.at ?? str(raw.createdAt), type, label, actor: "system", internal: true });
  }
  // v1's "paid" was the customer's own button press, not a verified payment,
  // so no money moves here. v1 promised the fee comes off the install
  // balance (SITE_VISIT.creditedAgainstInstall), so say so where ops will see
  // it: the balance invoice credits projectFees().surveyPaidGbp (§K).
  if (v1Paid && feeGbp > 0) {
    p.events.push({
      at: events[events.length - 1]?.at ?? str(raw.createdAt),
      type: "migrated-survey-fee",
      label: `Moved from the old system: the £${feeGbp} site visit fee was marked paid there (not a verified payment). Check it was received, then credit it on the balance invoice as promised.`,
      actor: "system",
      internal: true,
    });
  }
  return p;
}

/**
 * Is this stored snapshot a v1 project (the same test migrateProject uses)?
 * v1 kept the customer's email and phone on the quote, not the project, so
 * only these may borrow contact details from the quote; on a v2 project an
 * empty field means "no address".
 */
export function isLegacySnapshot(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const r = raw as Rec;
  const looksV1 = V1_KEYS.some((k) => k in r);
  return !(r.schemaVersion === PROJECT_SCHEMA_VERSION || (!looksV1 && r.schemaVersion === undefined && "survey" in r));
}

/**
 * Lift any stored snapshot to v2. Idempotent on v2 (fills missing sections,
 * changes nothing else) and tolerant of partial v1 records. Pure: callers
 * decide whether to save the result.
 */
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("migrateProject: not a project snapshot");
  }
  const r = raw as Rec;
  const p = isLegacySnapshot(r) ? fromV1(r) : normaliseV2(r);
  // JSON-clean (no undefined-valued keys), so migrating twice is a strict no-op.
  return clone(p);
}

/* ------------------------------------------------------------------ */
/* Actions: the single write path                                     */
/* ------------------------------------------------------------------ */

type SurveyMode = Project["survey"]["mode"];
type KitStatus = Project["kit"]["status"];

export type ProjectAction =
  // survey
  | { type: "book-survey"; scheduledFor: string; mode: SurveyMode; surveyor?: { staffId: string; name: string } }
  | { type: "ops-book-survey"; scheduledFor: string; mode: SurveyMode; surveyor?: { staffId: string; name: string } }
  | { type: "reschedule-survey"; scheduledFor: string }
  | { type: "assign-surveyor"; staffId: string; name: string }
  | { type: "surveyor-on-my-way"; etaMinutes: number; by: string }
  | { type: "survey-started"; by: string }
  | {
      type: "survey-submitted";
      surveyRecordId: string;
      /** Optional: the surveyor's electrics finding replaces the funnel's guess. */
      electrics?: { status: ElectricsPlanStatus; summary: string };
    }
  // design
  | { type: "design-updated"; designId: string; version: number; status: "draft" | "in-review" }
  | { type: "design-approved"; designId: string; version: number; by: string }
  // proposal
  /**
   * The customer agreed to get contract documents by email: on the portal
   * themselves, or staff recording an agreement given in person or by email,
   * with the evidence (how and when; where the email is).
   */
  | { type: "documents-consent-recorded"; channel: DocumentsConsentChannel; evidence?: string; evidenceMediaId?: string }
  | {
      type: "proposal-issued";
      proposalId: string;
      version: number;
      validUntil: string;
      optionCount: number;
      /** Who supplies the kit; keeps the project's current type (supply-and-install by default) when left out. */
      contractType?: ContractType;
    }
  | { type: "proposal-viewed"; proposalId: string }
  | { type: "proposal-changes-requested"; text: string }
  | { type: "proposal-declined"; reason: string }
  | {
      type: "proposal-accepted";
      proposalId: string;
      version: number;
      optionLabel: string;
      contractTotalPence: number;
      earlyStartRequested: boolean;
      /** The early-start wording version the customer was shown; EARLY_START_WORDING_VERSION when left out. */
      earlyStartWordingVersion?: string;
    }
  | { type: "proposal-expired" }
  /** System (outbox): the issue email for this proposal version (the pre-contract information) went out. Idempotent. */
  | { type: "pre-contract-info-sent"; proposalId: string; messageId?: string; demo?: boolean }
  /** System: the acceptance confirmation email (the contract copy) went out. Idempotent. */
  | { type: "contract-confirmation-sent"; messageId?: string; demo?: boolean }
  /** The customer asks to start early after accepting (on the portal, or by email or form, recorded by ops). */
  | { type: "early-start-requested"; channel: "email" | "paper" | "portal" }
  /**
   * Ops: the customer's early-start request on a durable medium (their email
   * reply, or a signed form) is on file: the copy itself (`mediaIds`), the day
   * it reached us, for an email the address it came from, and the wording
   * version it uses (the one they were asked to use).
   */
  | {
      type: "early-start-evidenced";
      channel: "email" | "paper";
      evidenceRef: string;
      by: string;
      mediaIds: string[];
      receivedOn: string;
      fromAddress?: string;
      wordingVersion: string;
    }
  // booking
  | { type: "install-dates-set"; startDate: string; dates: string[] }
  | { type: "crew-assigned"; crew: CrewMember[] }
  | { type: "booking-confirmed" }
  | { type: "deposit-requested"; amountPence: number }
  | { type: "deposit-paid"; amountPence: number }
  // kit
  | {
      type: "kit-updated";
      status: KitStatus;
      expectedDate?: string;
      summary?: string;
      shortages: number;
      /**
       * Where the delivered kit went (purchasing's kitSummary always says).
       * "elsewhere" (our storage, the installer, a subcontractor) doesn't
       * start the cancellation period: the goods reach the customer at
       * install. Left out means the customer's home.
       */
      deliveredTo?: "customer" | "elsewhere";
      /** The day (yyyy-mm-dd, London) the last required line arrived (kitSummary): the period runs from it, not from this update. */
      receivedOn?: string;
    }
  /** Before the booking is confirmed: every required line is at the customer's home (kitSummary), so the period starts. */
  | { type: "goods-received"; receivedOn?: string }
  // install
  | { type: "installer-on-my-way"; etaMinutes: number; by: string }
  | { type: "install-day-started"; n: number; by: string }
  | { type: "install-day-ended"; n: number; summary: string; customerUpdate?: { text: string; mediaIds: string[] } }
  | { type: "install-completed" }
  // handover
  | { type: "commissioning-signed"; by: string }
  | { type: "handover-pack-published"; documentId: string }
  | { type: "handover-signed"; name: string; outcome: "all-good" | "snags"; snagCount: number }
  /** "received" needs the certificate document (the file is in the customer's documents before we say so). */
  | { type: "electrical-cert-updated"; status: Project["handover"]["electricalCert"]; documentId?: string }
  /** Needs the registration's document (its reference and any confirmation file). */
  | { type: "warranty-registered"; documentId?: string }
  // money
  | { type: "invoice-issued"; amountPence: number }
  | {
      type: "payment-recorded";
      amountPence: number;
      /** The payment record's id: the reducer counts each one once, however often its apply is retried. */
      paymentId?: string;
    }
  | { type: "survey-fee-paid"; amountPence: number }
  // customer + aftercare
  | { type: "prep-toggled"; itemId: string; done: boolean }
  | { type: "aftercare-checkin-sent" }
  | { type: "feedback-requested" }
  | { type: "feedback-submitted"; score: number; comments?: string }
  | { type: "review-requested" }
  | { type: "seasonal-check-sent" }
  /** The customer asked for no more follow-ups (or, with false, for them again). */
  | { type: "aftercare-opt-out"; optedOut: boolean }
  // admin
  | { type: "set-next-action"; text: string; dueOn?: string; ownerRole?: StaffRole | "customer" }
  | { type: "set-pilot"; number: number; label: string }
  /** The staff member who owns the project on the board; an empty staffId clears it. */
  | { type: "set-owner"; staffId: string; name: string }
  /**
   * Staff correct the customer's details. Name, address line and postcode
   * can be corrected but never blanked; documents already issued keep the
   * copy they were issued with.
   */
  | {
      type: "set-customer-contact";
      email?: string;
      phone?: string;
      accessNotes?: string;
      parkingNotes?: string;
      name?: string;
      addressLine?: string;
      postcode?: string;
    }
  | { type: "project-closed"; reason?: string }
  /** Ops: the customer's cancellation reached us (when, how, where it's on file). Closes the project as cancelled. */
  | { type: "cancellation-received"; receivedAt: string; channel: CancellationChannel; evidenceRef: string }
  /**
   * System: a refund counted by payment-recorded failed (or was cancelled) at
   * the card provider, so the money is with us again: the totals take it back
   * once (`paymentId` is the refund's), and the family is told.
   */
  | { type: "refund-failed"; amountPence: number; paymentId: string }
  /** Ops: the charge for work done before a cancellation, after an evidenced early start (reg 36(4)). */
  | { type: "cancellation-charge-recorded"; amountPence: number; basis: string; requestId?: string }
  /** Money: a credit note against the charge's invoice took this much off the charge. */
  | { type: "cancellation-charge-credited"; amountPence: number; creditNoteId: string }
  | { type: "note"; text: string };

export type ApplyResult = { ok: true; project: Project } | { ok: false; error: string; blockers?: Blocker[] };

/** What may still happen on a closed project: records, money and aftercare, never delivery. */
const AFTER_CLOSE: ReadonlySet<ProjectAction["type"]> = new Set<ProjectAction["type"]>([
  "note",
  "set-next-action",
  "set-pilot",
  "set-owner",
  "set-customer-contact",
  "invoice-issued",
  "payment-recorded",
  "survey-fee-paid",
  "electrical-cert-updated",
  "warranty-registered",
  "aftercare-checkin-sent",
  "feedback-requested",
  "feedback-submitted",
  "review-requested",
  "seasonal-check-sent",
  "aftercare-opt-out",
  "contract-confirmation-sent",
  "pre-contract-info-sent",
  "cancellation-charge-recorded",
  "cancellation-charge-credited",
  "refund-failed",
]);

const KIT_STATUSES: readonly KitStatus[] = ["not-ordered", "ordered", "confirmed", "dispatched", "delivered", "inspected"];
const isWholePence = (n: number) => Number.isInteger(n);

/**
 * What a customer pays to move a date. The survey is advertised as free and
 * no-obligation, and before a contract there's no balance to add a fee to,
 * so moving it is always free (v1's site-visit band is retired). The
 * install keeps v1's bands: a week's notice is free, closer pays the
 * short-notice fee the contract discloses (Schedule 2 (g)).
 */
export function rescheduleFeeGbp(kind: "survey" | "installation", daysNotice: number): number {
  if (kind === "survey") return 0;
  const bands = RESCHEDULE_FEES.installation;
  for (const band of bands) {
    if (daysNotice >= band.minDaysNotice) return band.feeGbp;
  }
  return bands[bands.length - 1]?.feeGbp ?? 0;
}

/**
 * A day closed off by the install completing rather than by the crew ending
 * it: the last day worked, done, with no summary (ending a day always
 * leaves one). The crew can still end it, adding the customer update and
 * stopping their clock, once the install is complete.
 */
export function isWrapUpDay(p: Pick<Project, "install">, day: InstallDay): boolean {
  if (p.install.status !== "complete" || day.status !== "done" || day.summary !== undefined || !day.startedAt) return false;
  const worked = p.install.days.filter((d) => d.startedAt);
  return worked[worked.length - 1]?.n === day.n;
}

/** The day the crew can still wrap up after the install completed (see isWrapUpDay), if any. */
export function wrapUpDayOf(p: Pick<Project, "install">): InstallDay | undefined {
  return p.install.days.find((d) => isWrapUpDay(p, d));
}

/**
 * The updates-feed line for an end-of-day update: "Day 2 done: …", without
 * doubling the prefix when the installer already wrote "Day 2 done: …".
 */
export function dayUpdateLabel(n: number, text: string): string {
  const t = text.trim();
  return new RegExp(`^day\\s*${n}\\b`, "i").test(t) ? t : `Day ${n} done: ${t}`;
}

/**
 * Apply one action to a project. Pure: returns a new project (or an error),
 * never mutates. `now` is injected so server and tests control the clock;
 * `ctx` carries everything outside the snapshot that a gate needs. Gated
 * actions refuse without it.
 *
 * Attribution: with `ctx.actor` set, a staff member did it (ops, or field for
 * on-site steps). Without it, customer actions are the customer's and the
 * rest are the system's. Date-change fees apply only to the customer's own
 * changes; when we move a date it's on us.
 */
export function applyProjectAction(project: Project, action: ProjectAction, now: string, ctx?: ReadinessContext): ApplyResult {
  // Projects are JSON snapshots by design, so JSON is a faithful deep clone.
  const p: Project = JSON.parse(JSON.stringify(project)) as Project;
  const today = dateOf(ctx?.today ?? now);
  const settings = ctx?.settings ?? DEFAULT_SETTINGS;
  const err = (error: string, blockers?: Blocker[]): ApplyResult => ({ ok: false, error, ...(blockers ? { blockers } : {}) });
  const ok = (): ApplyResult => ({ ok: true, project: p });
  const staff = ctx?.actor;

  const log = (
    type: string,
    label: string,
    base: ProjectActor,
    extra: { internal?: boolean; feeGbp?: number; actorName?: string; actor?: ProjectActor } = {},
  ) => {
    const actor = extra.actor ?? (staff ? (base === "field" ? "field" : "ops") : base);
    const actorName = extra.actorName ?? staff?.name;
    p.events.push({
      at: now,
      type,
      label,
      actor,
      ...(actorName ? { actorName } : {}),
      ...(extra.internal ? { internal: true } : {}),
      ...(extra.feeGbp ? { feeGbp: extra.feeGbp } : {}),
    });
  };

  /** null when the gate is clear, else the refusal carrying its blockers. */
  const gate = (g: GateId): ApplyResult | null => {
    if (!ctx) return err(`${GATE_LABEL[g]}: this step needs a readiness check.`);
    const all = blockersFor(project, ctx, g);
    const blocking = all.filter((b) => b.severity === "block");
    if (!blocking.length) return null;
    const more = blocking.length > 1 ? ` (and ${blocking.length - 1} more)` : "";
    return err(`Not ready (${GATE_LABEL[g]}): ${blocking[0]!.message}${more}`, all);
  };

  /**
   * supply-and-install: the last of the goods is in the customer's
   * possession today, so their cancellation period starts (once). Returns
   * the customer-facing sentence about the new end date ("" when nothing
   * changed).
   */
  /**
   * supply-and-install: start the cancellation period from the day the last
   * of the goods came into the customer's possession (reg 30(3)–(5)): `on`,
   * the delivery date purchasing recorded (never after today), else today.
   * Set once; the period is held open again (heldOpenForGoods) while a
   * replacement is on its way, so it then runs from that later arrival.
   * Never ends before cancellationDays from acceptance.
   */
  const startGoodsPeriod = (on?: string): string => {
    if (p.proposal.status !== "accepted" || p.proposal.contractType !== "supply-and-install" || p.proposal.goodsReceivedOn) return "";
    const day = on && /^\d{4}-\d{2}-\d{2}/.test(on) && dateOf(on) <= today ? dateOf(on) : today;
    const days = settings.scheduling.cancellationDays;
    const acceptedOn = dateOf(p.proposal.acceptedAt ?? today);
    p.proposal.goodsReceivedOn = day;
    p.proposal.cancellationEndsOn = laterOf(addDays(day, days), addDays(acceptedOn, days));
    return ` Your cancellation period now runs until the end of ${fmtDate(p.proposal.cancellationEndsOn)}.`;
  };
  /**
   * More of the goods are still to come after the period had started (a
   * replacement for damaged kit, or kit added later): the last of the goods
   * isn't with the customer yet, so the period is open again and runs from
   * when it arrives. Only while the period is still running and before the
   * install has started: an ended period stays ended.
   */
  const heldOpenForGoods = (): string => {
    if (p.proposal.contractType !== "supply-and-install" || !p.proposal.goodsReceivedOn || p.install.status !== "not-started") return "";
    if (cancellationStatus(p, today, settings).ended) return "";
    delete p.proposal.goodsReceivedOn;
    delete p.proposal.cancellationEndsOn;
    return " Your cancellation period now runs from when the last of it arrives.";
  };

  /** The signed-in staff member, qualified for a step that legally needs one. */
  const qualified = (perm: "design.approve" | "commissioning.sign", what: string): ApplyResult | null => {
    if (!staff) return err(`${what} needs a signed-in technical lead.`);
    if (!can(staff, perm) || !meetsRequirement(staff, "tech-lead", today)) {
      return err(`${staff.name} can't do this: ${what.toLowerCase()} needs a technical lead with current F-gas certification.`);
    }
    return null;
  };

  const future = (iso: string) => Number.isFinite(Date.parse(iso)) && Date.parse(iso) > Date.parse(now);
  const addChangeFee = (fee: number) => {
    p.money.changeFeesPence += fee * 100;
  };

  if (p.closure.closed && !AFTER_CLOSE.has(action.type)) return err("This project is closed.");

  switch (action.type) {
    /* ---------------- survey ---------------- */

    case "book-survey":
    case "ops-book-survey": {
      const byCustomer = action.type === "book-survey";
      if (p.survey.status === "submitted") return err("The survey has already happened.");
      if (p.survey.status === "in-progress") return err("The survey is already under way.");
      if (byCustomer && p.survey.status === "booked") return err("Your survey is already booked. Move it instead.");
      if (!future(action.scheduledFor)) return err("Pick a survey slot in the future.");
      if (action.mode !== "in-person" && action.mode !== "video") return err("Unknown survey type.");
      const moving = p.survey.status === "booked";
      p.survey.status = "booked";
      p.survey.mode = action.mode;
      p.survey.scheduledFor = action.scheduledFor;
      if (action.surveyor) p.survey.surveyor = action.surveyor;
      log(
        moving ? "survey-rescheduled" : "survey-booked",
        `${action.mode === "video" ? "Video survey" : "Home survey"} ${moving ? "moved to" : "booked for"} ${fmtDateTime(action.scheduledFor)}.`,
        byCustomer ? "customer" : "ops",
      );
      return ok();
    }

    case "reschedule-survey": {
      if (p.survey.status !== "booked" || !p.survey.scheduledFor) return err("There's no booked survey to move.");
      if (!future(action.scheduledFor)) return err("Pick a survey slot in the future.");
      const fee = staff ? 0 : rescheduleFeeGbp("survey", daysBetween(now, p.survey.scheduledFor));
      p.survey.rescheduleFeesGbp += fee;
      addChangeFee(fee);
      p.survey.scheduledFor = action.scheduledFor;
      delete p.survey.onMyWay;
      log(
        "survey-rescheduled",
        `Survey moved to ${fmtDateTime(action.scheduledFor)}${fee ? ` (£${fee} short-notice change fee)` : " (no fee)"}.`,
        "customer",
        { feeGbp: fee || undefined },
      );
      return ok();
    }

    case "assign-surveyor": {
      if (!action.staffId || !action.name.trim()) return err("Pick a surveyor.");
      p.survey.surveyor = { staffId: action.staffId, name: action.name };
      log("surveyor-assigned", `${action.name} will carry out your home survey.`, "ops");
      return ok();
    }

    case "surveyor-on-my-way": {
      if (p.survey.status !== "booked") return err("There's no booked survey.");
      if (!(action.etaMinutes > 0)) return err("Give an ETA in minutes.");
      const eta = Math.round(action.etaMinutes);
      p.survey.onMyWay = { at: now, etaMinutes: eta };
      log("surveyor-on-my-way", `${action.by} is on the way to your survey, about ${eta} minutes out.`, "field", {
        actorName: action.by,
      });
      return ok();
    }

    case "survey-started": {
      if (p.survey.status !== "booked") return err("There's no booked survey to start.");
      p.survey.status = "in-progress";
      p.survey.startedAt = now;
      log("survey-started", `${action.by} has started your home survey.`, "field", { actorName: action.by });
      return ok();
    }

    case "survey-submitted": {
      if (p.survey.status === "submitted") return err("The survey is already submitted.");
      if (p.survey.status === "not-booked") return err("Book the survey first.");
      if (!action.surveyRecordId) return err("Which survey record?");
      const refusal = gate("survey-complete");
      if (refusal) return refusal;
      p.survey.status = "submitted";
      p.survey.submittedAt = now;
      p.survey.surveyRecordId = action.surveyRecordId;
      if (action.electrics) {
        p.electrics.status = action.electrics.status;
        p.electrics.summary = action.electrics.summary;
      }
      log(
        "survey-submitted",
        `Survey done, thanks for having us. We aim to have your proposal with you by ${fmtDate(addWorkingDays(today, PROPOSAL_TURNAROUND_WORKING_DAYS))}.`,
        "field",
      );
      return ok();
    }

    /* ---------------- design ---------------- */

    case "design-updated": {
      if (p.survey.status !== "submitted") return err("The survey has to be submitted before design starts.");
      if (p.proposal.status === "accepted") return err("The proposal is accepted. Changes now go through a variation.");
      if (action.status !== "draft" && action.status !== "in-review") return err("Unknown design status.");
      p.design = { status: action.status, designId: action.designId, version: action.version };
      log("design-updated", `Design v${action.version} saved (${action.status === "draft" ? "draft" : "in review"}).`, "ops", {
        internal: true,
      });
      return ok();
    }

    case "design-approved": {
      if (p.survey.status !== "submitted") return err("The survey has to be submitted before a design can be approved.");
      if (p.proposal.status === "accepted") return err("The proposal is accepted. Changes now go through a variation.");
      const refusal = qualified("design.approve", "Design approval");
      if (refusal) return refusal;
      const current = p.design.designId;
      if (current && (current !== action.designId || (p.design.version !== undefined && p.design.version !== action.version))) {
        return err("That isn't the latest design version.");
      }
      const errors = ctx?.design?.compatibilityErrors ?? [];
      if (errors.length) return err(`The design has compatibility errors: ${errors[0]}`);
      // The approver is the verified, qualified person signed in (§A5), never a
      // name the caller typed: `action.by` is informational only.
      const approver = staff!.name;
      p.design = {
        status: "approved",
        designId: action.designId,
        version: action.version,
        approvedAt: now,
        approvedBy: approver,
      };
      log(
        "design-approved",
        `Your design has been checked and signed off by ${approver}, our qualified engineer. Your proposal is next.`,
        "ops",
        { actorName: approver },
      );
      return ok();
    }

    /* ---------------- proposal ---------------- */

    case "documents-consent-recorded": {
      if (!["portal", "in-person", "email"].includes(action.channel)) return err("How did the customer agree?");
      if (p.proposal.status === "accepted") return err("The contract is already in place.");
      // The first agreement for this address stands; asking again changes nothing.
      if (documentsConsentCovers(p)) return ok();
      const evidence = action.evidence?.trim().slice(0, 500);
      if (action.channel !== "portal") {
        // Told to us, not ticked by them: it must be ours to record, and provable later (reg 17).
        if (!staff) return err("Only our team can record an agreement given in person or by email.");
        if (!evidence || evidence.length < 5) {
          return err(
            action.channel === "email"
              ? "Say where their email is (its date and subject, say), so it can be found again."
              : "Say how and when they agreed (at the survey, on the phone on Tuesday…).",
          );
        }
      }
      const wording = DOCUMENTS_CONSENT_WORDING[action.channel];
      const address = p.customer.email?.trim();
      p.proposal.documentsByEmailConsent = {
        at: now,
        channel: action.channel,
        wordingVersion: wording.version,
        text: wording.text,
        ...(address ? { email: address } : {}),
        ...(staff && action.channel !== "portal" ? { recordedBy: { staffId: staff.id, name: staff.name } } : {}),
        ...(evidence && action.channel !== "portal" ? { evidence } : {}),
        ...(action.evidenceMediaId && action.channel !== "portal" ? { evidenceMediaId: action.evidenceMediaId } : {}),
      };
      log(
        "documents-consent-recorded",
        "You agreed to get your proposal, contract and cancellation information by email.",
        "customer",
      );
      return ok();
    }

    case "proposal-issued": {
      if (p.proposal.status === "accepted") return err("The proposal is accepted. Changes now go through a variation.");
      if (!action.proposalId) return err("Which proposal?");
      const contractType = action.contractType ?? p.proposal.contractType ?? "supply-and-install";
      if (!CONTRACT_TYPES.includes(contractType)) return err("Unknown contract type.");
      if (!/^\d{4}-\d{2}-\d{2}/.test(action.validUntil) || dateOf(action.validUntil) < today) {
        return err("The valid-until date must be today or later.");
      }
      if (!Number.isInteger(action.optionCount) || action.optionCount < 1) return err("A proposal needs at least one option.");
      const refusal = gate("proposal-issue");
      if (refusal) return refusal;
      // A fresh version starts clean, except the customer's standing
      // agreement to email delivery. Its issue email carries the Schedule 2
      // information, the cancellation instructions and the model form.
      const consent = p.proposal.documentsByEmailConsent;
      // Issuing the same version again (a retry) keeps its delivered email:
      // the outbox won't send that version's email twice.
      const sentBefore = p.proposal.proposalId === action.proposalId ? p.proposal.preContractInfoSentAt : undefined;
      p.proposal = {
        status: "issued",
        proposalId: action.proposalId,
        version: action.version,
        issuedAt: now,
        validUntil: dateOf(action.validUntil),
        optionCount: action.optionCount,
        contractType,
        ...(consent ? { documentsByEmailConsent: consent } : {}),
        // preContractInfoSentAt is recorded by the outbox once the issue
        // email has actually gone (pre-contract-info-sent), never here.
        ...(sentBefore ? { preContractInfoSentAt: sentBefore } : {}),
      };
      log(
        "proposal-issued",
        `Your proposal is ready. Take your time: it's valid until ${fmtDate(action.validUntil)}.`,
        "ops",
      );
      return ok();
    }

    case "proposal-viewed": {
      if (p.proposal.status !== "issued" && p.proposal.status !== "changes-requested") return err("There's no issued proposal.");
      // Once per version, only the current one, and only the customer's own
      // view (a staff preview isn't the customer reading it).
      if (staff || p.proposal.viewedAt || (p.proposal.proposalId && p.proposal.proposalId !== action.proposalId)) return ok();
      p.proposal.viewedAt = now;
      log("proposal-viewed", "Customer opened the proposal.", "customer", { internal: true });
      return ok();
    }

    case "proposal-changes-requested": {
      if (p.proposal.status !== "issued") return err("There's no issued proposal to change.");
      const text = action.text.trim();
      if (!text) return err("Tell us what you'd like changed.");
      p.proposal.status = "changes-requested";
      p.proposal.changeRequest = text;
      log("proposal-changes-requested", "You asked for some changes. We'll send you a revised proposal.", "customer");
      return ok();
    }

    case "proposal-declined": {
      if (p.proposal.status !== "issued" && p.proposal.status !== "changes-requested") {
        return err("There's no issued proposal to decline.");
      }
      p.proposal.status = "declined";
      const reason = action.reason.trim();
      if (reason) p.proposal.declineReason = reason;
      log("proposal-declined", "You declined the proposal. Thanks for letting us know.", "customer");
      return ok();
    }

    case "proposal-accepted": {
      if (p.proposal.status === "accepted") return err("This proposal is already accepted.");
      if (p.proposal.proposalId && action.proposalId !== p.proposal.proposalId) return err("That isn't the current proposal.");
      if (p.proposal.version !== undefined && action.version !== p.proposal.version) return err("That isn't the current proposal version.");
      if (!isWholePence(action.contractTotalPence) || action.contractTotalPence <= 0) return err("The contract total must be a positive amount.");
      if (!action.optionLabel.trim()) return err("Which option?");
      const refusal = gate("proposal-accept");
      if (refusal) return refusal;
      p.proposal.status = "accepted";
      p.proposal.proposalId = action.proposalId;
      p.proposal.version = action.version;
      p.proposal.acceptedAt = now;
      p.proposal.acceptedOptionLabel = action.optionLabel;
      p.proposal.contractTotalPence = action.contractTotalPence;
      const early = action.earlyStartRequested === true;
      p.proposal.earlyStartRequested = early;
      p.proposal.earlyStart = {
        requested: early,
        ...(early ? { requestedAt: now, channel: "portal" as const } : {}),
        wordingVersion: action.earlyStartWordingVersion?.trim() || EARLY_START_WORDING_VERSION,
      };
      // install-only: 14 days from today (London), the contract day. A
      // supply-and-install period starts counting when the goods arrive
      // (kit-updated). Legal review required: see cancellationStatus.
      delete p.proposal.goodsReceivedOn;
      if (p.proposal.contractType === "install-only") {
        p.proposal.cancellationEndsOn = addDays(today, settings.scheduling.cancellationDays);
      } else {
        delete p.proposal.cancellationEndsOn;
      }
      delete p.proposal.changeRequest;
      p.money.contractTotalPence = action.contractTotalPence;
      log(
        "proposal-accepted",
        `You accepted your proposal (${action.optionLabel}, ${fmtPence(action.contractTotalPence)}). We're sending you your contract and cancellation form to keep. Next: choose your install dates.`,
        "customer",
      );
      return ok();
    }

    case "pre-contract-info-sent": {
      // Only the current version's email counts (each version is its own
      // proposal id): a late send of an older version's email says nothing
      // about the one the customer is reading.
      if (!action.proposalId || p.proposal.proposalId !== action.proposalId) return ok();
      if (p.proposal.preContractInfoSentAt) return ok(); // the first send is the one that counts
      p.proposal.preContractInfoSentAt = now;
      log(
        "pre-contract-info-sent",
        action.demo
          ? "Proposal email (pre-contract information) recorded in demo mode (stored, not delivered)."
          : "Proposal email sent: the pre-contract information and cancellation form, on a durable medium.",
        "system",
        { internal: true },
      );
      return ok();
    }

    case "contract-confirmation-sent": {
      if (p.proposal.status !== "accepted") return err("There's no accepted contract to confirm.");
      if (p.proposal.confirmationSentAt) return ok(); // the first send is the one that counts
      p.proposal.confirmationSentAt = now;
      log(
        "contract-confirmation-sent",
        action.demo
          ? "Contract confirmation email recorded in demo mode (stored, not delivered)."
          : "Contract confirmation email sent: the customer's durable copy.",
        "system",
        { internal: true },
      );
      return ok();
    }

    case "early-start-requested": {
      if (p.proposal.status !== "accepted") return err("There's no accepted contract.");
      if (!["email", "paper", "portal"].includes(action.channel)) return err("How did the customer ask?");
      if (p.install.status !== "not-started") return err("The install has already started.");
      if (earlyStartRequestedOf(p)) return ok(); // asking twice changes nothing
      p.proposal.earlyStart = {
        ...(p.proposal.earlyStart ?? { wordingVersion: EARLY_START_WORDING_VERSION }),
        requested: true,
        requestedAt: now,
        channel: action.channel,
      };
      p.proposal.earlyStartRequested = true;
      log("early-start-requested", "You asked us to start before your cancellation period ends.", "customer");
      return ok();
    }

    case "early-start-evidenced": {
      if (p.proposal.status !== "accepted") return err("There's no accepted contract.");
      if (!earlyStartRequestedOf(p)) return err("The customer didn't ask to start early when they accepted.");
      if (action.channel !== "email" && action.channel !== "paper") return err("Evidence is the customer's email or a signed form.");
      const evidenceRef = action.evidenceRef.trim();
      if (!evidenceRef) return err("Which email or form? Give its reference.");
      // As with approvals: the verified person signed in, never a typed name.
      if (!staff) return err("Recording early-start evidence needs a signed-in staff member.");
      if (p.proposal.earlyStart?.evidencedAt) return err("The early-start request is already on file.");
      const problem = earlyStartEvidenceProblem(p, action, today);
      if (problem) return err(problem);
      const fromAddress = action.channel === "email" ? normalisedAddress(action.fromAddress) : undefined;
      p.proposal.earlyStart = {
        ...(p.proposal.earlyStart ?? { requested: true, wordingVersion: EARLY_START_WORDING_VERSION }),
        requested: true,
        channel: action.channel,
        evidenceRef,
        mediaIds: [...new Set(action.mediaIds)],
        receivedOn: action.receivedOn,
        ...(fromAddress ? { fromAddress } : {}),
        evidencedAt: now,
        recordedBy: staff.name,
      };
      p.proposal.earlyStartRequested = true;
      log(
        "early-start-evidenced",
        action.channel === "email"
          ? "We've got your email asking us to start early, and saved it with your contract."
          : "We've got your signed form asking us to start early, and saved it with your contract.",
        "ops",
      );
      return ok();
    }

    case "proposal-expired": {
      if (p.proposal.status !== "issued" && p.proposal.status !== "changes-requested") return err("There's no open proposal to expire.");
      if (!p.proposal.validUntil || dateOf(p.proposal.validUntil) >= today) return err("The proposal is still valid.");
      p.proposal.status = "expired";
      log("proposal-expired", "Your proposal has passed its valid-until date. Ask us and we'll refresh it.", "system");
      return ok();
    }

    /* ---------------- booking ---------------- */

    case "install-dates-set": {
      if (p.proposal.status !== "accepted") return err("Accept your proposal before choosing install dates.");
      if (p.install.status !== "not-started") return err("The install has started, so the dates can't move now.");
      const dates = action.dates.map(dateOf);
      const n = p.booking.installDays;
      if (dates.length !== n) return err(`Pick ${n} install day${n === 1 ? "" : "s"}.`);
      if (dates[0] !== dateOf(action.startDate)) return err("The start date must be the first install day.");
      if (dates.some((d, i) => i > 0 && d <= dates[i - 1]!)) return err("Install days must be in order, with no repeats.");
      const offDay = dates.map((d) => notWorkingReason(d, settings.scheduling.workingDays, fmtDate)).find((r) => r !== null);
      if (offDay) return err(`Install days must be working days: ${offDay}.`);
      const start = dates[0]!;
      if (daysBetween(today, start) < INSTALL_LEAD_DAYS) {
        return err(`Install dates need at least ${INSTALL_LEAD_DAYS} days' notice.`);
      }
      // Inside the period only on an early-start request (the evidence is
      // checked at ready-to-install). A supply-and-install period with no end
      // yet (kit not delivered) can't be checked here: that gate holds it.
      const coolingOff = cancellationStatus(p, today, settings).endsOn;
      if (!earlyStartRequestedOf(p) && coolingOff && start <= coolingOff) {
        return err(`Your cancellation period runs until ${fmtDate(coolingOff)}. Pick a start after that, or ask us about starting sooner.`);
      }
      // Supply-and-install with the kit still to come: the period runs from
      // its delivery, which can't be before tomorrow, so a start any sooner
      // than that plus the period could never go ahead. (The server checks
      // the orders' real delivery dates on top: earliestStartForKit.)
      if (!coolingOff && periodWaitsOnDelivery(p)) {
        const floor = earliestStartForKit(p, today, settings);
        if (start < floor) {
          return err(
            `Your cancellation period runs for ${settings.scheduling.cancellationDays} days from when your equipment is delivered, so the earliest we can start is ${fmtDate(floor)}. Pick a later start, or ask us about starting sooner.`,
          );
        }
      }
      if (p.booking.dates.join() === dates.join()) return err("Those are already your install dates.");
      const moving = p.booking.status === "booked" && Boolean(p.booking.startDate);
      const fee = moving && !staff ? rescheduleFeeGbp("installation", daysBetween(now, p.booking.startDate!)) : 0;
      p.booking.rescheduleFeesGbp += fee;
      addChangeFee(fee);
      p.booking.startDate = start;
      p.booking.dates = dates;
      log(
        moving ? "install-rescheduled" : "install-dates-set",
        moving
          ? `Install moved to ${fmtRange(dates)}${fee ? ` (£${fee} short-notice change fee)` : ""}.`
          : `Install dates chosen: ${fmtRange(dates)}. We'll confirm once your team and kit are lined up.`,
        "customer",
        { feeGbp: fee || undefined },
      );
      return ok();
    }

    case "crew-assigned": {
      if (action.crew.some((m) => !m.staffId || !m.name || !ROLE_LABEL[m.role])) return err("Every crew member needs a name and a role.");
      p.booking.crew = action.crew.map((m) => ({ staffId: m.staffId, name: m.name, role: m.role, external: m.external }));
      if (action.crew.length) {
        const names = action.crew.map((m) => `${m.name} (${ROLE_LABEL[m.role].toLowerCase()})`).join(", ");
        log("crew-assigned", `Meet your install team: ${names}.`, "ops");
      } else {
        log("crew-assigned", "Install team cleared.", "ops", { internal: true });
      }
      return ok();
    }

    case "booking-confirmed": {
      if (p.booking.status === "booked") return err("The booking is already confirmed.");
      const refusal = gate("booking");
      if (refusal) return refusal;
      p.booking.status = "booked";
      log(
        "booking-confirmed",
        `You're booked in for ${fmtRange(p.booking.dates)}. You'll get a prep list, and a reminder the day before.`,
        "ops",
      );
      return ok();
    }

    case "deposit-requested": {
      if (!isWholePence(action.amountPence) || action.amountPence <= 0) return err("The deposit must be a positive amount.");
      if (p.booking.depositStatus === "paid") return err("The deposit is already paid.");
      p.booking.depositStatus = "requested";
      log("deposit-requested", `A deposit of ${fmtPence(action.amountPence)} is due. You can pay it from your project page.`, "ops");
      return ok();
    }

    // Status only: money.paidPence moves through payment-recorded, so a deposit
    // is never counted twice.
    case "deposit-paid": {
      if (!isWholePence(action.amountPence) || action.amountPence <= 0) return err("The deposit must be a positive amount.");
      if (p.booking.depositStatus === "paid") return err("The deposit is already paid.");
      p.booking.depositStatus = "paid";
      log("deposit-paid", `Deposit of ${fmtPence(action.amountPence)} received. Thank you.`, "system");
      return ok();
    }

    /* ---------------- kit ---------------- */

    // The goods reached the customer's home before the booking was confirmed:
    // their cancellation period starts from that day all the same (kit
    // updates themselves wait for the booking, kit-updated).
    case "goods-received": {
      if (p.proposal.status !== "accepted") return err("There's no accepted contract yet.");
      if (p.proposal.contractType !== "supply-and-install") return err("Only a supply-and-install contract's period runs from delivery.");
      if (p.install.status !== "not-started") return err("The install has started.");
      if (p.proposal.goodsReceivedOn) return err("The delivery is already recorded.");
      const note = startGoodsPeriod(action.receivedOn);
      if (!note) return err("The delivery couldn't be recorded.");
      log("goods-received", `Your equipment has been delivered to your home.${note}`, "ops");
      return ok();
    }

    case "kit-updated": {
      if (p.booking.status !== "booked") return err("Confirm the booking before tracking kit.");
      if (!KIT_STATUSES.includes(action.status)) return err("Unknown kit status.");
      if (!Number.isInteger(action.shortages) || action.shortages < 0) return err("Shortages must be a whole number.");
      p.kit.status = action.status;
      p.kit.shortages = action.shortages;
      if (action.expectedDate) p.kit.expectedDate = dateOf(action.expectedDate);
      if (action.summary !== undefined) p.kit.summary = action.summary;
      if ((action.status === "delivered" || action.status === "inspected") && !p.kit.deliveredAt) p.kit.deliveredAt = now;
      if (action.status === "inspected") p.kit.inspectedAt = now;
      const arrived = action.status === "delivered" || action.status === "inspected";
      const withCustomer = action.deliveredTo !== "elsewhere";
      if (arrived) p.kit.deliveredTo = withCustomer ? "customer" : "elsewhere";
      else delete p.kit.deliveredTo;
      // supply-and-install: the cancellation period runs to the end of 14
      // days after the LAST of the goods comes into the customer's physical
      // possession (reg 30(3)–(4)), so the clock starts on the first update
      // with everything at their home, and never moves after. Kit delivered
      // to our storage, the installer or a subcontractor reaches them with
      // the crew: the clock starts on install day 1 instead. Never earlier
      // than 14 days from acceptance. Legal review required (see
      // cancellationStatus).
      const knownBefore = Boolean(p.proposal.goodsReceivedOn);
      let periodNote = "";
      if (arrived && action.shortages === 0 && withCustomer) periodNote = startGoodsPeriod(action.receivedOn);
      else if (arrived && action.shortages > 0) periodNote = heldOpenForGoods();
      const toCome = action.shortages
        ? ` ${action.shortages} item${action.shortages === 1 ? " is" : "s are"} still to come; we're on it.`
        : "";
      // Conservative customer wording: only what someone has actually confirmed.
      switch (action.status) {
        case "not-ordered":
          log("kit-updated", "Kit status reset to not ordered.", "ops", { internal: true });
          break;
        case "ordered":
          log("kit-updated", "Your kit is ordered.", "ops");
          break;
        case "confirmed":
          log(
            "kit-updated",
            p.kit.expectedDate
              ? `The supplier has confirmed your kit for ${fmtDate(p.kit.expectedDate)}.`
              : "The supplier has confirmed your kit order.",
            "ops",
          );
          break;
        case "dispatched":
          log("kit-updated", "Kit dispatched by the supplier.", "ops", { internal: true });
          break;
        case "delivered":
          // Already told (goods-received, before the booking): only the record here.
          if (knownBefore && !toCome && !periodNote) log("kit-updated", "Kit delivered (recorded before the booking).", "ops", { internal: true });
          else log("kit-updated", `Your kit has been delivered.${toCome}${periodNote}`, "ops");
          break;
        case "inspected":
          log("kit-updated", `Your kit has been checked by our team.${toCome}${periodNote}`, "field");
          break;
      }
      return ok();
    }

    /* ---------------- install ---------------- */

    case "installer-on-my-way": {
      if (p.booking.status !== "booked") return err("The install isn't booked.");
      if (!(action.etaMinutes > 0)) return err("Give an ETA in minutes.");
      const eta = Math.round(action.etaMinutes);
      p.install.onMyWay = { at: now, etaMinutes: eta, by: action.by };
      log("installer-on-my-way", `${action.by} is on the way, about ${eta} minutes out.`, "field", { actorName: action.by });
      return ok();
    }

    case "install-day-started": {
      const n = action.n;
      if (!Number.isInteger(n) || n < 1) return err("Which install day?");
      if (p.booking.status !== "booked") return err("The install isn't booked.");
      if (p.install.status === "complete") return err("The install is already complete.");
      if (!p.install.days.length) {
        p.install.days = p.booking.dates.map((date, i) => ({ n: i + 1, date, status: "planned" as const }));
      }
      if (n === 1) {
        const refusal = gate("ready-to-install");
        if (refusal) return refusal;
      } else if (!p.install.days.find((d) => d.n === n - 1)?.startedAt) {
        return err(`Day ${n - 1} hasn't started yet.`);
      }
      let day = p.install.days.find((d) => d.n === n);
      if (day?.startedAt) return err(`Day ${n} has already started.`);
      if (!day) {
        // An overrun day beyond the plan: real, and counted against the planned days.
        if (n !== p.install.days.length + 1) return err(`Day ${n - 1} hasn't started yet.`);
        day = { n, date: today, status: "planned" };
        p.install.days.push(day);
      }
      day.status = "in-progress";
      day.startedAt = now;
      day.date = today;
      p.install.status = "in-progress";
      p.install.startedAt ??= now;
      // Kit we held (storage, the installer, a subcontractor) comes into the
      // customer's possession with the crew today: their period starts now.
      const arrivedWithCrew = n === 1 && p.kit.deliveredTo === "elsewhere" ? startGoodsPeriod() : "";
      const of = n <= p.booking.installDays ? ` of ${p.booking.installDays}` : "";
      log(
        "install-day-started",
        `Day ${n}${of} has started. ${action.by} is on site.${arrivedWithCrew ? ` Your equipment arrived with the crew today.${arrivedWithCrew}` : ""}`,
        "field",
        { actorName: action.by },
      );
      return ok();
    }

    case "install-day-ended": {
      const day = p.install.days.find((d) => d.n === action.n);
      // The day the install completed on (commissioning signed mid-day) is closed with it, but the
      // crew is still on site for the handover: they still end it, with the update and their clock.
      const wrapUp = day ? isWrapUpDay(p, day) : false;
      if (!day || (day.status !== "in-progress" && !wrapUp)) return err(`Day ${action.n} hasn't started.`);
      day.status = "done";
      day.endedAt = now;
      day.summary = action.summary;
      const update = action.customerUpdate;
      if (update && update.text.trim()) {
        day.customerUpdate = { text: update.text.trim(), mediaIds: update.mediaIds, sentAt: now };
      }
      log(
        "install-day-ended",
        day.customerUpdate ? dayUpdateLabel(action.n, day.customerUpdate.text) : `Day ${action.n} wrapped up.`,
        "field",
      );
      return ok();
    }

    case "install-completed": {
      if (p.install.status !== "in-progress") return err("The install hasn't started.");
      const refusal = gate("install-complete");
      if (refusal) return refusal;
      for (const day of p.install.days) {
        if (day.status === "in-progress") {
          day.status = "done";
          day.endedAt = now;
        }
      }
      p.install.status = "complete";
      p.install.completedAt = now;
      log("install-completed", "Installation complete. Next: commissioning checks and your handover.", "field");
      return ok();
    }

    /* ---------------- handover ---------------- */

    case "commissioning-signed": {
      if (p.install.status !== "complete") return err("The install isn't complete yet.");
      if (p.handover.status !== "pending") return err("Commissioning is already signed off.");
      const refusal = qualified("commissioning.sign", "Commissioning sign-off");
      if (refusal) return refusal;
      // The commissioning results must exist (install_jobs.commissioning). Only
      // this rule of the commissioned gate: its auto compliance item
      // (commissioning-approval) is approved by this very step.
      if (!ctx?.commissioning?.signed) {
        const blockers = blockersFor(project, ctx!, "commissioned").filter((b) => b.code === "commissioning-unsigned");
        return err(`Not ready (${GATE_LABEL.commissioned}): record and sign the commissioning results first.`, blockers);
      }
      // As with design approval: the verified signer, not a typed name.
      const signer = staff!.name;
      p.handover.status = "commissioned";
      p.handover.commissionedAt = now;
      p.handover.commissionedBy = signer;
      log("commissioning-signed", `Your system is commissioned: tested, measured and signed off by ${signer}.`, "field", {
        actorName: signer,
      });
      return ok();
    }

    case "handover-pack-published": {
      if (p.handover.status === "pending") return err("Commissioning has to be signed off first.");
      if (!action.documentId) return err("Which document?");
      const republish = Boolean(p.handover.packDocumentId);
      p.handover.packDocumentId = action.documentId;
      log(
        "handover-pack-published",
        republish ? "Your handover pack has been updated." : "Your handover pack is ready in your documents.",
        "field",
      );
      return ok();
    }

    case "handover-signed": {
      if (p.handover.status === "pending") return err("Commissioning has to be signed off first.");
      if (p.handover.status === "handed-over") return err("The handover is already signed.");
      if (!p.handover.packDocumentId) return err("Publish the handover pack first.");
      if (ctx?.runsheet && !ctx.runsheet.walkthroughDone) return err("Finish the customer walkthrough first.");
      const name = action.name.trim();
      if (!name) return err("The customer's name is needed to sign.");
      if (!Number.isInteger(action.snagCount) || action.snagCount < 0) return err("Snag count must be a whole number.");
      if (action.outcome === "snags" && action.snagCount < 1) return err("Record at least one snag, or sign as all good.");
      if (action.outcome === "all-good" && action.snagCount > 0) return err("All good means no snags.");
      p.handover.status = "handed-over";
      p.handover.handedOverAt = now;
      p.handover.signoff = { at: now, name, outcome: action.outcome, snagCount: action.snagCount };
      if (!p.handover.warrantyRegistered) p.handover.warrantyDueOn = addDays(today, WARRANTY_REGISTRATION_DAYS);
      p.aftercare.serviceDueOn = addMonths(today, SERVICE_INTERVAL_MONTHS);
      log(
        "handover-signed",
        action.outcome === "all-good"
          ? `Handover signed off by ${name}. Enjoy it: cool in summer, warm in winter.`
          : `Handover signed by ${name}, with ${action.snagCount} snag${action.snagCount === 1 ? "" : "s"} to fix. Each one has an owner and a date, and you'll see them here.`,
        "customer",
        { actor: "customer", actorName: name },
      );
      return ok();
    }

    case "electrical-cert-updated": {
      if (!["pending", "received", "not-required"].includes(action.status)) return err("Unknown certificate status.");
      if (p.handover.electricalCert === action.status) return err(`The certificate is already marked ${action.status}.`);
      // Never tell the customer it's in their documents unless it is.
      if (action.status === "received" && !action.documentId?.trim()) return err("Add the certificate itself (its file and number) to mark it received.");
      p.handover.electricalCert = action.status;
      if (action.status === "received") {
        p.handover.electricalCertDocumentId = action.documentId!.trim();
        log("electrical-cert-updated", "Your electrical installation certificate is in your documents.", "ops");
      } else {
        delete p.handover.electricalCertDocumentId;
        log("electrical-cert-updated", `Electrical certificate marked ${action.status}.`, "ops", { internal: true });
      }
      return ok();
    }

    case "warranty-registered": {
      if (p.handover.warrantyRegistered) return err("The warranty is already registered.");
      if (!action.documentId?.trim()) return err("Add the registration (its reference, and the confirmation if there is one) to mark the warranty registered.");
      p.handover.warrantyRegistered = true;
      p.handover.warrantyDocumentId = action.documentId.trim();
      log("warranty-registered", "Your manufacturer warranty is registered. The confirmation is in your documents.", "ops");
      return ok();
    }

    /* ---------------- money ---------------- */

    case "invoice-issued": {
      if (!isWholePence(action.amountPence) || action.amountPence === 0) return err("An invoice needs a whole-pence amount.");
      p.money.invoicedPence += action.amountPence;
      log(
        "invoice-issued",
        action.amountPence > 0
          ? `Invoice for ${fmtPence(action.amountPence)} issued. It's in your documents.`
          : `Credit note for ${fmtPence(-action.amountPence)} issued. It's in your documents.`,
        "ops",
      );
      return ok();
    }

    // Only ever dispatched after a verified payment record (webhook or a
    // person recording a bank transfer). A negative amount is a refund.
    case "payment-recorded": {
      if (!isWholePence(action.amountPence) || action.amountPence === 0) return err("A payment needs a whole-pence amount.");
      if (action.paymentId) {
        if (p.money.paymentIds?.includes(action.paymentId)) return err(PAYMENT_ALREADY_COUNTED);
        p.money.paymentIds = [...(p.money.paymentIds ?? []), action.paymentId];
      }
      p.money.paidPence += action.amountPence;
      log(
        "payment-recorded",
        action.amountPence > 0
          ? `Payment of ${fmtPence(action.amountPence)} received. Thank you.`
          : `Refund of ${fmtPence(-action.amountPence)} sent.`,
        "system",
      );
      return ok();
    }

    case "refund-failed": {
      if (!isWholePence(action.amountPence) || action.amountPence <= 0) return err("A failed refund needs its whole-pence amount.");
      const key = `${action.paymentId}:failed`;
      if (p.money.paymentIds?.includes(key)) return err(PAYMENT_ALREADY_COUNTED);
      if (!p.money.paymentIds?.includes(action.paymentId)) return err("That refund was never counted in the project's totals.");
      p.money.paymentIds = [...(p.money.paymentIds ?? []), key];
      p.money.paidPence += action.amountPence;
      log(
        "refund-failed",
        `The refund of ${fmtPence(action.amountPence)} we sent didn't go through at the card provider, so the money hasn't reached you. We'll be in touch to send it again.`,
        "system",
      );
      return ok();
    }

    // Status only, like deposit-paid: the money itself moves through
    // payment-recorded, so a survey fee is never counted twice.
    case "survey-fee-paid": {
      if (!isWholePence(action.amountPence) || action.amountPence <= 0) return err("The survey fee must be a positive amount.");
      if (p.survey.paymentStatus === "paid") return err("The survey fee is already paid.");
      if (p.survey.paymentStatus === "not-required" || p.survey.feeGbp <= 0) return err("There's no survey fee on this project.");
      p.survey.paymentStatus = "paid";
      log("survey-fee-paid", `Survey fee of ${fmtPence(action.amountPence)} received. Thank you.`, "system");
      return ok();
    }

    /* ---------------- customer + aftercare ---------------- */

    case "prep-toggled": {
      const item = p.booking.prep.find((i) => i.id === action.itemId);
      if (!item) return err("Unknown checklist item.");
      if (!item.confirmable) return err("That item is informational.");
      item.done = action.done;
      log("prep-toggled", `Prep: "${item.label}" ${action.done ? "ticked" : "unticked"}.`, "customer", { internal: true });
      return ok();
    }

    case "aftercare-checkin-sent": {
      if (p.aftercare.checkIn7dSentAt) return err("The 7-day check-in has already gone.");
      p.aftercare.checkIn7dSentAt = now;
      log("aftercare-checkin-sent", "7-day check-in sent.", "system", { internal: true });
      return ok();
    }

    case "feedback-requested": {
      if (p.aftercare.feedbackRequestedAt) return err("Feedback has already been requested.");
      p.aftercare.feedbackRequestedAt = now;
      log("feedback-requested", "30-day feedback requested.", "system", { internal: true });
      return ok();
    }

    case "review-requested": {
      if (p.aftercare.reviewRequestedAt) return err("The review request has already gone.");
      p.aftercare.reviewRequestedAt = now;
      log("review-requested", "Review request sent (the same one everyone gets).", "system", { internal: true });
      return ok();
    }

    case "seasonal-check-sent": {
      if (p.aftercare.seasonalCheckSentAt) return err("The change-of-season check has already gone.");
      p.aftercare.seasonalCheckSentAt = now;
      log("seasonal-check-sent", "Change-of-season check sent.", "system", { internal: true });
      return ok();
    }

    case "aftercare-opt-out": {
      if (action.optedOut === Boolean(p.aftercare.followUpsOptedOutAt)) {
        return err(action.optedOut ? "Follow-ups are already off." : "Follow-ups are already on.");
      }
      if (action.optedOut) p.aftercare.followUpsOptedOutAt = now;
      else delete p.aftercare.followUpsOptedOutAt;
      log(
        "aftercare-opt-out",
        action.optedOut
          ? "No more follow-up emails: we'll only contact you about open work, problems or payments."
          : "Follow-up emails are back on.",
        "customer",
      );
      return ok();
    }

    case "feedback-submitted": {
      if (!Number.isInteger(action.score) || action.score < 0 || action.score > 10) return err("Pick a score from 0 to 10.");
      const comments = action.comments?.trim();
      p.aftercare.feedback = { at: now, score: action.score, ...(comments ? { comments } : {}) };
      log("feedback-submitted", "Thanks for your feedback. We read every word.", "customer");
      return ok();
    }

    /* ---------------- admin ---------------- */

    case "set-next-action": {
      const text = action.text.trim();
      if (text) {
        p.nextAction = { text, ...(action.dueOn ? { dueOn: dateOf(action.dueOn) } : {}), ...(action.ownerRole ? { ownerRole: action.ownerRole } : {}) };
      } else {
        delete p.nextAction;
      }
      log("next-action-set", text ? `Next action: ${text}` : "Next action cleared.", "ops", { internal: true });
      return ok();
    }

    case "set-pilot": {
      if (!Number.isInteger(action.number) || action.number < 1) return err("Pilot number must be 1 or more.");
      if (!action.label.trim()) return err("Give the pilot a label.");
      p.pilot = { number: action.number, label: action.label.trim() };
      log("pilot-set", `Tagged as pilot ${action.number} (${p.pilot.label}).`, "ops", { internal: true });
      return ok();
    }

    case "set-owner": {
      const staffId = action.staffId.trim();
      const name = action.name.trim();
      if (!staffId) {
        if (!p.owner) return err("The project has no owner to clear.");
        delete p.owner;
        log("owner-set", "Project owner cleared.", "ops", { internal: true });
        return ok();
      }
      if (!name) return err("Pick who owns the project.");
      if (p.owner?.staffId === staffId && p.owner.name === name) return err(`${name} already owns this project.`);
      p.owner = { staffId, name };
      log("owner-set", `Project owner: ${name}.`, "ops", { internal: true });
      return ok();
    }

    case "set-customer-contact": {
      const before = { ...p.customer };
      // The household's identity on every document: corrected, never blanked.
      const identity = { name: action.name, addressLine: action.addressLine, postcode: action.postcode };
      const blank = { name: "The customer's name", addressLine: "The first line of the address", postcode: "The postcode" } as const;
      for (const [key, value] of Object.entries(identity) as [keyof typeof identity, string | undefined][]) {
        if (value !== undefined && !value.replace(/\s+/g, " ").trim()) return err(`${blank[key]} can't be blank.`);
      }
      let changed = false;
      for (const [key, value] of Object.entries(identity) as [keyof typeof identity, string | undefined][]) {
        if (value === undefined) continue;
        p.customer[key] = value.replace(/\s+/g, " ").trim();
        changed = true;
      }
      const patch = { email: action.email, phone: action.phone, accessNotes: action.accessNotes, parkingNotes: action.parkingNotes };
      for (const [key, value] of Object.entries(patch) as [keyof typeof patch, string | undefined][]) {
        if (value === undefined) continue;
        const v = value.trim();
        if (v) p.customer[key] = v;
        else delete p.customer[key];
        changed = true;
      }
      if (!changed) return err("Nothing to update.");
      log("customer-contact-updated", "Contact and access details updated.", "customer", { internal: true });
      const corrected = (["name", "addressLine", "postcode"] as const).filter((k) => before[k] !== p.customer[k]);
      if (corrected.length) {
        const words = { name: "name", addressLine: "address", postcode: "postcode" } as const;
        log(
          "customer-details-corrected",
          `Customer ${corrected.map((k) => words[k]).join(", ")} corrected: ${corrected.map((k) => `"${before[k] || "-"}" to "${p.customer[k]}"`).join("; ")}. Documents already issued keep the details they were issued with.`,
          "ops",
          { internal: true },
        );
      }
      // The pre-contract information counts only where it reached the
      // customer: a proposal email that went to an address since changed
      // reached someone else (or nobody), so before acceptance it no longer
      // counts. Acceptance waits until it has gone to the new address (Send
      // again on the proposal email), and the documents-by-email agreement
      // has to cover the new address too (proposal-accept gate).
      const addr = (e: string | undefined) => (e ?? "").trim().toLowerCase();
      const open = p.proposal.status === "issued" || p.proposal.status === "changes-requested";
      if (open && addr(before.email) !== addr(p.customer.email) && p.proposal.preContractInfoSentAt) {
        delete p.proposal.preContractInfoSentAt;
        log(
          "pre-contract-info-reset",
          `The proposal email went to ${before.email || "the old address"}, not ${p.customer.email || "a current address"}, so it no longer counts as their pre-contract information. ${
            p.customer.email
              ? `Once they've agreed to documents at ${p.customer.email}, press Send again on the proposal email in Messages: they can accept once it has gone.`
              : "Add their email, then send the proposal email again."
          }`,
          "ops",
          { internal: true },
        );
      }
      return ok();
    }

    case "project-closed": {
      const cancelled = action.reason === "cancelled";
      if (!cancelled) {
        const refusal = gate("closed");
        if (refusal) return refusal;
      }
      p.closure = { closed: true, closedAt: now, ...(action.reason ? { reason: action.reason } : {}) };
      log(
        "project-closed",
        cancelled ? "Project cancelled." : "All wrapped up. Thanks for having us, and we're still here if you need anything.",
        "ops",
      );
      return ok();
    }

    case "cancellation-received": {
      if (p.proposal.status !== "accepted") return err("There's no contract to cancel: an open proposal is simply declined.");
      if (!CANCELLATION_CHANNELS.includes(action.channel)) return err("How did the customer tell us?");
      const evidenceRef = action.evidenceRef.trim();
      if (evidenceRef.length < 3) return err("Say where the cancellation is on file (the email's date and subject, the letter, or the call note).");
      const received = Date.parse(action.receivedAt);
      if (!Number.isFinite(received)) return err("When did the cancellation reach us?");
      if (received > Date.parse(now) + 5 * 60_000) return err("A cancellation can't be recorded for a time that hasn't happened yet.");
      if (p.proposal.acceptedAt && received < Date.parse(p.proposal.acceptedAt)) return err("That's before the contract was made.");
      const receivedOn = londonDateOf(new Date(received).toISOString());
      const cs = cancellationStatus(p, receivedOn, settings);
      p.cancellation = {
        receivedAt: new Date(received).toISOString(),
        channel: action.channel,
        evidenceRef,
        recordedAt: now,
        ...(staff?.name ? { recordedBy: staff.name } : {}),
        withinPeriod: !cs.ended,
        refundDueBy: addDays(receivedOn, 14),
      };
      p.closure = { closed: true, closedAt: now, reason: "cancelled" };
      log(
        "cancellation-received",
        p.cancellation.withinPeriod
          ? `We received your cancellation on ${fmtDate(receivedOn)}. Your contract is cancelled. Any refund is due by ${fmtDate(p.cancellation.refundDueBy)}.`
          : // After the period there's no statutory refund to promise: an acknowledgement, and we're in touch.
            `We received your cancellation on ${fmtDate(receivedOn)}, after your cancellation period had ended. We'll be in touch in writing about what happens next.`,
        "ops",
      );
      return ok();
    }

    case "cancellation-charge-recorded": {
      if (!staff) return err("Recording a charge needs a signed-in staff member.");
      const held = p.cancellation?.charge;
      // The same form again (a double click, a retry): already done.
      if (held && action.requestId && held.requestId === action.requestId) return ok();
      const problem = cancellationChargeProblem(p, action);
      if (problem) return err(problem);
      const basis = action.basis.trim();
      p.cancellation = {
        ...p.cancellation!,
        charge: {
          amountPence: action.amountPence,
          basis,
          recordedAt: now,
          recordedBy: staff.name,
          ...(action.requestId ? { requestId: action.requestId } : {}),
        },
      };
      const s = cancellationSettlement(p)!;
      log(
        "cancellation-charge-recorded",
        `The charge for the work done before you cancelled is ${fmtPence(s.chargePence)}. ${
          s.refundDuePence > 0
            ? `You've paid ${fmtPence(s.paidPence)}, so we'll refund ${fmtPence(s.refundDuePence)} by ${fmtDate(p.cancellation.refundDueBy)}, the same way you paid.`
            : s.owedPence > 0
              ? `You've paid ${fmtPence(s.paidPence)}, so ${fmtPence(s.owedPence)} is left to pay.`
              : "What you've paid covers it exactly, so there's nothing to refund."
        }`,
        "ops",
      );
      return ok();
    }

    case "cancellation-charge-credited": {
      const charge = p.cancellation?.charge;
      if (!charge) return err("There's no charge for work done on this project.");
      if (charge.creditNoteIds?.includes(action.creditNoteId)) return ok(); // counted already
      if (!isWholePence(action.amountPence) || action.amountPence <= 0) return err("A credit needs a whole-pence amount.");
      if (action.amountPence > charge.amountPence) return err(`That's more than the charge (${fmtPence(charge.amountPence)}).`);
      p.cancellation = {
        ...p.cancellation!,
        charge: {
          ...charge,
          amountPence: charge.amountPence - action.amountPence,
          creditedPence: (charge.creditedPence ?? 0) + action.amountPence,
          creditNoteIds: [...(charge.creditNoteIds ?? []), action.creditNoteId],
        },
      };
      const s = cancellationSettlement(p)!;
      log(
        "cancellation-charge-credited",
        `We've taken ${fmtPence(action.amountPence)} off the charge for the work done: it's now ${fmtPence(s.chargePence)}. ${
          s.refundDuePence > 0
            ? `You've paid ${fmtPence(s.paidPence)}, so we'll refund ${fmtPence(s.refundDuePence)}.`
            : s.owedPence > 0
              ? `${fmtPence(s.owedPence)} is left to pay.`
              : "There's nothing more to pay or refund."
        }`,
        "ops",
      );
      return ok();
    }

    case "note": {
      const text = action.text.trim();
      if (!text) return err("Write something first.");
      log("note", text, "ops", { internal: true });
      return ok();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * The first install start date `install-dates-set` will accept, for date
 * pickers (portal and calendar): at least INSTALL_LEAD_DAYS away, after the
 * cancellation period unless the customer asked in writing to start early,
 * and on a working day. The period includes its last day
 * (`cancellationEndsOn`), so work can start the day after.
 */
export function earliestInstallStart(project: Project, todayIso: string, settings: PilotSettings = DEFAULT_SETTINGS): string {
  let earliest = addDays(dateOf(todayIso), INSTALL_LEAD_DAYS);
  const ends = cancellationStatus(project, todayIso, settings).endsOn;
  if (ends && !earlyStartRequestedOf(project)) earliest = laterOf(earliest, addDays(ends, 1));
  return nextWorkingDay(earliest, settings.scheduling.workingDays);
}

/**
 * Does this project's cancellation period still wait on the kit reaching the
 * customer's home? supply-and-install, no early-start request, and no
 * delivery recorded yet: then day 1 must come after delivery plus the
 * cancellation days (the period includes its last day).
 */
function periodWaitsOnDelivery(project: Project): boolean {
  const pr = project.proposal;
  return pr.contractType !== "install-only" && !earlyStartRequestedOf(project) && !pr.goodsReceivedOn;
}

/**
 * The last day the kit can reach the customer's home for an install that
 * starts `start` to clear ready-to-install without an early-start request:
 * `start` less the cancellation days less one. Undefined when the period
 * doesn't wait on delivery (install-only, an early-start request, or the
 * delivery already recorded). Kit dates (purchasing's poSchedule) and the
 * booking warning use it.
 */
export function goodsDeliverBy(project: Project, start: string, settings: PilotSettings = DEFAULT_SETTINGS): string | undefined {
  if (!periodWaitsOnDelivery(project) || !/^\d{4}-\d{2}-\d{2}/.test(start)) return undefined;
  return addDays(dateOf(start), -(settings.scheduling.cancellationDays + 1));
}

/**
 * The first install start that can actually clear the cancellation period:
 * earliestInstallStart, and, while the period waits on delivery, the
 * cancellation days after the earliest the kit can reach the customer's home
 * (`kitArrivesOn`: from the orders, see purchasing's earliestKitArrival;
 * never before tomorrow, the default). The portal offers nothing earlier,
 * and neither the reducer nor the ops booking page accepts it.
 */
export function earliestStartForKit(
  project: Project,
  todayIso: string,
  settings: PilotSettings = DEFAULT_SETTINGS,
  kitArrivesOn?: string,
): string {
  const base = earliestInstallStart(project, todayIso, settings);
  if (!periodWaitsOnDelivery(project)) return base;
  const tomorrow = addDays(dateOf(todayIso), 1);
  const arrival = kitArrivesOn && /^\d{4}-\d{2}-\d{2}/.test(kitArrivesOn) ? laterOf(dateOf(kitArrivesOn), tomorrow) : tomorrow;
  const floor = nextWorkingDay(addDays(arrival, settings.scheduling.cancellationDays + 1), settings.scheduling.workingDays);
  return laterOf(base, floor);
}

/* ------------------------------------------------------------------ */
/* Cancellation period + early start                                  */
/* ------------------------------------------------------------------ */

/**
 * Shown to ops beside anything that relies on the cancellation rules below,
 * until a solicitor has confirmed them.
 */
export const CANCELLATION_RULE_STATUS =
  "Legal review required: supply-and-install is treated as a sales contract (cancellation period from delivery of the goods), install-only as a service contract (from acceptance).";

/** Did the customer ask to start inside the cancellation period? (Older snapshots only have the boolean.) */
export function earlyStartRequestedOf(project: Project): boolean {
  return project.proposal.earlyStart?.requested ?? project.proposal.earlyStartRequested ?? false;
}

/* ------------------------------------------------------------------ */
/* The charge for work done before a cancellation (CCR reg 36(4)-(6))  */
/* ------------------------------------------------------------------ */

/** The basis is printed for the family: say what was done and how it compares with the whole job. */
export const CANCELLATION_CHARGE_BASIS_MIN = 20;
export const CANCELLATION_CHARGE_BASIS_MAX = 1000;
/** The family's next step while part of the charge is unpaid. */
export const CANCELLATION_CHARGE_PAY_LABEL = "Pay for the work done before you cancelled";

/** Did any install day start before the cancellation reached us? Only then was any service supplied. */
export function workDoneBeforeCancellation(p: Pick<Project, "install" | "cancellation">): boolean {
  const at = p.cancellation ? Date.parse(p.cancellation.receivedAt) : NaN;
  if (!Number.isFinite(at)) return false;
  return p.install.days.some((d) => d.startedAt !== undefined && Date.parse(d.startedAt) <= at);
}

/**
 * Why the office can't charge for work done before this cancellation, or
 * null when it can (LEGAL REVIEW REQUIRED: our reading of CCR 2013 reg 36,
 * docs/research/uk-consumer-legal.md, not legal advice):
 *  * only a cancellation inside the period: after it, the contract's own
 *    terms apply, not reg 36 (the late-cancellation review task);
 *  * only after the family's express request to start early, on a durable
 *    medium, in the words we gave them, which say they'll pay for the work
 *    done if they then cancel (`earlyStart.evidencedAt`; reg 36(1), (6)(b));
 *  * only when the cancellation information, including that, went before
 *    the contract (`preContractInfoSentAt`; reg 36(6)(a));
 *  * only for work actually done before the cancellation reached us (an
 *    install day started by then);
 *  * once; a whole-pence amount above zero and never more than the contract
 *    total; and a written basis, which the family sees.
 */
export function cancellationChargeProblem(
  p: Pick<Project, "cancellation" | "proposal" | "install" | "money">,
  input: { amountPence: number; basis: string },
): string | null {
  const c = p.cancellation;
  if (!c) return "There's no cancellation recorded on this project.";
  if (c.charge) return `A charge for the work done is already recorded (${fmtPence(c.charge.amountPence)}). To bring it down, credit its invoice (Reduce the charge) and explain why in writing.`;
  if (!c.withinPeriod) {
    return "The cancellation reached us after the cancellation period ended, so this isn't a charge for work done under the cancellation rules: the contract's own terms apply. Take advice (see the late-cancellation task).";
  }
  const early = p.proposal.earlyStart;
  if (!(early?.requested ?? p.proposal.earlyStartRequested) || !early?.evidencedAt) {
    return "Nothing can be charged: there's no evidenced request from them to start early (their email or signed form, recorded on the booking page). Without it they owe nothing for the work (CCR reg 36(6)).";
  }
  if (!p.proposal.preContractInfoSentAt) {
    return "Nothing can be charged: the cancellation information wasn't sent to them before the contract, so they owe nothing for the work (CCR reg 36(6)).";
  }
  if (!workDoneBeforeCancellation(p)) return "No install day had started when the cancellation reached us, so no work was done to charge for.";
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) return "Enter the charge in pounds and pence, above zero.";
  const contract = p.proposal.contractTotalPence ?? p.money.contractTotalPence ?? 0;
  if (input.amountPence > contract) return `That's more than the contract total (${fmtPence(contract)}): the charge can only be for part of it.`;
  const basis = (input.basis ?? "").trim();
  if (basis.length < CANCELLATION_CHARGE_BASIS_MIN) {
    return "Write how you worked it out (what was done before they cancelled, and how that compares with the whole job): it's printed on the invoice and in their email.";
  }
  if (basis.length > CANCELLATION_CHARGE_BASIS_MAX) return `Keep the basis to ${CANCELLATION_CHARGE_BASIS_MAX} characters.`;
  return null;
}

/**
 * The money after a cancellation with a charge for work done: the charge,
 * what they've paid us (net of refunds so far), and the difference, either
 * to refund (by the cancellation's 14-day date, the same way they paid) or
 * left for them to pay. Null without a charge. The hub, the pay page, the
 * email and the money page all show these numbers.
 */
export function cancellationSettlement(p: Pick<Project, "cancellation" | "money">): {
  chargePence: number;
  basis: string;
  paidPence: number;
  refundDuePence: number;
  owedPence: number;
  refundDueBy: string;
} | null {
  const c = p.cancellation;
  if (!c?.charge) return null;
  const paidPence = Math.max(0, p.money.paidPence);
  const chargePence = c.charge.amountPence;
  return {
    chargePence,
    basis: c.charge.basis,
    paidPence,
    refundDuePence: Math.max(0, paidPence - chargePence),
    owedPence: Math.max(0, chargePence - paidPence),
    refundDueBy: c.refundDueBy,
  };
}

export interface CancellationStatus {
  /** True only once the last day of the period has passed. Unknown is never ended. */
  ended: boolean;
  /** The last day of the period (inclusive), once it can be known. */
  endsOn?: string;
  basis: "acceptance" | "goods-delivery" | "unknown";
  /** An early-start request that's on a durable medium (reg 36(1)(b)). */
  earlyStartEvidenced: boolean;
}

/**
 * Where the customer's cancellation period stands (CCR 2013 regs 29–31).
 *
 * LEGAL REVIEW REQUIRED. Our reading of the research (docs/research/
 * uk-consumer-legal.md §1.2, §1.5), not legal advice:
 *  * install-only is a service contract: the period ends at the end of
 *    `cancellationDays` days after the day of acceptance (reg 30(2)).
 *  * supply-and-install "has both goods and services as its object", so it's
 *    a sales contract: the period ends `cancellationDays` days after the last
 *    of the goods comes into the customer's possession (reg 30(3)–(4)). Until
 *    the kit is recorded as fully delivered, the end isn't known and the
 *    period has NOT ended. Kit delivered to the customer's home starts it
 *    at delivery (kit-updated); kit delivered to our storage, the installer
 *    or a subcontractor comes into their possession with the crew, so it
 *    starts on install day 1 (and the install can only start then on their
 *    express early-start request).
 *  * Reg 31: if the cancellation information wasn't given before the
 *    contract (the proposal issue email), the period runs until 14 days after
 *    it was given (the confirmation email), or 12 months past the normal end
 *    if it never was. We take the later date, the conservative reading.
 * Day 0 is the contract (or delivery) day; the end date itself is inside the
 * period, so `ended` turns true the day after.
 */
export function cancellationStatus(
  project: Project,
  todayIso: string,
  settings: PilotSettings = DEFAULT_SETTINGS,
): CancellationStatus {
  const pr = project.proposal;
  const earlyStartEvidenced = Boolean(earlyStartRequestedOf(project) && pr.earlyStart?.evidencedAt);
  if (pr.status !== "accepted" || !pr.acceptedAt) return { ended: false, basis: "unknown", earlyStartEvidenced };

  const days = settings.scheduling.cancellationDays;
  const acceptedOn = dateOf(pr.acceptedAt);
  const basis: CancellationStatus["basis"] = pr.contractType === "install-only" ? "acceptance" : "goods-delivery";
  // A supply-and-install end date only counts once it came from the goods
  // (an older snapshot may hold an acceptance-based one).
  let endsOn: string | undefined =
    basis === "acceptance"
      ? (pr.cancellationEndsOn ?? addDays(acceptedOn, days))
      : pr.goodsReceivedOn
        ? (pr.cancellationEndsOn ?? laterOf(addDays(pr.goodsReceivedOn, days), addDays(acceptedOn, days)))
        : undefined;

  const infoBeforeContract = Boolean(pr.preContractInfoSentAt && pr.preContractInfoSentAt <= pr.acceptedAt);
  if (endsOn && !infoBeforeContract) {
    endsOn = pr.confirmationSentAt
      ? laterOf(endsOn, addDays(dateOf(pr.confirmationSentAt), days))
      : addMonths(endsOn, 12);
  }

  const today = dateOf(todayIso);
  return {
    ended: Boolean(endsOn && today && today > endsOn),
    ...(endsOn ? { endsOn } : {}),
    basis,
    earlyStartEvidenced,
  };
}

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Tuesday 10 November 2026": contract dates carry the year. */
const fmtDateFull = (iso: string) => {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  return `${DAY_FULL[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/**
 * The customer's cancellation position in one plain-English sentence, for
 * the portal, the stage copy and the contract emails. Never hard-codes the
 * day count or the start point: both come from settings and the contract type.
 *
 * LEGAL REVIEW REQUIRED: the wording follows the rule in cancellationStatus,
 * which a solicitor hasn't confirmed yet. With `today`, an ended period says so.
 */
export function cancellationCopy(project: Project, opts: { settings?: PilotSettings; today?: string } = {}): string {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const accepted = project.proposal.status === "accepted";
  const cs = cancellationStatus(project, opts.today ?? "", settings);
  return cancellationSentence(
    { accepted, contractType: project.proposal.contractType, ...(cs.endsOn ? { endsOn: cs.endsOn } : {}), ended: cs.ended },
    settings.scheduling.cancellationDays,
  );
}

/**
 * The sentence behind cancellationCopy, from the facts alone, for callers
 * that hold a message's data rather than the project (email templates).
 * LEGAL REVIEW REQUIRED, as cancellationCopy.
 */
export function cancellationSentence(
  input: { accepted: boolean; contractType?: ContractType; endsOn?: string; ended?: boolean },
  cancellationDays: number,
): string {
  const days = cancellationDays;
  const supply = input.contractType !== "install-only";
  if (!input.accepted) {
    return supply
      ? `If you accept, you can cancel without giving a reason until ${days} days after the day your equipment is delivered to you.`
      : `If you accept, you can cancel without giving a reason within ${days} days of the day you accept.`;
  }
  if (input.endsOn && input.ended) return `Your cancellation period ended on ${fmtDateFull(input.endsOn)}.`;
  if (input.endsOn) return `You can cancel without giving a reason until the end of ${fmtDateFull(input.endsOn)}.`;
  return supply
    ? `Because we're supplying your equipment, you can cancel without giving a reason until ${days} days after the day it's delivered to you. We'll tell you the exact date when it arrives.`
    : `You can cancel without giving a reason within ${days} days of the day you accepted.`;
}

const normalisedAddress = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * Why this early-start evidence can't go on file, or null when it can. The
 * request is the customer's own, made on a durable medium, so: the copy is
 * attached; it reached us on or after the day they accepted (they're asked
 * to reply to the contract email) and not in the future; an email came from
 * the address on the contract; and it uses the wording they were asked to
 * use (`EARLY_START_WORDING_VERSION` when they accepted).
 */
export function earlyStartEvidenceProblem(
  p: Pick<Project, "customer" | "proposal">,
  e: { channel: "email" | "paper"; mediaIds: readonly string[]; receivedOn: string; fromAddress?: string; wordingVersion: string },
  today: string,
): string | null {
  if (!Array.isArray(e.mediaIds) || e.mediaIds.filter((m) => typeof m === "string" && m.trim()).length === 0) {
    return e.channel === "email"
      ? "Attach their email (saved as a PDF, or a screenshot showing who it's from and when)."
      : "Attach the signed form (a scan or a photo of it).";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.receivedOn ?? "") || Number.isNaN(Date.parse(`${e.receivedOn}T12:00:00Z`))) return "When did it reach us? Pick the date.";
  if (e.receivedOn > today) return "That date is in the future.";
  const accepted = p.proposal.acceptedAt ? londonDateOf(p.proposal.acceptedAt) : null;
  if (accepted && e.receivedOn < accepted) {
    return `That's before they accepted the contract (${fmtDate(accepted)}). The request has to come with or after their acceptance: ask them to reply to the contract email.`;
  }
  if (e.channel === "email") {
    const on = normalisedAddress(p.customer.email);
    if (!on) return "There's no email address on the contract to check it against. Add theirs to the project first.";
    if (normalisedAddress(e.fromAddress) !== on) {
      return `It has to come from the address on the contract (${on}). If they've changed address, update their contact details first; otherwise ask them to reply from it, or use a signed form.`;
    }
  }
  const asked = p.proposal.earlyStart?.wordingVersion ?? EARLY_START_WORDING_VERSION;
  if (e.wordingVersion !== asked) return "Check it asks us to start before the cancellation period ends, in the words we gave them, and tick that it does.";
  return null;
}

/** Bump whenever earlyStartWording changes: the project records the version the customer was asked to use. */
export const EARLY_START_WORDING_VERSION = "early-start-v1";

/**
 * The words a customer sends (replying to the confirmation email, or on a
 * signed form) to make the express early-start request on a durable medium
 * (CCR reg 36(1)). NEEDS SOLICITOR REVIEW.
 *
 * The loss-of-right sentence is only for install-only: reg 36(2) ends the
 * right to cancel only for a service contract fully performed, so saying it
 * on a supply-and-install (sales) contract would mislead.
 */
export function earlyStartWording(contractType: ContractType): string {
  const base =
    "Please start my installation before my cancellation period ends. I understand that if I then cancel, I will pay for the work done up to the time I tell you.";
  return contractType === "install-only"
    ? `${base} I understand that I will lose my right to cancel once the work has been fully completed.`
    : base;
}

/** Waiting on the customer's durable early-start request, while it still matters. */
function earlyStartReplyNeeded(project: Project): boolean {
  const pr = project.proposal;
  return (
    pr.status === "accepted" &&
    earlyStartRequestedOf(project) &&
    !pr.earlyStart?.evidencedAt &&
    Boolean(pr.confirmationSentAt) &&
    project.install.status === "not-started"
  );
}

/* ------------------------------------------------------------------ */
/* Aftercare timing (the daily-ops cron asks these)                   */
/* ------------------------------------------------------------------ */

/** The review request: a week after the 30-day feedback, so the two never travel together. */
export const REVIEW_REQUEST_DAYS = 37;
/** A change-of-season check never lands within this many days of handover. */
export const SEASONAL_CHECK_MIN_DAYS = 28;

const handoverDay = (p: Project) => (p.handover.handedOverAt ? dateOf(p.handover.handedOverAt) : null);
const followUpsAllowed = (p: Project) => p.closure.reason !== "cancelled" && !p.aftercare.followUpsOptedOutAt;

/**
 * Is the review request due? The same rule for everyone (DMCC Act 2024
 * Sch 20 para 13): handed over at least REVIEW_REQUEST_DAYS ago, with the
 * paperwork done (electrical certificate and warranty registration), a
 * review link in settings, follow-ups not refused, and not already asked.
 * It never looks at the feedback score: no review gating.
 */
export function reviewRequestDue(project: Project, todayIso: string, settings: PilotSettings): boolean {
  const p = project;
  const handed = handoverDay(p);
  if (!settings.company.reviewUrl || !handed || p.handover.status !== "handed-over") return false;
  if (!followUpsAllowed(p) || p.aftercare.reviewRequestedAt) return false;
  if (p.handover.electricalCert === "pending" || !p.handover.warrantyRegistered) return false;
  return daysBetween(handed, todayIso) >= REVIEW_REQUEST_DAYS;
}

/**
 * The first change of season after handover, and the mode the customer is
 * about to use for the first time: after a spring or summer handover (April
 * to September), heating from 1 October; after an autumn or winter one,
 * cooling from 1 June. Never within SEASONAL_CHECK_MIN_DAYS of handover.
 * A calendar rule, not a weather feed: ops can send it by hand sooner.
 */
export function seasonalCheck(project: Project): { on: string; mode: "heating" | "cooling" } | null {
  const handed = handoverDay(project);
  if (!handed) return null;
  const [y, m] = handed.split("-").map(Number) as [number, number];
  const warmHalf = m >= 4 && m <= 9;
  const boundary = warmHalf ? `${y}-10-01` : `${m >= 10 ? y + 1 : y}-06-01`;
  return { on: laterOf(boundary, addDays(handed, SEASONAL_CHECK_MIN_DAYS)), mode: warmHalf ? "heating" : "cooling" };
}

/** Is the change-of-season check due today? Once, after handover, unless follow-ups were refused. */
export function seasonalCheckDue(project: Project, todayIso: string): boolean {
  const check = seasonalCheck(project);
  if (!check || project.handover.status !== "handed-over") return false;
  if (!followUpsAllowed(project) || project.aftercare.seasonalCheckSentAt) return false;
  return dateOf(todayIso) >= check.on;
}

/** Date-change fees accrued so far, plus the survey fee state, for the balance strip. */
export function projectFees(project: Project): { changeFeesGbp: number; surveyPaidGbp: number } {
  return {
    changeFeesGbp: project.survey.rescheduleFeesGbp + project.booking.rescheduleFeesGbp,
    surveyPaidGbp: project.survey.paymentStatus === "paid" ? project.survey.feeGbp : 0,
  };
}

/** What the next step needs to know about an issue: the customer's hub copy (HubIssue) and the stored Issue both fit. */
export interface NextActionIssue {
  kind: IssueKind;
  status: IssueStatus;
  /** Absent on the hub's copy, which only ever holds customer-visible issues. */
  customerVisible?: boolean;
  variation?: { status: VariationStatus; totalDeltaPence: number };
}

/** The next-step labels for changes waiting on the customer (one, or several). */
export const VARIATION_ANSWER_LABEL = "Answer a change to your installation";
export const VARIATIONS_ANSWER_LABEL = "Answer the changes to your installation";

/**
 * The changes the office has sent the customer that still wait for their
 * yes or no: customer-visible, proposed, still open. Exactly the ones the
 * hub's Install panel asks them to answer.
 */
export function variationsAwaitingCustomer<T extends NextActionIssue>(issues: readonly T[]): T[] {
  return issues.filter(
    (i) =>
      i.kind === "variation" &&
      i.customerVisible !== false &&
      i.variation?.status === "proposed" &&
      (i.status === "open" || i.status === "in-progress" || i.status === "awaiting-customer"),
  );
}

/**
 * The ONE thing the customer should do now, or null when the ball is in our
 * court. Every customer screen leads with this. `issues` are the project's
 * customer-visible issues: a change sent for their OK lives there, not on
 * the snapshot, and it comes first (the crew is waiting on the answer, and
 * the email and text already told them it needs their OK).
 */
export function customerNextAction(project: Project, issues: readonly NextActionIssue[] = []): { label: string; href?: string } | null {
  const p = project;
  const base = `/p/${p.id}`;
  const feedbackDue = Boolean(p.aftercare.feedbackRequestedAt) && !p.aftercare.feedback;

  if (p.closure.closed) {
    // Cancelled after an early start: what's left of the charge for the work done is theirs to pay (reg 36(4)).
    if ((cancellationSettlement(p)?.owedPence ?? 0) > 0) return { label: CANCELLATION_CHARGE_PAY_LABEL, href: `${base}/pay` };
    return p.closure.reason !== "cancelled" && feedbackDue
      ? { label: "Tell us how it's going", href: `${base}#aftercare` }
      : null;
  }

  const changes = variationsAwaitingCustomer(issues);
  if (changes.length) {
    return { label: changes.length === 1 ? VARIATION_ANSWER_LABEL : VARIATIONS_ANSWER_LABEL, href: `${base}#install` };
  }

  // Time-limited or money first: these hold everything else up.
  if (p.proposal.status === "issued") return { label: "Review your proposal", href: `${base}/proposal` };
  if (p.booking.depositStatus === "requested") return { label: "Pay your deposit", href: `${base}/pay` };
  // Picking install dates comes before any other invoice: nothing else holds the booking up,
  // and the balance isn't due under the contract until the installation is finished.
  const needsDates = p.proposal.status === "accepted" && p.install.status === "not-started" && p.booking.dates.length === 0 && currentStage(p) === "booking";
  if (p.money.invoicedPence > p.money.paidPence && !needsDates) {
    return {
      label: p.install.status === "complete" ? "Pay your balance" : "Pay your invoice",
      href: `${base}/pay`,
    };
  }

  switch (currentStage(p)) {
    case "price":
      return { label: "Book your home survey", href: `${base}#survey` };
    case "survey":
      return p.survey.status === "booked" ? { label: "Get ready for your survey", href: `${base}#survey` } : null;
    case "proposal":
      if (p.proposal.status === "expired" || p.proposal.status === "declined") {
        return { label: "Ask us for an updated proposal", href: `${base}/proposal` };
      }
      // The proposal can't be sent until they've agreed to email delivery.
      if (p.survey.status === "submitted" && !documentsConsentCovers(p)) {
        return { label: "Agree to get your documents by email", href: `${base}#proposal` };
      }
      return null; // designing, or revising after a change request
    case "booking":
      if (p.booking.dates.length === 0) return { label: "Choose your install dates", href: `${base}#booking` };
      return earlyStartReplyNeeded(p) ? { label: "Reply to confirm your early start", href: `${base}#booking` } : null;
    case "kit":
    case "install":
      if (earlyStartReplyNeeded(p)) return { label: "Reply to confirm your early start", href: `${base}#booking` };
      if (p.install.status === "not-started" && p.booking.prep.some((i) => i.confirmable && !i.done)) {
        return { label: "Get your home ready", href: `${base}#booking` };
      }
      return null;
    case "handover":
      return p.handover.packDocumentId ? { label: "Check your handover pack", href: `${base}#handover` } : null;
    case "aftercare":
      if (feedbackDue) return { label: "Tell us how it's going", href: `${base}#aftercare` };
      return p.handover.packDocumentId ? { label: "Check your handover pack", href: `${base}#handover` } : null;
  }
}
