import type { CommsEventId } from "@aircon/domain";
import { customerLink } from "@/lib/auth/magic";
import { appUrl } from "@/lib/brand";
import { emailConfigured, sendEmail, teamInbox } from "@/lib/email";
import { loadProject } from "@/lib/project-service";
import { sendSms, smsConfigured } from "@/lib/providers/sms";
import { messageStore } from "@/lib/repo/messages";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";
import {
  createOutbox,
  type ChannelResult,
  type DispatchSummary,
  type NotifyOptions,
  type NotifyResult,
  type Outbox,
} from "./outbox-core";

/**
 * The outbox, wired to the real world (contract §F): Resend for email,
 * Twilio for SMS, the settings document, v2 projects (v1 ones with their
 * quote's contact details, see project-service) and magic links. The logic
 * lives in outbox-core.ts; this file only chooses the dependencies.
 *
 *   await notify("survey-booked", { projectId, data: { scheduledFor }, discriminator: scheduledFor });
 *
 * Without a database (legacy demo mode) nothing can be keyed or recorded, so
 * nothing is sent: every channel reports `error: "No database"`.
 */

export type { ChannelResult, DispatchSummary, NotifyOptions, NotifyResult };

function realOutbox(): Outbox | null {
  const db = getServiceClient();
  if (!db) return null;
  return createOutbox({
    store: messageStore(db),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    getSettings,
    loadProject,
    customerLink,
    appUrl,
    teamInbox,
    email: {
      provider: "resend",
      configured: emailConfigured,
      // sendEmail only reports accepted / not accepted (Resend's id isn't surfaced yet).
      send: async (to, subject, html) => {
        const ok = await sendEmail(to, subject, html);
        return ok ? { ok } : { ok, error: "Resend didn't accept the message (see server logs)" };
      },
    },
    sms: { provider: "twilio", configured: smsConfigured, send: sendSms },
  });
}

const NO_DB = "No database: messages can't be recorded, so none are sent";

/** Send (or queue) one event. Never throws; see outbox-core for the statuses. */
export async function notify<E extends CommsEventId>(event: E, opts: NotifyOptions<E>): Promise<NotifyResult> {
  const outbox = realOutbox();
  if (!outbox) return { event, status: "error", results: [{ channel: "email", status: "error", error: NO_DB }] };
  return outbox.notify(event, opts);
}

/** For the outbox cron: due queued messages and retries. */
export async function dispatchDue(now?: string): Promise<DispatchSummary> {
  const outbox = realOutbox();
  if (!outbox) return { due: 0, sent: 0, demo: 0, failed: 0, skipped: 0, errors: 0 };
  return outbox.dispatchDue(now);
}

/** For the ops messages log: one more attempt of a stored message. */
export async function resend(messageId: string): Promise<ChannelResult | { status: "error"; error: string }> {
  const outbox = realOutbox();
  if (!outbox) return { status: "error", error: NO_DB };
  return outbox.resend(messageId);
}
