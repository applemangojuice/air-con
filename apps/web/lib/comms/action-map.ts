import {
  CANCELLATION_RULE_STATUS,
  baseIdempotencyKey,
  cancellationStatus,
  documentsConsentCovers,
  earlyStartRequestedOf,
  type CommsEventId,
  type MessageRecord,
  type Project,
  type ProjectAction,
  PROPOSAL_TURNAROUND_WORKING_DAYS,
  shiftWorkingDays,
} from "@aircon/domain";
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

/** How long we tell customers the proposal takes after the survey: the domain's one number. */
export { PROPOSAL_TURNAROUND_WORKING_DAYS };

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

/** Working days on (weekends and bank holidays skipped: the domain's rule, as the reducer promises it). */
function addWorkingDays(dateIso: string, n: number): string {
  return n > 0 ? shiftWorkingDays(dateIso, n) : dateIso.slice(0, 10);
}

const lastEventAt = (p: Project, type: string) => [...p.events].reverse().find((e) => e.type === type)?.at;

/**
 * The crew member customers hear from: the technical lead, else the person
 * who did it (when they're on the crew), else an employed installer. Never an
 * arbitrary subcontractor: an update signed by someone the customer hasn't
 * been introduced to as in charge reads as if nobody is.
 */
export function crewLead(p: Project, actor?: ActorLike | null): Project["booking"]["crew"][number] | undefined {
  const crew = p.booking.crew;
  return (
    crew.find((c) => c.role === "tech-lead") ??
    (actor?.staffId ? crew.find((c) => c.staffId === actor.staffId) : undefined) ??
    crew.find((c) => c.role === "installer" && !c.external)
  );
}

/**
 * Supply and install: the goods are in their possession, so the
 * cancellation period has started (startGoodsPeriod in the reducer): one
 * email with the exact last day they can cancel without a reason, the date
 * the contract email promised to tell them. Keyed on the day it started, so
 * a later kit update or a retry never sends it twice, and a period held open
 * for more kit and restarted later gets its own.
 */
function goodsPeriodStarted(p: Project): AnyNotice[] {
  const on = p.proposal.goodsReceivedOn;
  if (p.proposal.status !== "accepted" || p.proposal.contractType !== "supply-and-install" || !on) return [];
  const cs = cancellationStatus(p, on);
  if (!cs.endsOn) return [];
  return [
    notice(
      "cancellation-period",
      {
        startedOn: on,
        endsOn: cs.endsOn,
        ...(p.kit.deliveredTo === "elsewhere" ? { withCrew: true } : {}),
        ...(earlyStartRequestedOf(p) ? { earlyStart: true } : {}),
      },
      `goods:${on}`,
    ),
  ];
}

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
          {
            proposalBy: submitted ? addWorkingDays(submitted, PROPOSAL_TURNAROUND_WORKING_DAYS) : undefined,
            // Not agreed at the survey: the proposal can't go until they do, so the email asks (never "nothing to do").
            ...(documentsConsentCovers(p) ? {} : { needsDocumentsConsent: true }),
          },
          action.surveyRecordId,
        ),
      ];
    }

    // The issue email is the durable copy of the pre-contract information
    // (the outbox records preContractInfoSentAt once it has gone: see
    // followUpForDelivered). Keyed on the proposal id, which
    // followUpForDelivered reads back. for-action adds
    // the proposal record's options and prices; the project's rooms stand in
    // if it can't be read.
    case "proposal-issued":
      return [
        notice(
          "proposal-issued",
          {
            version: action.version,
            validUntil: action.validUntil,
            optionCount: action.optionCount,
            engineerApproved: p.design.status === "approved",
            contractType: p.proposal.contractType,
            rooms: p.quoteSummary.roomDesigns.map((r) => `${r.name}: ${r.unitLabel}`),
            ...(p.booking.installDays ? { installDays: p.booking.installDays } : {}),
          },
          action.proposalId,
        ),
      ];

    case "proposal-accepted": {
      // The end date as the law counts it (install-only: from today;
      // supply-and-install: unknown until the goods arrive).
      const ends = cancellationStatus(p, "").endsOn;
      const supply = p.proposal.contractType !== "install-only";
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
            contractType: p.proposal.contractType,
            ...(p.proposal.earlyStart?.wordingVersion ? { earlyStartWordingVersion: p.proposal.earlyStart.wordingVersion } : {}),
          },
          action.proposalId,
        ),
        notice(
          "team-alert",
          {
            title: `Proposal accepted: ${who}, ${money(action.contractTotalPence)}`,
            lines: [
              `${action.optionLabel} (proposal version ${action.version}), ${supply ? "supply and install" : "install only"}`,
              action.earlyStartRequested
                ? "Early start ticked on the portal. It only counts once the customer's reply to the confirmation email (or a signed form) is recorded as evidence."
                : ends
                  ? `No early start: the install can't start until the cancellation period ends (${fmtDate(ends)}).`
                  : "No early start: the install can only start once the cancellation period ends, 14 days after the kit is delivered.",
              "Next: agree install dates and assign a qualified crew.",
              CANCELLATION_RULE_STATUS,
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

    // Delivered before the booking was confirmed: the same "delivered" email
    // (one discriminator, so the later kit-updated never sends it twice).
    case "goods-received":
      return [notice("kit-update", { status: "delivered", shortages: 0, deliveredTo: "customer", supplied: true }, "delivered:0"), ...goodsPeriodStarted(p)];

    case "kit-updated": {
      if (action.status !== "confirmed" && action.status !== "delivered" && action.status !== "inspected") return [];
      const discriminator =
        action.status === "confirmed" ? `confirmed:${p.kit.expectedDate ?? "-"}` : `${action.status}:${action.shortages}`;
      return [
        notice(
          "kit-update",
          {
            status: action.status,
            expectedDate: p.kit.expectedDate,
            shortages: action.shortages,
            // At their home, or with us until the crew brings it: the email never says "delivered" for the second.
            ...(action.status !== "confirmed" && p.kit.deliveredTo ? { deliveredTo: p.kit.deliveredTo } : {}),
            // Confirmed: where it's going (a delivery to their home needs someone in).
            ...(action.status === "confirmed" && action.deliveredTo ? { deliveredTo: action.deliveredTo } : {}),
            supplied: p.proposal.contractType !== "install-only",
          },
          discriminator,
        ),
        ...goodsPeriodStarted(p),
      ];
    }

    // Kit we held (our store, the installer, a subcontractor) reaches them with the crew on day 1: the period starts.
    case "install-day-started":
      return action.n === 1 ? goodsPeriodStarted(p) : [];

    case "installer-on-my-way": {
      const at = p.install.onMyWay?.at ?? "";
      return [
        notice(
          "installer-on-my-way",
          { etaMinutes: action.etaMinutes, at, name: action.by || crewLead(p, actor)?.name },
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
            by: crewLead(p, actor)?.name,
            // Ended after commissioning (the day the install completed on): nothing is "next" any more.
            ...(p.install.status === "complete" ? { complete: { handoverPack: Boolean(p.handover.packDocumentId) } } : {}),
          },
          `day-${action.n}`,
        ),
      ];
    }

    case "handover-pack-published":
      return [
        notice("handover-ready", { electricalCertPending: p.handover.electricalCert === "pending" }, action.documentId),
      ];

    // Documents that arrive after the pack: the pack email promised to say
    // when they're there. Before the pack is out, handover-ready covers them.
    case "electrical-cert-updated":
      if (action.status !== "received" || !p.handover.packDocumentId) return [];
      return [notice("certificate-issued", { kind: "electrical-certificate" }, "electrical-certificate")];

    case "warranty-registered":
      if (!p.handover.packDocumentId) return [];
      return [notice("certificate-issued", { kind: "warranty-confirmation" }, "warranty-confirmation")];

    // Recorded by the outbox once the issue or acceptance email has gone
    // (see followUpForDelivered): they must never send anything themselves,
    // or the two could feed each other.
    case "pre-contract-info-sent":
    case "contract-confirmation-sent":
      return [];

    default:
      return [];
  }
}

