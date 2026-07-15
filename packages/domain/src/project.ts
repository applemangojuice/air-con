import type {
  ConfidenceBand,
  ElectricsCondition,
  QuoteResult,
  Survey,
} from "./types.ts";
import { getArchetype, getPermutation } from "./archetypes.ts";

/**
 * The project workflow — everything that happens after the instant quote.
 *
 * A project is the customer's whole journey on one horizontal timeline:
 *
 *   quote → floor plan → final quote → site visit → delivery → installation
 *
 * Design rules (mirroring the quote engine):
 *  * The Project is a plain JSON snapshot — it persists to JSONB as-is and
 *    crosses the wire to web and mobile unchanged.
 *  * Every transition goes through `applyProjectAction`, a pure reducer.
 *    The API route runs it server-side (the authority); demo mode runs the
 *    same reducer client-side, so the whole journey works with no database.
 *  * Dates, fees and SLAs are deterministic functions, never copy scattered
 *    through the UI.
 */

/* ------------------------------------------------------------------ */
/* Stages                                                             */
/* ------------------------------------------------------------------ */

export const PROJECT_STAGES = [
  "quote",
  "floor-plan",
  "final-quote",
  "site-visit",
  "delivery",
  "installation",
] as const;

export type ProjectStageId = (typeof PROJECT_STAGES)[number];

export interface StageInfo {
  id: ProjectStageId;
  /** Short label on the timeline node. */
  label: string;
  title: string;
  /** One-liner under the title on the stage page. */
  strap: string;
  /** "What happens here" — shown even when the stage is greyed out in the future. */
  explainer: string[];
}

