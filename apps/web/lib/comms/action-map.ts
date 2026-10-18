import type { CommsEventId, Project, ProjectAction } from "@aircon/domain";
import { fmtDate, fmtDayTime, money } from "../format.ts";
import type { CommsData } from "./templates.ts";

/**
 * Which messages a project action sends (contract §H), as data: pure, so the
 * mapping and its idempotency discriminators are tested without I/O.
 * `for-action.ts` hands each notice to the outbox.
 *
 * `project` is the state AFTER the action. Discriminators name the
 * occurrence, so a retried dispatch maps to the same keys while a genuinely
 * new event (a new slot, a new proposal version, a different ETA) gets its
 * own message.
 */

export type Notice<E extends CommsEventId = CommsEventId> = { event: E; data: CommsData[E]; discriminator: string };
export type AnyNotice = { [E in CommsEventId]: Notice<E> }[CommsEventId];

/** Who did it. A `staffId` means a staff member (ops or field); without one it was the customer or the system. */
export interface ActorLike {
  name?: string;
  staffId?: string;
  id?: string;
}

const byStaff = (actor: ActorLike | null | undefined) => Boolean(actor?.staffId);

/** How long we tell customers the proposal takes after the survey. */
export const PROPOSAL_TURNAROUND_WORKING_DAYS = 5;

const notice = <E extends CommsEventId>(event: E, data: CommsData[E], discriminator: string): AnyNotice =>
  ({ event, data, discriminator }) as AnyNotice;