/** The occurrence a stored message was keyed on (idempotencyKey: event:project:discriminator:channel, maybe re-addressed). */
function discriminatorOf(key: string): string {
  const parts = baseIdempotencyKey(key).split(":");
  return parts.length >= 4 ? parts.slice(2, -1).join(":") : "";
}

/**
 * What a delivered message records on its project, if anything. Called by
 * the outbox whenever a message is sent (or stored in demo mode): on the
 * first send, a cron retry or a resend alike. Two contract facts:
 *  * the issue email (Schedule 2 information, cancellation instructions and
 *    the model form on a durable medium, CCR regs 10 and 12) sets
 *    preContractInfoSentAt for that proposal version, which acceptance needs;
 *  * the acceptance email (the customer's contract copy) sets
 *    confirmationSentAt, which ready-to-install needs (reg 12(4)).
 * A message stored in demo mode was never delivered, so it counts only where
 * nothing is real (`demoCounts`: a demo deployment or development), and the
 * event says "demo mode". On a live deployment a demo or failed send records
 * nothing, so the gates hold until the email really goes. The actions
 * returned send nothing (commsForAction maps them to []) and are idempotent,
 * so this can't loop.
 *
 * Only a delivery to the project's current email counts (`currentEmail`):
 * a copy that went to an address staff have since corrected or removed
 * reached someone else, not the customer, so it's no durable medium.
 */
export function followUpForDelivered(
  message: Pick<MessageRecord, "id" | "event" | "channel" | "projectId" | "idempotencyKey" | "to">,
  status: "sent" | "demo",
  opts: { demoCounts: boolean; currentEmail: string | null | undefined },
): { projectId: string; action: ProjectAction } | null {
  if (message.channel !== "email" || !message.projectId) return null;
  if (status === "demo" && !opts.demoCounts) return null;
  const current = opts.currentEmail?.trim().toLowerCase();
  if (!current || message.to.trim().toLowerCase() !== current) return null;
  const demo = status === "demo" ? { demo: true } : {};
  if (message.event === "proposal-issued") {
    const proposalId = discriminatorOf(message.idempotencyKey);
    if (!proposalId || proposalId === "-") return null;
    return { projectId: message.projectId, action: { type: "pre-contract-info-sent", proposalId, messageId: message.id, ...demo } };
  }
  if (message.event === "proposal-accepted") {
    return { projectId: message.projectId, action: { type: "contract-confirmation-sent", messageId: message.id, ...demo } };
  }
  return null;
}
