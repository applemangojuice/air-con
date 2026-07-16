import type {
  ConfidenceBand,
  ElectricsCondition,
  QuoteResult,
  Survey,
} from "./types.ts";
import { getArchetype, getPermutation } from "./archetypes.ts";

/**
 * The project workflow: everything that happens after the instant quote.
 *
 * A project is the customer's whole journey on one horizontal timeline:
 *
 *   quote → floor plan → final quote → site visit → delivery → installation
 *
 * Design rules (mirroring the quote engine):
 *  * The Project is a plain JSON snapshot. It persists to JSONB as-is and
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
  /** "What happens here", shown even when the stage is greyed out in the future. */
  explainer: string[];
}

export const STAGE_INFO: Record<ProjectStageId, StageInfo> = {
  quote: {
    id: "quote",
    label: "Quote",
    title: "Your instant quote",
    strap: "A fixed price from your own survey. No pushy sales visit, no waiting by the phone, no clipboard.",
    explainer: [
      "You told us about your place, we priced the whole job on the spot.",
      "Once your photos are checked the price is locked. It can go down, never up, unless you change the plan.",
      "Everything from here happens on this timeline, and you can peek ahead any time.",
    ],
  },
  "floor-plan": {
    id: "floor-plan",
    label: "Floor plan",
    title: "Your floor plan",
    strap: "See exactly where everything goes, then give it the thumbs up.",
    explainer: [
      "We only fit proven layouts for your type of house, so your plan is ready straight away. No designer, no waiting.",
      "It shows every indoor unit, where the outdoor unit sits, and how the pipes run.",
      "Approve it and your final quote is next. You can still tweak things at the site visit.",
    ],
  },
  "final-quote": {
    id: "final-quote",
    label: "Final quote",
    title: "Your final quote",
    strap: "Your price, in writing, locked to your approved plan.",
    explainer: [
      "We check your photos against your floor plan, then put the final price in writing.",
      "If your survey was complete, this happens instantly at the same price as your instant quote.",
      "Accepting unlocks site visit booking. Still nothing to pay.",
    ],
  },
  "site-visit": {
    id: "site-visit",
    label: "Site visit",
    title: "Your site visit",
    strap: "One hour with our founder to check everything before we build.",
    explainer: [
      "Every install gets exactly one site visit, and nothing gets built without it.",
      "We walk your plan room by room, check the outdoor unit spot, and nail down where the power comes from.",
      "Usually a video call, in person if your place needs real eyes. The £150 comes straight off your install price.",
    ],
  },
  delivery: {
    id: "delivery",
    label: "Delivery",
    title: "Your kit arrives",
    strap: "Everything ships straight to your door before install day, tracked right here.",
    explainer: [
      "No van full of mystery stock. Your exact kit ships by courier a couple of days before your install.",
      "You'll see the courier, the tracking number and live updates on this page.",
      "The boxes are heavy but safe. Leave them where they land, your installer sorts the rest.",
    ],
  },
  installation: {
    id: "installation",
    label: "Installation",
    title: "Install day",
    strap: "Meet your installer, see the plan for the day, get your place ready.",
    explainer: [
      "You'll know exactly who's coming, what the day looks like, and what to clear before we arrive.",
      "The power goes off for up to 30 minutes while we wire in the connection agreed at your site visit.",
      "We finish with a proper handover: controls, app pairing, warranty, the lot.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Site visit / fees / SLA: the commercial constants                  */
/* ------------------------------------------------------------------ */

export const SITE_VISIT = {
  feeGbp: 150,
  durationMinutes: 60,
  /** The fee is credited against the installation balance. */
  creditedAgainstInstall: true,
  purposes: [
    "Walk the floor plan and unit positions in your actual rooms",
    "Check the outdoor unit spot, access and noise clearances",
    "Nail down the electrics: cable route, board work, isolation point",
    "Go through your survey videos and photos together, live",
    "Ask us anything before you commit to an install date",
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
 * Date-change fees, kept deliberately simple: a week or more of notice is
 * free, anything closer pays one flat short-notice fee (by then couriers
 * and crew days are already committed).
 */
export const RESCHEDULE_FEES: Record<ReschedulableKind, FeeBand[]> = {
  "site-visit": [
    { minDaysNotice: 7, feeGbp: 0, label: "7+ days notice" },
    { minDaysNotice: 0, feeGbp: 25, label: "short notice" },
  ],
  delivery: [
    { minDaysNotice: 7, feeGbp: 0, label: "7+ days notice" },
    { minDaysNotice: 0, feeGbp: 60, label: "short notice" },
  ],
  installation: [
    { minDaysNotice: 7, feeGbp: 0, label: "7+ days notice" },
    { minDaysNotice: 0, feeGbp: 150, label: "short notice" },
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
 * Our side of the deal. If we miss a commitment the remedy is automatic,
 * the customer never has to argue for it.
 */
export const SLA_COMMITMENTS = [
  {
    id: "final-quote-1-day",
    promise: "Your final quote lands within one working day",
    remedy: "£50 off your install",
  },
  {
    id: "site-visit-on-time",
    promise: "Your site visit starts on time",
    remedy: "Your £150 back, and it still counts off your price",
  },
  {
    id: "delivery-on-day",
    promise: "Your kit arrives on the agreed day",
    remedy: "£50 off, plus £25 for every extra day",
  },
  {
    id: "install-on-day",
    promise: "Your install starts on the agreed day",
    remedy: "5% off your install price",
  },
  {
    id: "install-duration",
    promise: "Handover inside the quoted install days",
    remedy: "£100 off your install price",
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
  /** Customer-facing update line: this is the "great updates" feed. */
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
    /** Unit per room; the floor plan panel draws from this. */
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
      "Your fuse board has spare ways, so this looks like a simple dedicated circuit. We'll confirm the exact cable route at your site visit.",
  },
  "modern-full": {
    status: "attention",
    summary:
      "Your fuse board is modern but full, so we'll free up a way or add a small extra box. It's already priced in, and the site visit confirms exactly what's needed.",
  },
  "older-fuse-box": {
    status: "attention",
    summary:
      "You've got an older fuse board. Our electrician checks it at the site visit, and if it needs work we agree that with you there before anything is booked.",
  },
  unsure: {
    status: "provisional",
    summary:
      "We couldn't tell much about your electrics from the survey, so sorting the power connection is top of the list for your site visit.",
  },
};

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
    detail: "We switch off the supply while wiring in the connection agreed at your site visit.",
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
      label: "Project created. Your installation timeline starts here.",
      actor: "system",
    },
    {
      at: input.createdAt,
      type: "floor-plan-ready",
      label: "Your floor plan is ready to look at. No waiting, it's built from the proven layout for your house type.",
      actor: "system",
    },
  ];
  if (autoIssue) {
    events.push({
      at: input.createdAt,
      type: "final-quote-issued",
      label: "Your survey was complete, so your final quote is already issued at the same fixed price.",
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
          note: "Issued automatically. Your survey was complete enough to lock the price straight in.",
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
 * a date is booked, estimates everywhere else, so the future always shows
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
/* Actions: the single write path                                     */
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

// Slot datetimes are UK wall-clock encoded as UTC; format in UTC to round-trip.
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
          note: "Issued automatically. Your survey was complete enough to lock the price straight in.",
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
        "You accepted your final quote. Book your site visit to keep things moving.",
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
        `Site visit fee paid (£${p.siteVisit.feeGbp}). It comes straight off your install balance.`,
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
          ? "Site visit done. You're approved for installation, go book your install date."
          : "Site visit done. A couple of things to sort before installation (see notes).",
        "ops",
      );
      return { ok: true, project: p };
    }

    case "book-installation":
    case "reschedule-installation": {
      if (p.siteVisit.status !== "completed")
        return err("Your site visit has to happen before an installation date is confirmed.");
      if (!p.siteVisit.outcome?.approvedForInstall)
        return err("Installation isn't approved yet. Check your site visit notes.");
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
        return err("Installation is already booked. Use reschedule to move it.");
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
        `Installation ${action.type === "book-installation" ? "booked for" : "moved to"} ${fmtDate(p.installation.date)}.` +
          ` Your kit should land ${fmtDate(p.delivery.expectedDate!)}` +
          (fee ? ` (£${fee} change fee)` : "") +
          ".",
        "customer",
        fee || undefined,
      );
      return { ok: true, project: p };
    }

    case "set-delivery-date": {
      if (p.installation.status !== "booked")
        return err("Book your installation date first. Delivery is planned around it.");
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
        `Your kit is on its way with ${action.courier}. Tracking: ${action.trackingRef}.`,
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
        "Your kit has landed. Leave the boxes where they are, we handle the rest.",
        "ops",
      );
      return { ok: true, project: p };
    }

    case "ops-assign-installer": {
      p.installation.installer = action.installer;
      log(
        "installer-assigned",
        `${action.installer.name} is leading your install. Their profile is on your installation page.`,
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
        "Installation complete. You are now officially allowed to be smug about your cool house. Warranty and care docs are on the way.",
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

/** Fees accrued so far (date changes) plus the site-visit fee state, for the balance strip. */
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
