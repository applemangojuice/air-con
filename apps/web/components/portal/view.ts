import {
  PROJECT_STAGES,
  QUALIFICATION_LABEL,
  ROLE_LABEL,
  cancellationCopy,
  cancellationStatus,
  currentStage,
  customerNextAction,
  documentsConsentCovers,
  earlyStartWording,
  hasCurrentQualification,
  isStageComplete,
  rescheduleFeeGbp,
  stageInfo,
  type PilotSettings,
  type Project,
  type ProjectStageId,
  type StaffMember,
  type StaffRole,
  PROPOSAL_TURNAROUND_WORKING_DAYS,
  proposalOverdue,
  proposalPromisedBy,
  variationsAwaitingCustomer,
} from "@aircon/domain";
import { blockLabel, shortDay } from "./schedule.ts";
import type { HubFacts, HubIssue, PersonCard } from "./types.ts";
import { realPhone } from "@/components/site/claims";
import { fmtDay, fmtInstantDay, money } from "@/lib/format";

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

export function hubFacts(
  project: Project,
  settings: PilotSettings,
  today: string,
  onTheWay: HubFacts["onTheWay"],
  card: { available: boolean; simulate: boolean } = { available: false, simulate: false },
): HubFacts {
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
    // The pay page's rules: card when it's on (or the demo simulator), bank only with the account in settings.
    payBy: {
      card: (card.available && settings.payments.methods.includes("card")) || card.simulate,
      bank: settings.payments.methods.includes("bank-transfer") && Boolean(settings.company.bank),
    },
  };
}

