import {
  addWorkingDays,
  daysBetween,
  handoverDeadlines,
  documentsConsentCovers,
  nextServiceDueOn,
  serviceRemindersOn,
  proposalOverdue,
  proposalPromisedBy,
  reviewRequestDue,
  seasonalCheck,
  seasonalCheckDue,
  type PilotSettings,
  type Project,
  type ProjectAction,
} from "@aircon/domain";
import type { CommsData } from "./comms/templates.ts";

/**
 * What the daily-ops cron does for one project today (contract §H): the
 * reminders, nudges and aftercare touches that nobody presses a button for.
 * Pure: (project, today, settings) → jobs, so every date rule is tested
 * without a clock or a database. The cron route (lib/ops-core-server.ts
 * runDailyOps) runs the jobs through the outbox and dispatch.
 *
 * Every job is idempotent twice over: each message is keyed on its
 * occurrence (the slot, the start date, the proposal id, the handover day),
 * so a re-run sends nothing new, and the aftercare touches record
 * themselves on the project once sent so they stop being planned.
 *
 * Dates are London dates (`today` from londonToday()); appointment times are
 * UK wall-clock encoded as UTC, so their date part is the London date.
 */

export type DailyJobId =
  | "survey-reminder"
  | "install-prep"
  | "install-day-before"
  | "proposal-reminder"
  | "proposal-expired"
  | "check-in-7d"
  | "feedback-30d"
  | "review-request"
  | "seasonal-check"
  | "service-reminder"
  | "paperwork-overdue"
  | "warranty-due"
  | "proposal-late"
  | "survey-unassigned";

export const DAILY_JOB_IDS: DailyJobId[] = [
  "survey-reminder",
  "install-prep",
  "install-day-before",
  "proposal-reminder",
  "proposal-expired",
  "check-in-7d",
  "feedback-30d",
  "review-request",
  "seasonal-check",
  "service-reminder",
  "paperwork-overdue",
  "warranty-due",
  "proposal-late",
  "survey-unassigned",
];

export const DAILY_JOB_LABEL: Record<DailyJobId, string> = {
  "survey-reminder": "Survey reminders (day before)",
  "install-prep": "Install prep (3 days before)",
  "install-day-before": "Install day-before texts",
  "proposal-reminder": "Proposal reminders (3 days after issue)",
  "proposal-expired": "Proposals expired",
  "check-in-7d": "7-day check-ins",
  "feedback-30d": "30-day feedback requests",
  "review-request": "Review requests",
  "seasonal-check": "Change-of-season checks",
  "service-reminder": "Service reminders",
  "paperwork-overdue": "Overdue certificates (team alerts)",
  "warranty-due": "Warranty registrations coming due (team alerts)",
  "proposal-late": "Proposals past the date we gave (team alerts)",
  "survey-unassigned": "Surveys with no surveyor, the working day before (team alerts)",
};

type NotifyJob = Exclude<DailyJobId, "proposal-expired">;
type NotifyEvent = Exclude<NotifyJob, "paperwork-overdue" | "warranty-due" | "proposal-late" | "survey-unassigned"> | "team-alert";

export type DailyJob =
  | {
      kind: "notify";
      job: NotifyJob;
      projectId: string;
      event: NotifyEvent;
      data: CommsData[NotifyEvent];
      discriminator: string;
      /** Recorded on the project once the message is out (sent, demo, queued or already there). */
      record?: ProjectAction;
    }
  | { kind: "dispatch"; job: "proposal-expired"; projectId: string; action: ProjectAction };

/** The first warranty registration alert, this many days before the date we gave. */
export const WARRANTY_ALERT_DAYS_BEFORE = 14;
/** Days a reminder is sent ahead of its appointment. */
export const SURVEY_REMINDER_DAYS_BEFORE = 1;
export const INSTALL_PREP_DAYS_BEFORE = 3;
export const INSTALL_DAY_BEFORE = 1;
/** The proposal nudge, once, this many days after issue while it's still open. */
export const PROPOSAL_REMINDER_AFTER_DAYS = 3;
export const CHECK_IN_DAYS = 7;
export const FEEDBACK_DAYS = 30;
/**
 * How late a missed check-in or feedback request may still go out (a cron
 * that was off for a while, or a project moved over from the old system):
 * after that window it would read oddly, so it's skipped.
 */
