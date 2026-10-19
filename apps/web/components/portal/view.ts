import {
  PROJECT_STAGES,
  QUALIFICATION_LABEL,
  ROLE_LABEL,
  cancellationCopy,
  cancellationStatus,
  currentStage,
  earlyStartWording,
  hasCurrentQualification,
  rescheduleFeeGbp,
  stageInfo,
  type PilotSettings,
  type Project,
  type ProjectStageId,
  type StaffMember,
  type StaffRole,
  PROPOSAL_TURNAROUND_WORKING_DAYS,
} from "@aircon/domain";
import { addWorkingDays, blockLabel, shortDay } from "./schedule.ts";
import type { HubFacts, PersonCard } from "./types.ts";
import { realPhone } from "@/components/site/claims";

/**
 * Pure pieces of the customer hub: what to strip before anything reaches a
 * browser, the settings-derived words, and the small decisions the panels
 * make (which stage a link opens, what to say while the ball's in our
 * court, how kit news reads). Shared by the server and the in-browser demo.
 */

/* ------------------------------------------------------------------ */
/* Customer-safe snapshot                                              */
/* ------------------------------------------------------------------ */

/**
 * The project as a customer may see it: internal events, the ops next
 * action and owner, the pilot tag and our own working notes (kit summary,
 * day summaries) removed. Everything the customer did or was told stays.
 */
export function customerSafeProject(project: Project): Project {
  const p: Project = JSON.parse(JSON.stringify(project)) as Project;
  p.events = p.events.filter((e) => !e.internal);
  delete p.nextAction;
  delete p.owner;
  delete p.pilot;
  delete p.kit.summary;
  p.install.days = p.install.days.map(({ summary: _summary, ...day }) => day);
  return p;
}

/* ------------------------------------------------------------------ */
/* Facts from settings                                                 */
/* ------------------------------------------------------------------ */

export function hubFacts(project: Project, settings: PilotSettings, today: string, onTheWay: HubFacts["onTheWay"]): HubFacts {
  const stages = Object.fromEntries(PROJECT_STAGES.map((s) => [s, stageInfo(s, settings, project)])) as HubFacts["stages"];
  const cs = cancellationStatus(project, today, settings);
  return {
    stages,
    company: {
      tradingName: settings.company.tradingName,
      phone: realPhone(settings.company.phone),
      email: settings.company.email,
      ...(settings.company.reviewUrl ? { reviewUrl: settings.company.reviewUrl } : {}),
    },
    scheduling: {
      surveyDurationMinutes: settings.scheduling.surveyDurationMinutes,
      installBlockDays: settings.scheduling.installBlockDays,
      cancellationDays: settings.scheduling.cancellationDays,
    },
    warranty: { ...settings.warranty },
    cancellation: {
      sentence: cancellationCopy(project, { settings, today }),
      ...(cs.endsOn ? { endsOn: cs.endsOn } : {}),
      ended: cs.ended,
      basis: cs.basis,
      earlyStartEvidenced: cs.earlyStartEvidenced,
    },
    earlyStartWording: earlyStartWording(project.proposal.contractType),
    fees: { surveyShortNoticeGbp: rescheduleFeeGbp("survey", 0), installShortNoticeGbp: rescheduleFeeGbp("installation", 0) },
    onTheWay,
  };
}

