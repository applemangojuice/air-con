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
 *
 * Follow-ups (FOLLOW_UP_EVENTS) aren't about work in progress, so each one
 * carries an opt-out line, and a customer who opts out never gets another.
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
  | "variation-accepted"
  | "cancellation-confirmed"
  | "issue-update"
  | "handover-ready"
  | "certificate-issued"
  | "check-in-7d"
  | "feedback-30d"
  | "review-request"
  | "seasonal-check"
  | "service-reminder"
  | "team-alert";

export interface CommsEventDef {
  id: CommsEventId;
  channels: ("email" | "sms")[];
  audience: "customer" | "team" | "staff";
  trigger: "auto" | "manual" | "cron";
  description: string;
  templateVersion: number;
  /**
   * Sent by email instead when a text can't reach the customer (no mobile
   * that takes texts, or email is live and SMS isn't): the web layer's
   * onTheWayChannel decides, and the copy that promises it reads the same.
   */
  fallback?: "email";
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
    description: "Survey booked or moved: date, time, what we'll check, what to have ready.",
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
    fallback: "email",
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
    description:
      "Your proposal is ready: link to review it, valid-until date. The durable copy of the pre-contract information: the Schedule 2 details, the cancellation instructions and the model form.",
    templateVersion: 2,
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
      "Acceptance confirmation (the contract copy): the acceptance record, the cancellation position, the cancellation information and model form, how to confirm an early start by replying, and how to choose install dates.",
    templateVersion: 2,
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
    description: "The installer is on the way, with an ETA (by email when a text can't reach them).",
    templateVersion: 1,
    fallback: "email",
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
  "variation-accepted": {
    id: "variation-accepted",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "The customer's copy of a change they agreed to: what changes, the price, and the record of their yes.",
    templateVersion: 1,
  },
  "cancellation-confirmed": {
    id: "cancellation-confirmed",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "Acknowledges the customer's cancellation: when it reached us, the refund and its deadline, and collecting any equipment.",
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
  "certificate-issued": {
    id: "certificate-issued",
    channels: ["email"],
    audience: "customer",
    trigger: "auto",
    description: "A document that arrives after handover is in the pack: the electrical installation certificate, or the manufacturer's warranty registration.",
    templateVersion: 1,
  },
  "check-in-7d": {
    id: "check-in-7d",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "A week after handover: how's it running? Link to report a problem. Opt-out line.",
    templateVersion: 2,
  },
  "feedback-30d": {
    id: "feedback-30d",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description:
      "A month after handover, to everyone: an internal 0 to 10 score and three questions, for us only. Never gated, and never tied to the review request. Opt-out line.",
    templateVersion: 2,
  },
  "review-request": {
    id: "review-request",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description:
      "Everyone at the same point after handover, in the same words, with no incentive: a link to our page on an independent review platform. Only while settings have a review link; never depends on the feedback score. Opt-out line.",
    templateVersion: 1,
  },
  "seasonal-check": {
    id: "seasonal-check",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description:
      "The first change of season after handover: tips for the mode they're about to use for the first time, and how to report a problem. Opt-out line.",
    templateVersion: 1,
  },
  "service-reminder": {
    id: "service-reminder",
    channels: ["email"],
    audience: "customer",
    trigger: "cron",
    description: "The yearly service is due soon: the date and the warranty condition; the offer to book it only with marketing consent. Opt-out line.",
    templateVersion: 3,
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
 * Messages that aren't about work in progress, a problem or money: each
 * carries an opt-out line (PECR reg 22(3)-style, though they're service
 * messages), and none goes to a customer who has opted out
 * (`project.aftercare.followUpsOptedOutAt`).
 */
export const FOLLOW_UP_EVENTS: ReadonlySet<CommsEventId> = new Set<CommsEventId>([
  "check-in-7d",
  "feedback-30d",
  "review-request",
  "seasonal-check",
  "service-reminder",
]);

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

/**
 * Marks a key as the same occurrence sent to a different address: staff
 * corrected the customer's email or mobile after the first message was
 * written, so that message went (or would have gone) to the old one.
 */
export const READDRESS_SEPARATOR = "|to=";

/** The occurrence's own key, without any re-addressing suffix. */
export function baseIdempotencyKey(key: string): string {
  const i = key.indexOf(READDRESS_SEPARATOR);
  return i < 0 ? key : key.slice(0, i);
}

/** The key for this occurrence sent to `to` instead: one message per occurrence per address, ever. */
export function readdressedKey(key: string, to: string): string {
  return `${baseIdempotencyKey(key)}${READDRESS_SEPARATOR}${to.trim().toLowerCase()}`;
}

/**
 * Stands in for a sign-in link in every stored body. Sign-in tokens are
 * minted when a message is actually handed to a provider and never stored
 * (the database keeps only sha256(token)), so a stored message, a demo
 * message or a database backup can't sign anyone in.
 */
export const LINK_PLACEHOLDER = "[[link added when sent]]";

export interface MessageRecord {
  id: string;
  idempotencyKey: string;
  projectId?: string;
  event: CommsEventId;
  channel: "email" | "sms";
  templateVersion: number;
  to: string;
  subject?: string;
  /** Stored with LINK_PLACEHOLDER where a sign-in link goes; see `linkPath`. */
  bodyText: string;
  bodyHtml?: string;
  /** The portal path the placeholder's link opens, so a later send (cron, resend) can mint a fresh one. */
  linkPath?: string;
  status: "queued" | "sent" | "failed" | "demo" | "skipped";
  provider?: string;
  providerRef?: string;
  error?: string;
  attempts: number;
  scheduledFor?: string;
  /**
   * After this it's never sent (first send, cron retry, Retry or Send
   * again): a message about an appointment (on my way, a reminder, a
   * booking) is worse than nothing once its moment has passed. Set by the
   * outbox when it writes the message (web lib/comms/expiry.ts).
   */
  expiresAt?: string;
  sentAt?: string;
  createdAt: string;
}
