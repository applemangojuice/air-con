import {
  daysBetween,
  handoverDeadlines,
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
  | "paperwork-overdue";

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
};

type NotifyJob = Exclude<DailyJobId, "proposal-expired">;
type NotifyEvent = Exclude<NotifyJob, "paperwork-overdue"> | "team-alert";

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

const dateOf = (iso: string) => iso.slice(0, 10);

/** yyyy-mm-dd plus n calendar days. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's jobs for one project, in the order they should run. */
export function dailyJobsFor(project: Project, todayIso: string, settings: PilotSettings): DailyJob[] {
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
  if (p.aftercare.serviceDueOn) {
    const due = dateOf(p.aftercare.serviceDueOn);
    if (today >= addDays(due, -SERVICE_REMINDER_DAYS_BEFORE) && today <= due) {
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
