import type { CommsEventId } from "@aircon/domain";
import { demoModeAllowed } from "@/lib/auth/demo-guard";
import { customerLink } from "@/lib/auth/magic";
import { appUrl } from "@/lib/brand";
import { emailConfigured, sendEmailResult, teamInbox } from "@/lib/email";
import { dispatch, loadProject } from "@/lib/project-service";
import { sendSms, smsConfigured } from "@/lib/providers/sms";
import * as customersRepo from "@/lib/repo/customers";
import { messageStore } from "@/lib/repo/messages";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";
import { stopLink } from "@/lib/follow-up-stop";
import { followUpForDelivered } from "./action-map";
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
    stopLink: (projectId) => stopLink(appUrl(), projectId),
    // The customer record's own answer: marketing is only ever a consent when it was ticked.
    marketingConsent: async (project) => {
      const id = project?.customer.customerId;
      if (!id) return false;
      const customer = await customersRepo.get(id);
      return Boolean(customer?.marketingConsent);
    },
    email: {
      provider: "resend",
      configured: emailConfigured,
      // A refusal, an unreachable Resend and no answer within EMAIL_TIMEOUT_MS are all "failed": the cron retries.
      send: (to, subject, html, opts) => sendEmailResult(to, subject, html, opts),
    },
    sms: { provider: "twilio", configured: smsConfigured, send: sendSms },
    // The issue and acceptance emails reaching the customer are contract
    // facts (preContractInfoSentAt, confirmationSentAt). A demo store counts
    // only on a demo deployment or in development, where nothing is real.
    onDelivered: async (message, status) => {
      if (message.event !== "proposal-issued" && message.event !== "proposal-accepted") return;
      // Only a copy that reached the project's current email is the customer's.
      const current = message.projectId ? (await loadProject(message.projectId))?.customer.email : undefined;
      const next = followUpForDelivered(message, status, { demoCounts: await demoModeAllowed(), currentEmail: current });
      if (!next) return;
      const result = await dispatch(next.projectId, next.action, { kind: "system", name: "outbox" });
      if ("error" in result) console.error(`[outbox] couldn't record ${next.action.type} on ${next.projectId}:`, result.error);
    },
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
