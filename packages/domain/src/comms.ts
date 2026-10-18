/**
 * Comms: the registry of every message we send, and how sends stay unique.
 *
 * Each event has fixed channels, an audience and a trigger. Templates live
 * in the web app (one renderer per event); the outbox keys every message on
 * `idempotencyKey`, so a retried action, a double click or a re-run cron
 * never sends the same thing twice. "Sent" means a provider acknowledged it;
 * demo mode records the rendered message as `demo`, never as sent.
 *
 * SMS is one-way (an alphanumeric sender), so every SMS gives our phone
 * number rather than pretending replies arrive.
 */

export type CommsEventId =
  | "magic-link"
  | "survey-booked"
  | "survey-reminder"
  | "surveyor-on-my-way"
  | "survey-complete"
  | "proposal-issued"
  | "proposal-reminder"
  | "proposal-accepted"
  | "proposal-changes-requested"
  | "invoice-issued"
  | "payment-received"
  | "install-booked"
  | "kit-update"
  | "install-prep"
  | "install-day-before"
  | "installer-on-my-way"
  | "install-day-update"
  | "variation-approval"
  | "issue-update"
  | "handover-ready"
  | "check-in-7d"
  | "feedback-30d"
  | "service-reminder"
  | "team-alert";

export interface CommsEventDef {
  id: CommsEventId;
  channels: ("email" | "sms")[];
  audience: "customer" | "team" | "staff";
  trigger: "auto" | "manual" | "cron";
  description: string;
  templateVersion: number;
}

/**
 * audience: `customer` is the household on the project, `team` the shared
 * ops inbox, `staff` one named staff member. trigger: `auto` fires from a
 * dispatched action or server event, `cron` from the daily-ops job,
 * `manual` when someone presses send.
 */
export const COMMS_EVENTS: Record<CommsEventId, CommsEventDef> = {
  "magic-link": {
    id: "magic-link",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Sign-in link. Goes to whoever asked (customer or staff); the recipient is always passed explicitly.",
    templateVersion: 1,
  },
  "survey-booked": {
    id: "survey-booked",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Survey booked or moved: date, time, what we'll check, what to have ready. Calendar invite attached.",
    templateVersion: 1,
  },
  "survey-reminder": {
    id: "survey-reminder",
    channels: ["email", "sms"],
    audience: "customer",
    trigger: "cron",
    description: "The day before the survey: time, who's coming, fuse board and loft access.",
    templateVersion: 1,
  },
  "surveyor-on-my-way": {
    id: "surveyor-on-my-way",
    channels: ["sms"],
    audience: "customer",
    trigger: "auto",
    description: "The surveyor is on the way, with an ETA.",
    templateVersion: 1,
  },
  "survey-complete": {
    id: "survey-complete",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Survey done, thanks, and when to expect the proposal.",
    templateVersion: 1,
  },
  "proposal-issued": {
    id: "proposal-issued",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Your proposal is ready: link to review it, valid-until date.",
    templateVersion: 1,
  },
  "proposal-reminder": {
    id: "proposal-reminder",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "A gentle nudge before an unanswered proposal expires.",
    templateVersion: 1,
  },
  "proposal-accepted": {
    id: "proposal-accepted",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description:
      "Acceptance confirmation: the contract, cancellation information and model form (the durable copy), and how to choose install dates.",
    templateVersion: 1,
  },
  "proposal-changes-requested": {
    id: "proposal-changes-requested",
    channels: ["email"],
    audience: "team",
    trigger: "auto",
    description: "A customer asked for changes to their proposal, with what they said.",
    templateVersion: 1,
  },
  "invoice-issued": {
    id: "invoice-issued",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "A new invoice: amount, due date, how to pay (card or bank transfer with reference).",
    templateVersion: 1,
  },
  "payment-received": {
    id: "payment-received",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Receipt for a verified payment.",
    templateVersion: 1,
  },
  "install-booked": {
    id: "install-booked",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Install confirmed (or moved after confirmation): dates, the team, the prep list.",
    templateVersion: 1,
  },
  "kit-update": {
    id: "kit-update",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Kit confirmed by the supplier, delivered, or checked by the installer. Never sent on an estimate.",
    templateVersion: 1,
  },
  "install-prep": {
    id: "install-prep",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "A few days before the install: the prep checklist and the power-off warning.",
    templateVersion: 1,
  },
  "install-day-before": {
    id: "install-day-before",
    channels: ["email", "sms"],
    audience: "customer",
    trigger: "cron",
    description: "The evening before day 1: arrival time, who's coming, parking.",
    templateVersion: 1,
  },
  "installer-on-my-way": {
    id: "installer-on-my-way",
    channels: ["sms"],
    audience: "customer",
    trigger: "auto",
    description: "The installer is on the way, with an ETA.",
    templateVersion: 1,
  },
  "install-day-update": {
    id: "install-day-update",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "End-of-day update with the photos the installer picked, and what's next.",
    templateVersion: 1,
  },
  "variation-approval": {
    id: "variation-approval",
    channels: ["email", "sms"],
    audience: "customer",
    trigger: "auto",
    description: "A proposed change with its price, waiting for the customer's yes or no in the portal.",
    templateVersion: 1,
  },
  "issue-update": {
    id: "issue-update",
    channels: ["email"],
    audience: "customer",
    trigger: "manual",
    description: "An update on a reported problem or snag: what we found, what happens next, when.",
    templateVersion: 1,
  },
  "handover-ready": {
    id: "handover-ready",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "The handover pack is published: equipment, certificates, warranty, care guide.",
    templateVersion: 1,
  },
  "check-in-7d": {
    id: "check-in-7d",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "A week after handover: how's it running? Link to report a problem.",
    templateVersion: 1,
  },
  "feedback-30d": {
    id: "feedback-30d",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "A month after handover: a 0 to 10 score and three questions. Review request only if they're happy.",
    templateVersion: 1,
  },
  "service-reminder": {
    id: "service-reminder",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "The yearly service is due soon.",
    templateVersion: 1,
  },
  "team-alert": {
    id: "team-alert",
    channels: ["email"],
    audience: "team",
    trigger: "auto",
    description: "Something the team should know now: an acceptance, a payment, a safety issue, a failed send.",
    templateVersion: 1,
  },
};

/**
 * One key per (event, project, occurrence, channel). The discriminator names
 * the occurrence: the slot time for a survey booking, the proposal version,
 * the invoice id, the install day number. Same inputs, same key, one send.
 */
export function idempotencyKey(
  event: CommsEventId,
  projectId: string | null,
  discriminator: string,
  channel: "email" | "sms",
): string {
  return [event, projectId ?? "-", discriminator.trim() || "-", channel].join(":");
}

export interface MessageRecord {
  id: string;
  idempotencyKey: string;
  projectId?: string;
  event: CommsEventId;
  channel: "email" | "sms";
  templateVersion: number;
  to: string;
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
  status: "queued" | "sent" | "failed" | "demo" | "skipped";
  provider?: string;
  providerRef?: string;
  error?: string;
  attempts: number;
  scheduledFor?: string;
  sentAt?: string;
  createdAt: string;
}