export const CHECK_IN_LAST_DAY = 21;
export const FEEDBACK_LAST_DAY = 60;
/** The service reminder goes out this many days before the service is due. */
export const SERVICE_REMINDER_DAYS_BEFORE = 30;
/**
 * The certificates that must reach the customer within 30 days of completion
 * (Building Regulations 2010 reg 20; handoverDeadlines): the team hears once
 * a week while one is overdue, until it's in.
 */
export const PAPERWORK_ALERT_EVERY_DAYS = 7;
/**
 * The proposal date the customer was given (survey-complete email, hub):
 * once it passes, the team hears the next day and every few days after,
 * until it's issued. The hub says sorry instead of showing the old date.
 */
export const PROPOSAL_LATE_ALERT_EVERY_DAYS = 3;

const dateOf = (iso: string) => iso.slice(0, 10);

/** yyyy-mm-dd plus n calendar days. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** What the checklist knows that the project doesn't: is the heat pump's own Building Regulations certificate in? */
export interface DailyFacts {
  /** heat-pump-compliance-certificate approved (or not applicable): false while it's still to come; absent when there's no checklist. */
  heatPumpCertSettled?: boolean;
}

/** Today's jobs for one project, in the order they should run. */
export function dailyJobsFor(project: Project, todayIso: string, settings: PilotSettings, facts: DailyFacts = {}): DailyJob[] {
  const p = project;
  const today = dateOf(todayIso);
  const jobs: DailyJob[] = [];
  if (p.closure.reason === "cancelled") return jobs;
  const live = !p.closure.closed;

  const notify = <E extends NotifyEvent>(event: E, data: CommsData[E], discriminator: string, record?: ProjectAction) =>
    jobs.push({ kind: "notify", job: event, projectId: p.id, event, data, discriminator, ...(record ? { record } : {}) } as DailyJob);

  // Survey: the day before, introducing whoever's coming.
  if (live && p.survey.status === "booked" && p.survey.scheduledFor) {
    const until = daysBetween(today, p.survey.scheduledFor);
    if (until === SURVEY_REMINDER_DAYS_BEFORE) {
      notify(
        "survey-reminder",
        {
          scheduledFor: p.survey.scheduledFor,
          durationMinutes: p.survey.durationMinutes,
          mode: p.survey.mode,
          ...(p.survey.surveyor?.name ? { surveyorName: p.survey.surveyor.name } : {}),
        },
        p.survey.scheduledFor,
      );
    }
  }

  // A survey nobody is down to do (the family booked the slot from their page): the team hears
  // once, on the working day before (or on the day, if that run was missed).
  if (live && p.survey.status === "booked" && p.survey.scheduledFor && !p.survey.surveyor) {
    const on = dateOf(p.survey.scheduledFor);
    const dayBefore = addWorkingDays(on, -1, settings.scheduling.workingDays);
    if (today >= dayBefore && today <= on) {
      const at = p.survey.scheduledFor.slice(11, 16);
      jobs.push({
        kind: "notify",
        job: "survey-unassigned",
        projectId: p.id,
        event: "team-alert",
        data: {
          title: `No surveyor for ${p.customer.name || "a customer"}'s survey ${today === on ? "today" : `on ${on}`}${at ? ` at ${at}` : ""}`,
          lines: [
            "The home survey is booked (often by the family, from their page) and nobody is down to do it.",
            "Open the project and assign a surveyor (Survey, Assign), or call the family to move it.",
          ],
          urgent: true,
        },
        discriminator: `survey-unassigned:${p.survey.scheduledFor}`,
      });
    }
  }

  // Install: the prep list a few days out (a missed run catches up the day
  // after), then the day-before text with the crew's names.
  if (live && p.booking.status === "booked" && p.booking.startDate && p.install.status === "not-started") {
    const start = p.booking.startDate;
    const until = daysBetween(today, start);
    if (until <= INSTALL_PREP_DAYS_BEFORE && until > INSTALL_DAY_BEFORE) {
      notify(
        "install-prep",
        { startDate: start, prep: p.booking.prep.filter((i) => i.confirmable && !i.done).map((i) => i.label) },
        start,
      );
    }
    if (until === INSTALL_DAY_BEFORE) {
      notify(
        "install-day-before",
        {
          startDate: start,
          crewNames: p.booking.crew.map((c) => c.name).filter(Boolean),
          ...(p.customer.parkingNotes ? { parkingNotes: p.customer.parkingNotes } : {}),
        },
        start,
      );
    }
  }

  // Proposal: one nudge while it's open, and the expiry once it's lapsed.
  const open = p.proposal.status === "issued" || p.proposal.status === "changes-requested";
  const validUntil = p.proposal.validUntil ? dateOf(p.proposal.validUntil) : undefined;
  if (live && open && validUntil && validUntil < today) {
    jobs.push({ kind: "dispatch", job: "proposal-expired", projectId: p.id, action: { type: "proposal-expired" } });
  } else if (live && p.proposal.status === "issued" && p.proposal.issuedAt && validUntil) {
    if (daysBetween(p.proposal.issuedAt, today) >= PROPOSAL_REMINDER_AFTER_DAYS) {
      notify(
        "proposal-reminder",
        { ...(p.proposal.version ? { version: p.proposal.version } : {}), validUntil },
        p.proposal.proposalId ?? `v${p.proposal.version ?? 1}`,
      );
    }
  }

  // Aftercare (continues after the project closes, unless it was cancelled).
  const handed = p.handover.status === "handed-over" && p.handover.handedOverAt ? dateOf(p.handover.handedOverAt) : null;
  if (handed) {
    const since = daysBetween(handed, today);
    if (!p.aftercare.checkIn7dSentAt && since >= CHECK_IN_DAYS && since <= CHECK_IN_LAST_DAY) {
      notify("check-in-7d", {}, handed, { type: "aftercare-checkin-sent" });
    }
    // Everyone, whatever they'd say: an internal score, never a gate.
    if (!p.aftercare.feedbackRequestedAt && since >= FEEDBACK_DAYS && since <= FEEDBACK_LAST_DAY) {
      notify("feedback-30d", {}, handed, { type: "feedback-requested" });
    }
    if (reviewRequestDue(p, today, settings)) {
      notify("review-request", {}, handed, { type: "review-requested" });
    }
    if (seasonalCheckDue(p, today)) {
      const check = seasonalCheck(p)!;
      notify("seasonal-check", { mode: check.mode }, check.on, { type: "seasonal-check-sent" });
    }
  }
  // Paperwork the law gives 30 days for: the electrical certificate (and,
  // through the compliance checklist, the heat pump's own certificate and
  // commissioning notice). A team alert, weekly, while it's overdue.
  if (p.install.status === "complete" && p.install.completedAt && p.handover.electricalCert === "pending") {
    const due = handoverDeadlines(dateOf(p.install.completedAt)).electricalCertDueBy;
    const late = daysBetween(due, today);
    if (late > 0 && (late - 1) % PAPERWORK_ALERT_EVERY_DAYS === 0) {
      jobs.push({
        kind: "notify",
        job: "paperwork-overdue",
        projectId: p.id,
        event: "team-alert",
        data: {
          title: `Overdue: the electrical certificate for ${p.customer.name || "a customer"}`,
          lines: [
            `It was due to reach the customer by ${due} (30 days after completion), and it isn't recorded yet.`,
            "Chase the electrician's scheme, then add the certificate (file and number) on the command centre.",
            "Check the heat pump's Building Regulations certificate and commissioning notice on the compliance checklist too.",
          ],
          urgent: true,
        },
        discriminator: `paperwork-overdue:${due}:${late}`,
      });
    }
  }
  // The heat pump's own Building Regulations certificate (from the competent person scheme, or the council's
  // completion certificate): the same 30 days and the same weekly alert, from its checklist item.
  if (p.install.status === "complete" && p.install.completedAt && facts.heatPumpCertSettled === false) {
    const due = handoverDeadlines(dateOf(p.install.completedAt)).electricalCertDueBy;
    const late = daysBetween(due, today);
    if (late > 0 && (late - 1) % PAPERWORK_ALERT_EVERY_DAYS === 0) {
      jobs.push({
        kind: "notify",
        job: "paperwork-overdue",
        projectId: p.id,
        event: "team-alert",
        data: {
          title: `Overdue: the heat pump's Building Regulations certificate for ${p.customer.name || "a customer"}`,
          lines: [
            `It was due to reach the customer by ${due} (30 days after completion), and its checklist item isn't approved yet.`,
            "Chase the competent person scheme (or building control for a council application), email the certificate to the family, and attach it to \"Building Regulations certificate for the heat pump, to the customer\" on the compliance checklist.",
          ],
          urgent: true,
        },
        discriminator: `paperwork-overdue:heat-pump:${due}:${late}`,
      });
    }
  }
  // The manufacturer warranty registration: the date is ours to keep (an extended warranty can be lost
  // after it), so the team hears 14 and 7 days ahead, on the day, then weekly while it's late.
  if (p.handover.status !== "pending" && !p.handover.warrantyRegistered && p.handover.warrantyDueOn) {
    const due = dateOf(p.handover.warrantyDueOn);
    const left = daysBetween(today, due);
    const late = -left;
    if (left === WARRANTY_ALERT_DAYS_BEFORE || left === 7 || left === 0 || (late > 0 && late % PAPERWORK_ALERT_EVERY_DAYS === 0)) {
      jobs.push({
        kind: "notify",
        job: "warranty-due",
        projectId: p.id,
        event: "team-alert",
        data: {
          title: late > 0 ? `Overdue: the warranty registration for ${p.customer.name || "a customer"}` : `Warranty registration due ${left === 0 ? "today" : `in ${left} days`} for ${p.customer.name || "a customer"}`,
          lines: [
            `We told them we'd register the manufacturer's warranty by ${due}${late > 0 ? `, ${late} day${late === 1 ? "" : "s"} ago` : ""}.`,
            "Register it with the manufacturer (check their own deadline, which counts from commissioning), then record it on the command centre's Handover box.",
          ],
          urgent: late > 0,
        },
        discriminator: `warranty-due:${due}:${left}`,
      });
    }
  }
  if (live && proposalOverdue(p, today)) {
    const by = proposalPromisedBy(p)!;
    const late = daysBetween(by, today);
    if ((late - 1) % PROPOSAL_LATE_ALERT_EVERY_DAYS === 0) {
      jobs.push({
        kind: "notify",
        job: "proposal-late",
        projectId: p.id,
        event: "team-alert",
        data: {
          title: `Late: the proposal for ${p.customer.name || "a customer"}`,
          lines: documentsConsentCovers(p)
            ? [
                `We told them it would be with them by ${by}, and it isn't issued yet (${late} day${late === 1 ? "" : "s"} late).`,
                "Their project page now says it's taking longer than we said, with an apology. Send it, or email them a new date.",
              ]
            : [
                `We told them it would be with them by ${by}, and it isn't issued yet (${late} day${late === 1 ? "" : "s"} late).`,
                "They haven't agreed to get their documents by email, so it can't be issued: the pilot can't send them on paper. Their page asks them to agree.",
                "Get in touch and talk it through. If they agree, record it in the project's Proposal box (how and when). If they'd still rather have paper, tell them honestly that the pilot can't do paper, and close the project (Close the project, tick 'The customer withdrew before any contract', with a note).",
              ],
          urgent: late > PROPOSAL_LATE_ALERT_EVERY_DAYS,
        },
        discriminator: `proposal-late:${by}:${late}`,
      });
    }
  }
  // The yearly service, every year: the due date rolls on from handover (or the latest service recorded) until
  // the family opts out or the office closes aftercare. One reminder per due date.
  if (serviceRemindersOn(p)) {
    const due = nextServiceDueOn(p, today);
    if (due && today >= addDays(due, -SERVICE_REMINDER_DAYS_BEFORE) && today <= due) {
      notify("service-reminder", { dueOn: due }, due);
    }
  }
  return jobs;
}

/** Statuses after which the job counts as done for the day (the message exists). */
export const DONE_STATUSES = ["sent", "demo", "queued", "duplicate"] as const;

export interface DailyOpsSummary {
  at: string;
  today: string;
  projects: number;
  jobs: Record<DailyJobId, { planned: number; done: number; skipped: number; failed: number }>;
  errors: string[];
  outbox: { due: number; sent: number; demo: number; failed: number; skipped: number; errors: number };
}

export function emptySummary(at: string, today: string): DailyOpsSummary {
  const jobs = Object.fromEntries(DAILY_JOB_IDS.map((id) => [id, { planned: 0, done: 0, skipped: 0, failed: 0 }])) as DailyOpsSummary["jobs"];
  return { at, today, projects: 0, jobs, errors: [], outbox: { due: 0, sent: 0, demo: 0, failed: 0, skipped: 0, errors: 0 } };
}