/** Short, stable fingerprint for free text (FNV-1a, 32-bit, base 36). */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.trim().replace(/\s+/g, " ")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function addWorkingDays(dateIso: string, n: number): string {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

const lastEventAt = (p: Project, type: string) => [...p.events].reverse().find((e) => e.type === type)?.at;

/** The crew member customers hear from: the installer, else whoever's first. */
const crewLead = (p: Project) => p.booking.crew.find((c) => c.role === "installer") ?? p.booking.crew[0];

export function commsForAction(project: Project, action: ProjectAction, actor?: ActorLike | null): AnyNotice[] {
  const p = project;
  const who = p.customer.name || "Customer";
  switch (action.type) {
    case "book-survey":
    case "ops-book-survey":
    case "reschedule-survey": {
      const at = p.survey.scheduledFor;
      if (!at) return [];
      const moved = action.type === "reschedule-survey";
      const out: AnyNotice[] = [
        notice(
          "survey-booked",
          {
            scheduledFor: at,
            durationMinutes: p.survey.durationMinutes,
            mode: p.survey.mode,
            surveyorName: p.survey.surveyor?.name,
            rescheduled: moved,
            feeGbp: p.survey.feeGbp,
          },
          at,
        ),
      ];
      // The customer booked it themselves: the team needs to know now.
      if (!byStaff(actor)) {
        out.push(
          notice(
            "team-alert",
            {
              title: `Survey ${moved ? "moved" : "booked"}: ${who}, ${fmtDayTime(at)}`,
              lines: [
                p.survey.mode === "video" ? "Video survey" : "Home visit",
                p.survey.surveyor ? `Surveyor: ${p.survey.surveyor.name}` : "No surveyor assigned yet",
              ],
            },
            `survey-booked:${at}`,
          ),
        );
      }
      return out;
    }

    case "surveyor-on-my-way":
      return [
        notice(
          "surveyor-on-my-way",
          { etaMinutes: action.etaMinutes, at: p.survey.onMyWay?.at ?? "", name: action.by || p.survey.surveyor?.name },
          `${p.survey.scheduledFor ?? "-"}:${action.etaMinutes}`,
        ),
      ];

    case "survey-submitted": {
      const submitted = p.survey.submittedAt ?? lastEventAt(p, "survey-submitted");
      return [
        notice(
          "survey-complete",
          { proposalBy: submitted ? addWorkingDays(submitted, PROPOSAL_TURNAROUND_WORKING_DAYS) : undefined },
          action.surveyRecordId,
        ),
      ];
    }

    case "proposal-issued":
      return [
        notice(
          "proposal-issued",
          {
            version: action.version,
            validUntil: action.validUntil,
            optionCount: action.optionCount,
            engineerApproved: p.design.status === "approved",
          },
          action.proposalId,
        ),
      ];

    case "proposal-accepted": {
      const ends = p.proposal.cancellationEndsOn;
      return [
        notice(
          "proposal-accepted",
          {
            version: action.version,
            optionLabel: action.optionLabel,
            contractTotalPence: action.contractTotalPence,
            acceptedAt: p.proposal.acceptedAt ?? lastEventAt(p, "proposal-accepted") ?? "",
            signedName: p.customer.name || undefined,
            cancellationEndsOn: ends,
            earlyStartRequested: action.earlyStartRequested,
            installDays: p.booking.installDays || undefined,
          },
          action.proposalId,
        ),
        notice(
          "team-alert",
          {
            title: `Proposal accepted: ${who}, ${money(action.contractTotalPence)}`,
            lines: [
              `${action.optionLabel} (proposal version ${action.version})`,
              action.earlyStartRequested
                ? "Early start requested: the install may start inside the cancellation period."
                : ends
                  ? `No early start: the install can't start until the cancellation period ends (${fmtDate(ends)}).`
                  : "No early start requested.",
              "Next: agree install dates and assign a qualified crew.",
            ],
            legalCheck: true,
          },
          `proposal-accepted:${action.proposalId}`,
        ),
      ];
    }

    case "proposal-changes-requested":
      return [
        notice(
          "proposal-changes-requested",
          { text: action.text, version: p.proposal.version },
          `${p.proposal.proposalId ?? "-"}:${textHash(action.text)}`,
        ),
      ];

    case "booking-confirmed":
    case "install-dates-set": {
      if (p.booking.status !== "booked" || p.booking.dates.length === 0) return []; // dates before confirmation: nothing to announce yet
      const dates = [...p.booking.dates].sort();
      const moved = action.type === "install-dates-set";
      // Moving back to earlier dates is a new event, so moves count themselves (the
      // reducer refuses a "move" to the dates already set, so a retry can't add one).
      const moves = p.events.filter((e) => e.type === "install-rescheduled").length;
      return [
        notice(
          "install-booked",
          {
            dates,
            crew: p.booking.crew.map((c) => ({ name: c.name, role: c.role })),
            prep: p.booking.prep.filter((i) => i.confirmable && !i.done).map((i) => i.label),
            moved,
          },
          moved ? `moved:${moves}:${dates.join(",")}` : `confirmed:${dates.join(",")}`,
        ),
      ];
    }

    case "kit-updated": {
      if (action.status !== "confirmed" && action.status !== "delivered" && action.status !== "inspected") return [];
      const discriminator =
        action.status === "confirmed" ? `confirmed:${p.kit.expectedDate ?? "-"}` : `${action.status}:${action.shortages}`;
      return [
        notice(
          "kit-update",
          { status: action.status, expectedDate: p.kit.expectedDate, shortages: action.shortages },
          discriminator,
        ),
      ];
    }

    case "installer-on-my-way": {
      const at = p.install.onMyWay?.at ?? "";
      return [
        notice(
          "installer-on-my-way",
          { etaMinutes: action.etaMinutes, at, name: action.by || crewLead(p)?.name },
          `${at.slice(0, 10) || "-"}:${action.etaMinutes}`,
        ),
      ];
    }

    case "install-day-ended": {
      if (!action.customerUpdate || !action.customerUpdate.text.trim()) return [];
      const next = p.install.days.find((d) => d.n === action.n + 1);
      return [
        notice(
          "install-day-update",
          {
            n: action.n,
            totalDays: p.booking.installDays || p.install.days.length || undefined,
            text: action.customerUpdate.text,
            photoCount: action.customerUpdate.mediaIds.length,
            nextDate: next?.date,
            by: crewLead(p)?.name,
          },
          `day-${action.n}`,
        ),
      ];
    }

    case "handover-pack-published":
      return [
        notice("handover-ready", { electricalCertPending: p.handover.electricalCert === "pending" }, action.documentId),
      ];

    default:
      return [];
  }
}