/** "£X to pay, by card or bank transfer.": only the ways the pay page really offers. */
export function toPayLine(pence: string, payBy: HubFacts["payBy"], company: HubFacts["company"]): string {
  if (payBy.card && payBy.bank) return `${pence} to pay, by card or bank transfer.`;
  if (payBy.card) return `${pence} to pay, by card.`;
  if (payBy.bank) return `${pence} to pay, by bank transfer.`;
  return `${pence} to pay. ${company.phone ? `Call us on ${company.phone} or email ${company.email}` : `Email us at ${company.email}`} and we'll give you our bank details.`;
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

/** When we said the proposal would arrive, or null before the survey (the domain's one rule). */
export function proposalReadyBy(project: Project): string | null {
  return proposalPromisedBy(project);
}

/**
 * The promised date has passed and the proposal still isn't with them (it's
 * late on the day after the date we gave). The hub then says sorry instead
 * of repeating a date in the past; ops gets an alert (proposal-late).
 */
export function proposalLate(project: Project, today: string): boolean {
  return proposalOverdue(project, today);
}

/** What the hub says once we've missed the date we gave. */
export const PROPOSAL_LATE_LINE = "It's taking a little longer than we said. Sorry. We'll email you the moment it's ready.";

/** Past the date, but it can't go until they agree to email delivery: say what it's waiting for, not sorry. */
export const PROPOSAL_NEEDS_CONSENT_LINE = "We can only send it once you've agreed to get your documents by email.";

/** The line for a proposal past its date: our apology, unless what holds it is their OK to email it. */
export function proposalLateLine(project: Project): string {
  return documentsConsentCovers(project) ? PROPOSAL_LATE_LINE : PROPOSAL_NEEDS_CONSENT_LINE;
}

/** The on-my-way promise in the words of the channel it'll really go by (HubFacts.onTheWay). */
export function onTheWayPromise(onTheWay: HubFacts["onTheWay"]): string {
  return onTheWay === "sms" ? "We'll text you when we're on the way." : onTheWay === "email" ? "We'll email you when we're on the way." : "";
}

/**
 * The hub's "Your next step": the domain's one next action, told about the
 * changes waiting for the customer's OK (they're issues, not on the
 * snapshot). The card, the panels' quiet echoes and /portal all use this.
 */
export function hubNextAction(data: { project: Project; issues: readonly HubIssue[] }): { label: string; href?: string } | null {
  return customerNextAction(data.project, data.issues);
}

/** The line under "Answer a change to your installation": which change, what it does to the price, and that nothing extra happens without their yes. */
export function variationNextDetail(issues: readonly HubIssue[]): string | null {
  const waiting = variationsAwaitingCustomer(issues);
  if (!waiting.length) return null;
  const delta = (pence: number) => (pence > 0 ? `+${money(pence)}` : pence < 0 ? money(pence) : "no change to your price");
  const total = waiting.reduce((sum, i) => sum + (i.variation?.totalDeltaPence ?? 0), 0);
  const what = waiting.length === 1 ? `Change #${waiting[0]!.number}: ${waiting[0]!.title} (${delta(total)}).` : `${waiting.length} changes (${delta(total)} in all).`;
  return `${what} We need your yes or no: nothing extra is done without your yes.`;
}

/**
 * The calm line the "Your next step" card shows when customerNextAction is
 * null: what we're doing and when they'll hear. Never invents a date, and
 * never repeats one that has passed (`today`).
 */
export function waitingCopy(project: Project, onTheWay: HubFacts["onTheWay"] = null, today?: string): { title: string; body: string } {
  const p = project;
  const cancelled = cancelledCopy(p);
  if (cancelled) return cancelled;
  if (p.closure.closed) {
    return { title: "All wrapped up", body: "If anything isn't right with your system, report it below and we'll call you back." };
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
      if (today && proposalLate(p, today)) return { title: "We're working on your proposal", body: `${design} ${proposalLateLine(p)}` };
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

/* ------------------------------------------------------------------ */
/* Cancelled                                                           */
/* ------------------------------------------------------------------ */

/** The contract was cancelled, or the project closed as cancelled before there was one. */
export function isCancelledProject(p: Pick<Project, "cancellation" | "closure">): boolean {
  return Boolean(p.cancellation) || (p.closure.closed && p.closure.reason === "cancelled");
}

/** Supplied kit that's reached the home (or gone to it): we collect it after a cancellation (cancellation-server's rule). */
const KIT_AT_HOME = new Set<Project["kit"]["status"]>(["dispatched", "delivered", "inspected"]);

/**
 * What the hub says about a cancelled project, or null when it isn't one:
 * when the cancellation reached us and what happens now, as the
 * acknowledgement email put it. Inside the period, the refund (with its
 * deadline) and the collection; after it, only that we'll be in touch:
 * nothing is promised before anyone has checked.
 */
export function cancelledCopy(p: Project): { title: string; body: string } | null {
  if (!isCancelledProject(p)) return null;
  const c = p.cancellation;
  if (!c) return { title: "This project is closed", body: "Nothing more to do here. Get in touch any time if you'd like to pick it up again." };
  const on = fmtInstantDay(c.receivedAt);
  if (!c.withinPeriod) {
    return {
      title: "We've received your cancellation",
      body: `It reached us on ${on}, after your cancellation period had ended. We'll be in touch in writing about what happens next.`,
    };
  }
  const paid = Math.max(0, p.money.paidPence);
  const collect = p.proposal.contractType !== "install-only" && (KIT_AT_HOME.has(p.kit.status) || p.install.status !== "not-started");
  return {
    title: "Your contract is cancelled",
    body: [
      `We received your cancellation on ${on}.`,
      paid > 0 ? `We'll refund the ${money(paid)} you've paid by ${fmtDay(c.refundDueBy)} at the latest, the same way you paid.` : "Nothing more is due from you.",
      collect ? "We'll collect the equipment we supplied, at our cost, at a time that suits you." : "",
      "Your contract and any invoices stay in your documents.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * A stage that won't happen now the project is cancelled: shown as
 * cancelled, never "now", "planned" or with a date. What was done before
 * the cancellation stays done, except aftercare (its tick only meant the
 * project closed).
 */
export function stageCancelled(p: Project, stage: ProjectStageId): boolean {
  if (!isCancelledProject(p)) return false;
  return stage === "aftercare" || !isStageComplete(p, stage);
}

/**
 * Whether a stage's panel gives way to the cancellation notice: every stage
 * that won't happen, and from the proposal on whatever its state, since
 * those panels describe the plans (install days, prep, the power-off
 * notice, the right to cancel) that no longer apply.
 */
export function showsCancelledPanel(p: Project, stage: ProjectStageId): boolean {
  if (!isCancelledProject(p)) return false;
  return stageCancelled(p, stage) || PROJECT_STAGES.indexOf(stage) >= PROJECT_STAGES.indexOf("proposal");
}