export const STAGE_INFO: Record<ProjectStageId, StageInfo> = {
  quote: {
    id: "quote",
    label: "Quote",
    title: "Your instant quote",
    strap: "A fixed price from your own survey — no salesperson, no callbacks.",
    explainer: [
      "You told us about your home and rooms; our engine priced the installation on the spot.",
      "The price is fixed once your photos are reviewed — it can go down, never up, unless the scope changes.",
      "Everything after this step happens on this timeline.",
    ],
  },
  "floor-plan": {
    id: "floor-plan",
    label: "Floor plan",
    title: "Your floor plan & system design",
    strap: "Where every unit goes and how the pipework runs — approve it or ask for changes.",
    explainer: [
      "Because we only install proven layouts for your house type, your floor plan is ready immediately — no waiting for a designer.",
      "It shows each indoor unit position, the outdoor unit location and the pipe route.",
      "Approving the plan moves you to your final quote. You can still change your mind at the site visit.",
    ],
  },
  "final-quote": {
    id: "final-quote",
    label: "Final quote",
    title: "Your final fixed quote",
    strap: "The number that goes in writing — locked against your approved floor plan.",
    explainer: [
      "We review your photos and floor plan, then issue the final fixed price.",
      "If your survey was complete, this is issued instantly at the same price as your instant quote.",
      "Accepting the final quote unlocks site-visit booking. Nothing is payable yet.",
    ],
  },
  "site-visit": {
    id: "site-visit",
    label: "Site visit",
    title: "Your site visit",
    strap: "One hour with our founder to validate everything before we build.",
    explainer: [
      "Every installation is preceded by exactly one site visit — it is the gate to installation day.",
      "We walk your floor plan room by room, confirm the outdoor unit position, and pin down the electrical connection.",
      "It runs as a video call by default, or in person where needed. The £150 fee comes off your installation price.",
    ],
  },
  delivery: {
    id: "delivery",
    label: "Delivery",
    title: "Equipment delivery",
    strap: "Everything ships to you by courier ahead of installation day — tracked here.",
    explainer: [
      "Rather than vans carrying stock, your exact equipment is pre-shipped by courier a couple of days before installation.",
      "You'll see the courier, tracking reference and a live event feed on this page.",
      "The boxes are heavy but boxed and safe — leave them where they land; our installer handles the rest.",
    ],
  },
  installation: {
    id: "installation",
    label: "Installation",
    title: "Installation day",
    strap: "Meet your installer, see the plan for the day, and get your home ready.",
    explainer: [
      "You'll see who is coming, what the day looks like hour by hour, and exactly what to clear before we arrive.",
      "Power is off for up to 30 minutes while we make the electrical connection agreed at your site visit.",
      "We finish with a full handover: controls, app pairing, warranty and care.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Site visit / fees / SLA — the commercial constants                 */
/* ------------------------------------------------------------------ */

export const SITE_VISIT = {
  feeGbp: 150,
  durationMinutes: 60,
  /** The fee is credited against the installation balance. */
  creditedAgainstInstall: true,
  purposes: [
    "Validate the floor plan and unit positions in your actual rooms",
    "Confirm the outdoor unit location, access and noise clearances",
    "Agree the electrical connection: route, board work and isolation point",
    "Review your survey videos and photos together, live",
    "Answer everything before you commit to an installation date",
  ],
} as const;

export type SiteVisitMode = "video" | "in-person";

export const SITE_VISIT_MODE_LABEL: Record<SiteVisitMode, string> = {
  video: "Video call",
  "in-person": "In person",
};

export type ReschedulableKind = "site-visit" | "delivery" | "installation";

export interface FeeBand {
  /** Applies when days of notice are >= minDaysNotice. Bands checked descending. */
  minDaysNotice: number;
  feeGbp: number;
  label: string;
}

/**
 * Date-change fees escalate as the date approaches — the closer we are, the
 * more is already committed (courier slots, crew days, freed stock).
 */
export const RESCHEDULE_FEES: Record<ReschedulableKind, FeeBand[]> = {
  "site-visit": [
    { minDaysNotice: 2, feeGbp: 0, label: "2+ days notice" },
    { minDaysNotice: 1, feeGbp: 25, label: "1 day notice" },
    { minDaysNotice: 0, feeGbp: 50, label: "same-day" },
  ],
  delivery: [
    { minDaysNotice: 14, feeGbp: 0, label: "14+ days notice" },
    { minDaysNotice: 7, feeGbp: 25, label: "7–13 days notice" },
    { minDaysNotice: 3, feeGbp: 60, label: "3–6 days notice" },
    { minDaysNotice: 0, feeGbp: 120, label: "under 3 days" },
  ],
  installation: [
    { minDaysNotice: 14, feeGbp: 0, label: "14+ days notice" },
    { minDaysNotice: 7, feeGbp: 75, label: "7–13 days notice" },
    { minDaysNotice: 3, feeGbp: 150, label: "3–6 days notice" },
    { minDaysNotice: 0, feeGbp: 300, label: "under 3 days" },
  ],
};

export function rescheduleFeeGbp(kind: ReschedulableKind, daysNotice: number): number {
  const bands = RESCHEDULE_FEES[kind];
  for (const band of bands) {
    if (daysNotice >= band.minDaysNotice) return band.feeGbp;
  }
  return bands[bands.length - 1]?.feeGbp ?? 0;
}

/**
 * Our side of the deal. If we miss a commitment the remedy is automatic —
 * the customer never has to argue for it.
 */
export const SLA_COMMITMENTS = [
  {
    id: "final-quote-1-day",
    promise: "Final quote within 1 working day of your floor-plan approval",
    remedy: "£50 off your installation",
  },
  {
    id: "site-visit-on-time",
    promise: "Your site visit starts within 15 minutes of the booked slot",
    remedy: "The £150 site-visit fee is refunded (and still credited)",
  },
  {
    id: "delivery-on-day",
    promise: "Equipment arrives on the confirmed delivery date",
    remedy: "£50 off, plus £25 for each further day",
  },
  {
    id: "install-on-day",
    promise: "Installation starts on the confirmed date",
    remedy: "5% off your installation price",
  },
  {
    id: "install-duration",
    promise: "Handover completed within the quoted number of install days",
    remedy: "£100 off your installation price",
  },
] as const;

/** Courier lead time: earliest delivery is this many days from "now". */
export const DELIVERY_LEAD_DAYS = 3;
/** Equipment lands this many days before installation by default. */
export const DELIVERY_BEFORE_INSTALL_DAYS = 2;
/** Earliest installation is this many days from "now" (courier + crew scheduling). */
export const INSTALL_LEAD_DAYS = 5;

/* ------------------------------------------------------------------ */
/* Project state                                                      */
/* ------------------------------------------------------------------ */

export type ProjectActor = "customer" | "ops" | "system";

export interface ProjectEvent {
  at: string; // ISO datetime
  type: string;
  /** Customer-facing update line — this is the "great updates" feed. */
  label: string;
  actor: ProjectActor;
  feeGbp?: number;
}

export interface InstallerProfile {
  name: string;
  role: string;
  bio: string;
  yearsExperience: number;
}

export interface DeliveryTrackingEvent {
  at: string; // ISO datetime
  label: string;
  location?: string;
}

export type ElectricsPlanStatus = "provisional" | "attention" | "validated";

export interface PrepItem {
  id: string;
  label: string;
  detail: string;
  /** Customer can tick it off; informational items are not tickable. */
  confirmable: boolean;
  done: boolean;
}

export interface Project {
  id: string;
  quoteId: string;
  createdAt: string; // ISO datetime
  customer: { name: string; postcode: string; addressLine: string };
  quoteSummary: {
    totalGbp: number;
    installDays: number;
    roomCount: number;
    confidenceBand: ConfidenceBand;
    systems: string[];
    /** Unit per room — the floor plan panel draws from this. */
    roomDesigns: { name: string; floor: string; unitLabel: string }[];
  };
  floorPlan: {
    status: "ready" | "approved";
    archetypeName?: string;
    /** The pre-engineered install pattern the customer picked in the survey. */
    pattern?: { label: string; summary: string; pipeRoute: string };
    approvedAt?: string;
  };
  finalQuote: {
    status: "pending" | "issued" | "accepted";
    totalGbp?: number;
    issuedAt?: string;
    acceptedAt?: string;
    note?: string;
  };
  siteVisit: {
    status: "not-booked" | "booked" | "completed";
    mode: SiteVisitMode;
    scheduledFor?: string; // ISO datetime
    feeGbp: number;
    paymentStatus: "unpaid" | "paid";
    rescheduleFeesGbp: number;
    outcome?: {
      summary: string;
      approvedForInstall: boolean;
    };
  };
  /** Cross-cutting: assessed from the survey, finalised at the site visit. */
  electrics: {
    status: ElectricsPlanStatus;
    summary: string;
    surveyCondition: ElectricsCondition;
  };
  delivery: {
    status: "pending" | "scheduled" | "dispatched" | "delivered";
    expectedDate?: string; // ISO date (yyyy-mm-dd)
    courier?: string;
    trackingRef?: string;
    trackingEvents: DeliveryTrackingEvent[];
    rescheduleFeesGbp: number;
    deliveredAt?: string;
  };
  installation: {
    status: "not-booked" | "booked" | "completed";
    date?: string; // ISO date (yyyy-mm-dd)
    installDays: number;
    installer?: InstallerProfile;
    prep: PrepItem[];
    rescheduleFeesGbp: number;
    completedAt?: string;
  };
  events: ProjectEvent[];
}

/* ------------------------------------------------------------------ */
/* Creation                                                           */
/* ------------------------------------------------------------------ */

const ELECTRICS_ASSESSMENT: Record<
  ElectricsCondition,
  { status: ElectricsPlanStatus; summary: string }
> = {
  "modern-spare-ways": {
    status: "provisional",
    summary:
      "Your consumer unit has spare ways, so this looks like a straightforward dedicated circuit. We confirm the exact cable route at your site visit.",
  },
  "modern-full": {
    status: "attention",
    summary:
      "Your consumer unit is modern but full, so we plan to free a way or add a small enclosure. The work is already priced in — the site visit confirms exactly what's needed.",
  },
  "older-fuse-box": {
    status: "attention",
    summary:
      "You have an older fuse board. Our electrician will assess it at the site visit; if board work is needed we'll agree it there before anything is booked.",
  },
  unsure: {
    status: "provisional",
    summary:
      "We couldn't assess your electrics from the survey — pinning down the power connection is a headline item for your site visit.",
  },
};

export const DEFAULT_PREP_ITEMS: Omit<PrepItem, "done">[] = [
  {
    id: "indoor-space",
    label: "Clear space at each indoor unit position",
    detail: "About a metre in front of each wall position on your floor plan, so we can work and sheet up.",
    confirmable: true,
  },
  {
    id: "outdoor-access",
    label: "Clear the route to the outdoor unit spot",
    detail: "Move bins, planters and anything fragile along the access route and around the unit position.",
    confirmable: true,
  },
  {
    id: "parking",
    label: "Sort parking for one van",
    detail: "As close to the property as possible — a permit or a coned space if you're in a controlled zone.",
    confirmable: true,
  },
  {
    id: "pets-kids",
    label: "Plan for pets and children",
    detail: "Doors will be open and tools about — a closed room or a day out works best.",
    confirmable: true,
  },
  {
    id: "power-off",
    label: "Expect power off for up to 30 minutes",
    detail: "We isolate the supply while making the electrical connection agreed at your site visit.",
    confirmable: false,
  },
  {
    id: "adult-home",
    label: "Someone 18+ at home",
    detail: "For access, decisions on the day, and the handover at the end.",
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
}

/**
 * Seed a project from a saved quote. The floor plan is ready immediately
 * (stock archetype layouts); the final quote auto-issues at the same price
 * when the survey was complete enough to lock (high confidence).
 */
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
  const electrics = ELECTRICS_ASSESSMENT[survey.electrics.condition];
  const autoIssue = quote.confidence.band === "high";

  const events: ProjectEvent[] = [
    {
      at: input.createdAt,
      type: "project-created",
      label: "Project created — your installation timeline starts here.",
      actor: "system",
    },
    {
      at: input.createdAt,
      type: "floor-plan-ready",
      label: "Your floor plan is ready to review — no waiting, it's built from your house type's proven layout.",
      actor: "system",
    },
  ];
  if (autoIssue) {
    events.push({
      at: input.createdAt,
      type: "final-quote-issued",
      label: "Your survey was complete, so your final quote is issued at the same fixed price.",
      actor: "system",
    });
  }

  return {
    id: input.id,
    quoteId: input.quoteId,
    createdAt: input.createdAt,
    customer: {
      name: input.customerName,
      postcode: survey.postcode,
      addressLine: survey.addressLine,
    },
    quoteSummary: {
      totalGbp: quote.totalGbp,
      installDays: quote.installDays,
      roomCount: survey.rooms.length,
      confidenceBand: quote.confidence.band,
      systems: quote.systems.map((s) => s.outdoorLabel),
      roomDesigns,
    },
    floorPlan: {
      status: "ready",
      archetypeName: archetype?.name,
      pattern: permutation
        ? {
            label: permutation.label,
            summary: permutation.summary,
            pipeRoute: permutation.pipeRoute,
          }
        : undefined,
    },
    finalQuote: autoIssue
      ? {
          status: "issued",
          totalGbp: quote.totalGbp,
          issuedAt: input.createdAt,
          note: "Issued automatically — your survey was complete enough to lock the price.",
        }
      : { status: "pending" },
    siteVisit: {
      status: "not-booked",
      mode: "video",
      feeGbp: SITE_VISIT.feeGbp,
      paymentStatus: "unpaid",
      rescheduleFeesGbp: 0,
    },
    electrics: { ...electrics, surveyCondition: survey.electrics.condition },
    delivery: { status: "pending", trackingEvents: [], rescheduleFeesGbp: 0 },
    installation: {
      status: "not-booked",
      installDays: quote.installDays,
      prep: DEFAULT_PREP_ITEMS.map((item) => ({ ...item, done: false })),
      rescheduleFeesGbp: 0,
    },
    events,
  };
}

/* ------------------------------------------------------------------ */
/* Stage status + projected timeline                                  */
/* ------------------------------------------------------------------ */

export function isStageComplete(project: Project, stage: ProjectStageId): boolean {
  switch (stage) {
    case "quote":
      return true;
    case "floor-plan":
      return project.floorPlan.status === "approved";
    case "final-quote":
      return project.finalQuote.status === "accepted";
    case "site-visit":
      return project.siteVisit.status === "completed";
    case "delivery":
      return project.delivery.status === "delivered";
    case "installation":
      return project.installation.status === "completed";
  }
}

export function currentStage(project: Project): ProjectStageId {
  for (const stage of PROJECT_STAGES) {
    if (!isStageComplete(project, stage)) return stage;
  }
  return "installation";
}

export function isProjectComplete(project: Project): boolean {
  return PROJECT_STAGES.every((s) => isStageComplete(project, s));
}

export type StageState = "complete" | "current" | "upcoming";

export function stageState(project: Project, stage: ProjectStageId): StageState {
  if (isStageComplete(project, stage)) return "complete";
  return stage === currentStage(project) ? "current" : "upcoming";
}

export type TimelineDateKind = "actual" | "confirmed" | "estimated";

export interface TimelineEntry {
  stage: ProjectStageId;
  state: StageState;
  date?: { kind: TimelineDateKind; iso: string };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` (datetime or date) to `toIso`, by calendar date. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * The dates on the timeline: actuals where a step happened, confirmed where
 * a date is booked, estimates everywhere else — so the future always shows
 * projected dates, like a project plan.
 */
export function projectTimeline(project: Project, todayIso: string): TimelineEntry[] {
  const today = todayIso.slice(0, 10);
  const entries: TimelineEntry[] = [];

  const push = (stage: ProjectStageId, date?: TimelineEntry["date"]) =>
    entries.push({ stage, state: stageState(project, stage), date });

  push("quote", { kind: "actual", iso: project.createdAt });

  push(
    "floor-plan",
    project.floorPlan.approvedAt
      ? { kind: "actual", iso: project.floorPlan.approvedAt }
      : { kind: "estimated", iso: today },
  );

  const finalQuoteEst = project.floorPlan.approvedAt
    ? addDays(today, project.finalQuote.status === "issued" ? 0 : 1)
    : addDays(today, 1);
  push(
    "final-quote",
    project.finalQuote.acceptedAt
      ? { kind: "actual", iso: project.finalQuote.acceptedAt }
      : { kind: "estimated", iso: finalQuoteEst },
  );

  const visitEst = addDays(finalQuoteEst, 5);
  push(
    "site-visit",
    project.siteVisit.status === "completed" && project.siteVisit.scheduledFor
      ? { kind: "actual", iso: project.siteVisit.scheduledFor }
      : project.siteVisit.scheduledFor
        ? { kind: "confirmed", iso: project.siteVisit.scheduledFor }
        : { kind: "estimated", iso: visitEst },
  );

  const visitDate = project.siteVisit.scheduledFor?.slice(0, 10) ?? visitEst;
  const installEst = project.installation.date ?? addDays(visitDate, 9);
  const deliveryEst =
    project.delivery.expectedDate ?? addDays(installEst, -DELIVERY_BEFORE_INSTALL_DAYS);
  push(
    "delivery",
    project.delivery.deliveredAt
      ? { kind: "actual", iso: project.delivery.deliveredAt }
      : project.delivery.expectedDate
        ? { kind: "confirmed", iso: project.delivery.expectedDate }
        : { kind: "estimated", iso: deliveryEst },
  );

  push(
    "installation",
    project.installation.completedAt
      ? { kind: "actual", iso: project.installation.completedAt }
      : project.installation.date
        ? { kind: "confirmed", iso: project.installation.date }
        : { kind: "estimated", iso: installEst },
  );

  return entries;
}

/* ------------------------------------------------------------------ */
/* Actions — the single write path                                    */
/* ------------------------------------------------------------------ */

export type ProjectAction =
  // customer
  | { type: "approve-floor-plan" }
  | { type: "accept-final-quote" }
  | { type: "book-site-visit"; scheduledFor: string; mode: SiteVisitMode }
  | { type: "pay-site-visit" }
  | { type: "reschedule-site-visit"; scheduledFor: string }
  | { type: "book-installation"; date: string }
  | { type: "reschedule-installation"; date: string }
  | { type: "set-delivery-date"; date: string }
  | { type: "toggle-prep"; itemId: string; done: boolean }
  // ops
  | { type: "ops-issue-final-quote"; totalGbp: number; note?: string }
  | {
      type: "ops-complete-site-visit";
      summary: string;
      approvedForInstall: boolean;
      electricsStatus: ElectricsPlanStatus;
      electricsSummary: string;
    }
  | { type: "ops-mark-dispatched"; courier: string; trackingRef: string }
  | { type: "ops-mark-delivered" }
  | { type: "ops-assign-installer"; installer: InstallerProfile }
  | { type: "ops-complete-installation" };

export type ApplyResult =
  | { ok: true; project: Project }
  | { ok: false; error: string };

// Hand-rolled formatting: ICU data differs between runtimes, and event labels
// must come out identical wherever the reducer runs (server, browser, tests).
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
};

// Slot datetimes are UK wall-clock encoded as UTC — format in UTC to round-trip.
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(iso)}, ${hh}:${mm}`;
};

/**
 * Apply one action to a project. Pure: returns a new project (or an error),
 * never mutates. `now` is injected so server and tests control the clock.
 */
export function applyProjectAction(
  project: Project,
  action: ProjectAction,
  now: string,
): ApplyResult {
  // Projects are JSON snapshots by design, so JSON is a faithful deep clone
  // (and keeps this package free of platform APIs beyond ES2022).
  const p: Project = JSON.parse(JSON.stringify(project)) as Project;
  const err = (error: string): ApplyResult => ({ ok: false, error });
  const log = (type: string, label: string, actor: ProjectActor, feeGbp?: number) =>
    p.events.push({ at: now, type, label, actor, ...(feeGbp ? { feeGbp } : {}) });

  switch (action.type) {
    case "approve-floor-plan": {
      if (p.floorPlan.status === "approved") return err("Floor plan is already approved.");
      p.floorPlan.status = "approved";
      p.floorPlan.approvedAt = now;
      log("floor-plan-approved", "You approved your floor plan.", "customer");
      // A complete survey auto-issues the final quote the moment the plan is approved.
      if (p.finalQuote.status === "pending" && p.quoteSummary.confidenceBand === "high") {
        p.finalQuote = {
          status: "issued",
          totalGbp: p.quoteSummary.totalGbp,
          issuedAt: now,
          note: "Issued automatically — your survey was complete enough to lock the price.",
        };
        log(
          "final-quote-issued",
          "Your final quote is issued at your instant-quote price.",
          "system",
        );
      }
      return { ok: true, project: p };
    }

    case "ops-issue-final-quote": {
      if (p.floorPlan.status !== "approved")
        return err("Customer hasn't approved the floor plan yet.");
      if (p.finalQuote.status === "accepted") return err("Final quote is already accepted.");
      if (!Number.isFinite(action.totalGbp) || action.totalGbp <= 0)
        return err("Final quote total must be a positive amount.");
      p.finalQuote = {
        status: "issued",
        totalGbp: Math.round(action.totalGbp),
        issuedAt: now,
        note: action.note,
      };
      log("final-quote-issued", "Your final fixed quote has been issued.", "ops");
      return { ok: true, project: p };
    }

    case "accept-final-quote": {
      if (p.finalQuote.status === "pending")
        return err("Your final quote hasn't been issued yet.");
      if (p.finalQuote.status === "accepted") return err("Final quote is already accepted.");
      if (p.floorPlan.status !== "approved") return err("Approve your floor plan first.");
      p.finalQuote.status = "accepted";
      p.finalQuote.acceptedAt = now;
      log(
        "final-quote-accepted",
        "You accepted your final quote — book your site visit to keep moving.",
        "customer",
      );
      return { ok: true, project: p };
    }

    case "book-site-visit": {
      if (p.finalQuote.status !== "accepted")
        return err("Accept your final quote before booking the site visit.");
      if (p.siteVisit.status === "completed") return err("Your site visit already happened.");
      if (Date.parse(action.scheduledFor) <= Date.parse(now))
        return err("Pick a site-visit slot in the future.");
      p.siteVisit.status = "booked";
      p.siteVisit.mode = action.mode;
      p.siteVisit.scheduledFor = action.scheduledFor;
      log(
        "site-visit-booked",
        `Site visit booked for ${fmtDateTime(action.scheduledFor)} (${SITE_VISIT_MODE_LABEL[action.mode].toLowerCase()}).`,
        "customer",
      );
      return { ok: true, project: p };
    }

    case "pay-site-visit": {
      if (p.siteVisit.status === "not-booked") return err("Book your site visit first.");
      if (p.siteVisit.paymentStatus === "paid") return err("Site visit is already paid.");
      p.siteVisit.paymentStatus = "paid";
      log(
        "site-visit-paid",
        `Site-visit fee paid (£${p.siteVisit.feeGbp}) — it comes off your installation balance.`,
        "customer",
        p.siteVisit.feeGbp,
      );
      return { ok: true, project: p };
    }

    case "reschedule-site-visit": {
      if (p.siteVisit.status !== "booked") return err("There's no booked site visit to move.");
      if (Date.parse(action.scheduledFor) <= Date.parse(now))
        return err("Pick a site-visit slot in the future.");
      const fee = rescheduleFeeGbp("site-visit", daysBetween(now, p.siteVisit.scheduledFor!));
      p.siteVisit.rescheduleFeesGbp += fee;
      p.siteVisit.scheduledFor = action.scheduledFor;
      log(
        "site-visit-rescheduled",
        `Site visit moved to ${fmtDateTime(action.scheduledFor)}${fee ? ` (£${fee} change fee)` : " (no fee)"}.`,
        "customer",
        fee || undefined,
      );
      return { ok: true, project: p };
    }

    case "ops-complete-site-visit": {
      if (p.siteVisit.status !== "booked") return err("Site visit isn't booked.");
      p.siteVisit.status = "completed";
      p.siteVisit.outcome = {
        summary: action.summary,
        approvedForInstall: action.approvedForInstall,
      };
      p.electrics.status = action.electricsStatus;
      p.electrics.summary = action.electricsSummary;
      log(
        "site-visit-completed",
        action.approvedForInstall
          ? "Site visit complete — you're approved for installation. Book your installation date."
          : "Site visit complete — a couple of things to resolve before installation (see notes).",
        "ops",
      );
      return { ok: true, project: p };
    }

    case "book-installation":
    case "reschedule-installation": {
      if (p.siteVisit.status !== "completed")
        return err("Your site visit has to happen before an installation date is confirmed.");
      if (!p.siteVisit.outcome?.approvedForInstall)
        return err("Installation isn't approved yet — see your site-visit notes.");
      if (p.installation.status === "completed") return err("Installation is already done.");
      const notice = daysBetween(now, action.date);
      if (notice < INSTALL_LEAD_DAYS)
        return err(`Installation dates need at least ${INSTALL_LEAD_DAYS} days lead time.`);

      let fee = 0;
      if (action.type === "reschedule-installation") {
        if (p.installation.status !== "booked") return err("No installation date to move.");
        fee = rescheduleFeeGbp("installation", daysBetween(now, p.installation.date!));
        p.installation.rescheduleFeesGbp += fee;
      } else if (p.installation.status === "booked") {
        return err("Installation is already booked — reschedule it instead.");
      }

      p.installation.status = "booked";
      p.installation.date = action.date.slice(0, 10);
      // Delivery targets the install date unless the courier is already moving.
      if (p.delivery.status === "pending" || p.delivery.status === "scheduled") {
        p.delivery.status = "scheduled";
        p.delivery.expectedDate = addDays(p.installation.date, -DELIVERY_BEFORE_INSTALL_DAYS);
      }
      log(
        action.type === "book-installation" ? "installation-booked" : "installation-rescheduled",
        `Installation ${action.type === "book-installation" ? "booked" : "moved to"} ${fmtDate(p.installation.date)}` +
          ` — equipment delivery expected ${fmtDate(p.delivery.expectedDate!)}` +
          (fee ? ` (£${fee} change fee)` : "") +
          ".",
        "customer",
        fee || undefined,
      );
      return { ok: true, project: p };
    }

    case "set-delivery-date": {
      if (p.installation.status !== "booked")
        return err("Book your installation date first — delivery is planned around it.");
      if (p.delivery.status === "dispatched" || p.delivery.status === "delivered")
        return err("Your equipment is already on the move.");
      const date = action.date.slice(0, 10);
      if (daysBetween(now, date) < DELIVERY_LEAD_DAYS)
        return err(`Deliveries need at least ${DELIVERY_LEAD_DAYS} days for the courier.`);
      if (daysBetween(date, p.installation.date!) < 1)
        return err("Delivery must land at least the day before installation.");
      const fee = p.delivery.expectedDate
        ? rescheduleFeeGbp("delivery", daysBetween(now, p.delivery.expectedDate))
        : 0;
      const isMove = Boolean(p.delivery.expectedDate) && p.delivery.expectedDate !== date;
      if (isMove) p.delivery.rescheduleFeesGbp += fee;
      p.delivery.status = "scheduled";
      p.delivery.expectedDate = date;
      log(
        "delivery-date-set",
        `Equipment delivery ${isMove ? "moved to" : "set for"} ${fmtDate(date)}${isMove && fee ? ` (£${fee} change fee)` : ""}.`,
        "customer",
        isMove && fee ? fee : undefined,
      );
      return { ok: true, project: p };
    }

    case "ops-mark-dispatched": {
      if (!p.delivery.expectedDate) return err("Set a delivery date before dispatching.");
      if (p.delivery.status === "dispatched" || p.delivery.status === "delivered")
        return err("Already dispatched.");
      p.delivery.status = "dispatched";
      p.delivery.courier = action.courier;
      p.delivery.trackingRef = action.trackingRef;
      p.delivery.trackingEvents.push({
        at: now,
        label: `Dispatched with ${action.courier}`,
        location: "Distribution centre",
      });
      log(
        "delivery-dispatched",
        `Your equipment is on its way with ${action.courier} — tracking ${action.trackingRef}.`,
        "ops",
      );
      return { ok: true, project: p };
    }

    case "ops-mark-delivered": {
      if (p.delivery.status !== "dispatched") return err("Nothing in transit to deliver.");
      p.delivery.status = "delivered";
      p.delivery.deliveredAt = now;
      p.delivery.trackingEvents.push({ at: now, label: "Delivered", location: "Your address" });
      log(
        "delivery-delivered",
        "Your equipment has been delivered — leave the boxes where they are, we handle the rest.",
        "ops",
      );
      return { ok: true, project: p };
    }

    case "ops-assign-installer": {
      p.installation.installer = action.installer;
      log(
        "installer-assigned",
        `${action.installer.name} will lead your installation — their profile is on your installation page.`,
        "ops",
      );
      return { ok: true, project: p };
    }

    case "ops-complete-installation": {
      if (p.installation.status !== "booked") return err("Installation isn't booked.");
      if (p.delivery.status !== "delivered")
        return err("Equipment hasn't been delivered yet.");
      p.installation.status = "completed";
      p.installation.completedAt = now;
      log(
        "installation-completed",
        "Installation complete — welcome to properly conditioned air. Warranty and care docs are on their way.",
        "ops",
      );
      return { ok: true, project: p };
    }

    case "toggle-prep": {
      const item = p.installation.prep.find((i) => i.id === action.itemId);
      if (!item) return err("Unknown checklist item.");
      if (!item.confirmable) return err("That item is informational.");
      item.done = action.done;
      return { ok: true, project: p };
    }
  }
}

/** Fees accrued so far (date changes) plus the site-visit fee state — for the balance strip. */
export function projectFees(project: Project): {
  changeFeesGbp: number;
  siteVisitPaidGbp: number;
} {
  return {
    changeFeesGbp:
      project.siteVisit.rescheduleFeesGbp +
      project.delivery.rescheduleFeesGbp +
      project.installation.rescheduleFeesGbp,
    siteVisitPaidGbp:
      project.siteVisit.paymentStatus === "paid" ? project.siteVisit.feeGbp : 0,
  };
}