/** A staff member as the customer meets them: name, role, photo, bio and only the qualifications held today. */
export function personCard(
  staff: Pick<StaffMember, "name" | "roles" | "qualifications" | "bio">,
  today: string,
  opts: { role?: StaffRole; photoUrl?: string | null } = {},
): PersonCard {
  const roles = opts.role ? [opts.role, ...staff.roles.filter((r) => r !== opts.role && r !== "admin")] : staff.roles.filter((r) => r !== "admin");
  const kinds = [...new Set(staff.qualifications.map((q) => q.kind))].filter((k) => hasCurrentQualification(staff, k, today));
  return {
    name: staff.name,
    role: roles.map((r) => ROLE_LABEL[r]).join(", ") || "Team member",
    photoUrl: opts.photoUrl ?? null,
    ...(staff.bio?.trim() ? { bio: staff.bio.trim() } : {}),
    qualifications: kinds.map((k) => QUALIFICATION_LABEL[k]),
  };
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/**
 * The stage a link's #hash opens (emails link to #survey, #booking, #kit,
 * #install, #handover, #aftercare). Booking a survey happens on the price
 * panel, so #survey opens that until it's booked.
 */
export function stageForHash(hash: string, project: Project): ProjectStageId | null {
  const h = hash.replace(/^#/, "").trim();
  if (h === "survey" && project.survey.status === "not-booked") return "price";
  return (PROJECT_STAGES as readonly string[]).includes(h) ? (h as ProjectStageId) : null;
}

/** The stage the hub opens on: the current one. */
export function defaultStage(project: Project): ProjectStageId {
  return currentStage(project);
}

/* ------------------------------------------------------------------ */
/* What happens next, when it's on us                                  */
/* ------------------------------------------------------------------ */

/** Working days we tell customers a proposal takes after the survey: the domain's one number (the survey-complete email uses it too). */
export { PROPOSAL_TURNAROUND_WORKING_DAYS };

/** When we said the proposal would arrive, or null before the survey. */
export function proposalReadyBy(project: Project): string | null {
  const at = project.survey.submittedAt;
  return at ? addWorkingDays(at.slice(0, 10), PROPOSAL_TURNAROUND_WORKING_DAYS) : null;
}

/**
 * The calm line the "Your next step" card shows when customerNextAction is
 * null: what we're doing and when they'll hear. Never invents a date.
 */
/** The on-my-way promise in the words of the channel it'll really go by (HubFacts.onTheWay). */
export function onTheWayPromise(onTheWay: HubFacts["onTheWay"]): string {
  return onTheWay === "sms" ? "We'll text you when we're on the way." : onTheWay === "email" ? "We'll email you when we're on the way." : "";
}

export function waitingCopy(project: Project, onTheWay: HubFacts["onTheWay"] = null): { title: string; body: string } {
  const p = project;
  if (p.closure.closed) {
    return p.closure.reason === "cancelled"
      ? { title: "This project is closed", body: "Nothing more to do here. Get in touch any time if you'd like to pick it up again." }
      : { title: "All wrapped up", body: "If anything isn't right with your system, report it below and we'll call you back." };
  }
  switch (currentStage(p)) {
    case "price":
    case "survey":
      return p.survey.status === "in-progress"
        ? { title: "Your survey is under way", body: "Your surveyor is with you now. Your proposal follows within a few working days." }
        : { title: "Your survey is booked", body: "We'll see you then." };
    case "proposal": {
      if (p.proposal.status === "changes-requested") {
        return { title: "We're revising your proposal", body: "Thanks for telling us what you'd like changed. We'll send the new version as soon as it's ready." };
      }
      const by = proposalReadyBy(p);
      const design =
        p.design.status === "approved"
          ? "Your design has been signed off by our engineer. We're putting your proposal together."
          : "We're designing your system from the survey. A qualified engineer checks and signs it off before you see a price.";
      return { title: "We're working on your proposal", body: by ? `${design} It should be with you by ${shortDay(by)}.` : design };
    }
    case "booking":
      return {
        title: "We're lining everything up",
        body: p.booking.dates.length
          ? `You've picked ${blockLabel(p.booking.dates)}. We'll confirm once your team and kit are lined up.`
          : "We'll confirm your install dates shortly.",
      };
    case "kit":
    case "install":
      if (p.install.status === "in-progress") {
        const day = [...p.install.days].reverse().find((d) => d.status !== "planned");
        return {
          title: day ? `Install day ${day.n} ${day.status === "done" ? "done" : "in progress"}` : "Your install is under way",
          body: "You'll get an update with photos at the end of each day.",
        };
      }
      return {
        title: "You're all set",
        body: p.booking.dates.length
          ? `See you ${blockLabel(p.booking.dates)}.${onTheWayPromise(onTheWay) ? ` ${onTheWayPromise(onTheWay)}` : ""}`
          : onTheWayPromise(onTheWay) || "We'll be in touch before the day with everything you need.",
      };
    case "handover":
      return { title: "Nearly there", body: "We're finishing the commissioning checks and your paperwork. Your handover pack lands here." };
    case "aftercare":
      return { title: "Enjoy it", body: "Cool in summer, warm in winter. If anything isn't right, report it below and we'll call you back." };
  }
}

/* ------------------------------------------------------------------ */
/* Kit: conservative, never inferred                                   */
/* ------------------------------------------------------------------ */

const KIT_RANK: Record<Project["kit"]["status"], number> = {
  "not-ordered": 0,
  ordered: 1,
  confirmed: 2,
  // Dispatch is the supplier's word, not something we've seen: it reads as confirmed.
  dispatched: 2,
  delivered: 3,
  inspected: 4,
};

export function kitSteps(project: Project): { label: string; done: boolean; current: boolean }[] {
  const k = project.kit;
  const rank = KIT_RANK[k.status] ?? 0;
  const labels = [
    "Ordered",
    k.expectedDate && rank >= 2 ? `Supplier confirmed for ${shortDay(k.expectedDate)}` : "Supplier confirmed a date",
    k.deliveredAt && rank >= 3 ? `Delivered ${shortDay(k.deliveredAt)}` : "Delivered",
    "Checked by your installer",
  ];
  return labels.map((label, i) => ({ label, done: rank >= i + 1, current: rank === i }));
}

/** The one-line kit status. */
export function kitHeadline(project: Project): string {
  const k = project.kit;
  switch (k.status) {
    case "not-ordered":
      return project.booking.status === "booked" ? "We're ordering your kit." : "We order your kit once your booking is confirmed.";
    case "ordered":
      return "Your kit is ordered. We'll tell you when the supplier confirms a date.";
    case "confirmed":
    case "dispatched":
      return k.expectedDate ? `The supplier has confirmed your kit for ${shortDay(k.expectedDate)}.` : "The supplier has confirmed your order.";
    case "delivered":
      return k.shortages > 0
        ? `Delivered, with ${k.shortages} item${k.shortages === 1 ? "" : "s"} still to come. We're on it.`
        : "Your kit has been delivered. Your installer checks every box before anything goes up.";
    case "inspected":
      return k.shortages > 0
        ? `Checked by your installer, with ${k.shortages} item${k.shortages === 1 ? "" : "s"} still to come.`
        : "Delivered and checked by our team against your design.";
  }
}

/* ------------------------------------------------------------------ */
/* Install days                                                        */
/* ------------------------------------------------------------------ */

/** What happens each day, in plain words (pilot plan §4's three-day map). */
export function installPlan(days: number): { n: number; title: string; body: string }[] {
  const n = Math.max(1, Math.round(days));
  if (n === 1) {
    return [{ n: 1, title: "Everything in one day", body: "We drill and fit the units, run the pipes and power, then test, commission and show you how it all works." }];
  }
  if (n === 2) {
    return [
      { n: 1, title: "Drilling and fitting", body: "We protect your floors, drill the pipe holes, put up the brackets and hang the indoor and outdoor units." },
      { n: 2, title: "Pipes, power and testing", body: "Pipework, drainage and the new circuit, then pressure tests, commissioning in heating and cooling, and your walkthrough." },
    ];
  }
  const first = { title: "Prep and drilling", body: "We protect your floors, mark out each unit, drill and seal the pipe holes, and fix the wall plates and the outdoor base." };
  const fitting = { title: "Units, pipes and power", body: "The indoor and outdoor units go up, then the pipework, drainage and the new electrical circuit. This is when the power goes off for a while." };
  const more = { title: "Fitting continues", body: "More fitting time for a bigger job: units, pipework and power." };
  const last = { title: "Testing and handover", body: "Pressure and vacuum tests, commissioning in heating and cooling, a tidy-up, and we show you how it all works." };
  const middle = Array.from({ length: n - 2 }, (_, i) => (i === 0 ? fitting : more));
  return [first, ...middle, last].map((d, i) => ({ n: i + 1, ...d }));
}

/** Show the "on my way" banner for this long after it was sent. */
export const ON_MY_WAY_SHOW_MINUTES = 3 * 60;

/** Is an on-my-way message fresh enough to show? (Older ones have either arrived or been superseded.) */
export function onMyWayFresh(onMyWay: { at: string } | undefined, nowIso: string): boolean {
  if (!onMyWay) return false;
  const age = (Date.parse(nowIso) - Date.parse(onMyWay.at)) / 60_000;
  return Number.isFinite(age) && age >= 0 && age <= ON_MY_WAY_SHOW_MINUTES;
}

/** About when they'll arrive: sent at + ETA, in UK wall-clock terms as the reducer stored `at` (a real instant). */
export function arrivalTime(onMyWay: { at: string; etaMinutes: number }): string {
  const t = new Date(Date.parse(onMyWay.at) + onMyWay.etaMinutes * 60_000);
  // `at` is a real instant; show London time.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** Outstanding across live invoices (issued or part-paid), never below zero. */
export function outstandingOf(invoices: { status: string; totalPence: number; paidPence: number }[]): number {
  return invoices
    .filter((i) => i.status === "issued" || i.status === "part-paid")
    .reduce((sum, i) => sum + Math.max(0, i.totalPence - i.paidPence), 0);
}
