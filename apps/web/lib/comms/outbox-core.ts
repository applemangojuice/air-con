import {
  COMMS_EVENTS,
  FOLLOW_UP_EVENTS,
  LINK_PLACEHOLDER,
  idempotencyKey,
  type CommsEventId,
  type MessageRecord,
  type PilotSettings,
  type Project,
} from "@aircon/domain";
import { escapeHtml } from "../email.ts";
import type { MessageStore, StoredMessage } from "../repo/messages.ts";
import { isTextable, normaliseUkPhone } from "../providers/sms.ts";
import { onTheWayChannel } from "./on-the-way.ts";
import { linkPathFor, renderMessage, templateContext, type CommsData, type RenderedMessage } from "./templates.ts";

/**
 * The outbox engine (contract §F), with every dependency injected so tests
 * drive it against the in-memory backend and fake providers. `outbox.ts`
 * wires the real ones (Resend, Twilio, settings, projects, magic links).
 *
 * One path for every message: resolve the recipient, check the event is on
 * and allowed, key it, skip if that key exists, render, store as `queued`,
 * then send now unless it's scheduled. "sent" only ever means the provider
 * acknowledged it; with no provider configured the rendered message is kept
 * as `demo`. Nothing here throws: a message must never take a request down.
 *
 * Sign-in links are never stored. A customer message is stored with
 * LINK_PLACEHOLDER where its link goes (plus `linkPath`), and the link, with
 * a fresh single-use token, is minted at the moment a provider takes the
 * message: first send, cron retry or resend alike, so a resend never replays
 * a spent token. A demo message is never sent, so it never gets a token. A
 * magic-link message's link exists only in memory for its first send; if
 * that fails, it's not retried (the person asks for a new link).
 *
 * Follow-ups (FOLLOW_UP_EVENTS) never go to a customer who opted out, checked
 * at notify and again when a queued one is sent. A review request needs a
 * review link in settings. `onDelivered` hears about every message that was
 * sent or stored in demo mode, however it got there (first send, cron
 * retry, resend), so a delivery can be recorded on the project.
 */

export type Channel = MessageRecord["channel"];

export interface Recipient {
  email?: string | null;
  phone?: string | null;
  name?: string;
}

export interface NotifyOptions<E extends CommsEventId> {
  projectId?: string;
  /** Overrides who it goes to (a string is an email address). Required for staff messages and magic links. */
  to?: string | Recipient;
  data: CommsData[E];
  /** Names the occurrence: same event + project + discriminator + channel = one message, ever. */
  discriminator: string;
  /** In the future → stored as queued for the outbox cron; otherwise sent now. */
  scheduledFor?: string;
  /** Overrides the screen the link opens (default per event, see templates). */
  path?: string;
  /** A subset of the event's channels. */
  channels?: Channel[];
}

export type ChannelStatus =
  | "sent" //        provider acknowledged
  | "demo" //        no provider configured: stored, not sent
  | "queued" //      scheduled for later
  | "failed" //      provider refused or unreachable; the cron retries
  | "skipped" //     stored but deliberately not sent (event turned off before a queued send)
  | "duplicate" //   this occurrence already has a message
  | "disabled" //    event turned off in settings (or, for a review request, no review link)
  | "no-recipient" // no usable address for this channel
  | "not-allowed" // consent doesn't allow it, or the customer opted out of follow-ups
  | "error"; //      something broke; logged, never thrown

export interface ChannelResult {
  channel: Channel;
  status: ChannelStatus;
  key?: string;
  messageId?: string;
  to?: string;
  error?: string;
}

export interface NotifyResult {
  event: CommsEventId;
  /** The headline across channels: sent if anything was, else queued, demo, duplicate, else the first outcome. */
  status: ChannelStatus;
  results: ChannelResult[];
}

const HEADLINE: ChannelStatus[] = ["sent", "queued", "demo", "duplicate"];

/** Pure: one status that sums up a notify, for callers that don't care which channel. */
export function headline(results: ChannelResult[]): ChannelStatus {
  for (const s of HEADLINE) if (results.some((r) => r.status === s)) return s;
  return results[0]?.status ?? "no-recipient";
}

const done = (event: CommsEventId, results: ChannelResult[]): NotifyResult => ({ event, status: headline(results), results });

export interface DispatchSummary {
  due: number;
  sent: number;
  demo: number;
  failed: number;
  skipped: number;
  errors: number;
}

export interface SendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

export interface OutboxDeps {
  store: MessageStore;
  now(): string;
  newId(): string;
  getSettings(): Promise<PilotSettings>;
  /** The v2 project. A v1 project comes with its quote's email and phone filled in (v1 kept them there). */
  loadProject(id: string): Promise<Project | null>;
  /**
   * Absolute URL into the project for an email to `recipient`: with a fresh
   * single-use sign-in token for the project's customer only when
   * `recipient` is that customer's own address, else the plain page URL.
   */
  customerLink(projectId: string, path: string, recipient: string): Promise<string>;
  appUrl(): string;
  teamInbox(): string | null;
  /** Marketing events only (none exist today): has this customer opted in? */
  marketingConsent?(project: Project | null): Promise<boolean>;
  email: { configured(): boolean; provider: string; send(to: string, subject: string, html: string): Promise<SendResult> };
  sms: { configured(): boolean; provider: string; send(to: string, body: string): Promise<SendResult> };
  /**
   * A message was sent (provider acknowledged) or stored as demo. Awaited,
   * never allowed to fail the send: errors are logged.
   */
  onDelivered?(message: MessageRecord, status: "sent" | "demo"): Promise<void>;
  log?(message: string, err?: unknown): void;
}

const OPTED_OUT = "The customer opted out of follow-up messages";
const NO_REVIEW_LINK = "No review link in settings (company.reviewUrl)";

/** Pure: has this customer refused this kind of message? Only follow-ups can be refused. */
export function optedOut(event: CommsEventId, project: Pick<Project, "aftercare"> | null | undefined): boolean {
  return FOLLOW_UP_EVENTS.has(event) && Boolean(project?.aftercare?.followUpsOptedOutAt);
}

/**
 * Events that would need marketing consent. Deliberately empty: every event
 * in the registry is a service message about work the customer asked for.
 * Anything promotional added later goes here and is refused without consent.
 */
export const MARKETING_EVENTS: ReadonlySet<CommsEventId> = new Set<CommsEventId>();

/** Pure: may this event go to this person? Operational messages always may; marketing needs an opt-in. */
export function consentAllows(event: CommsEventId, marketingConsent: boolean): boolean {
  return !MARKETING_EVENTS.has(event) || marketingConsent;
}

/** Pure: the usable address for a channel, or null. Phones normalise to E.164 and must take texts. */
export function addressFor(channel: Channel, r: Recipient): string | null {
  if (channel === "email") {
    const e = r.email?.trim();
    return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  }
  const phone = normaliseUkPhone(r.phone ?? null);
  return phone && isTextable(phone) ? phone : null;
}

const asRecipient = (to: string | Recipient): Recipient => (typeof to === "string" ? { email: to } : to);

export function createOutbox(deps: OutboxDeps) {
  const log = deps.log ?? ((m: string, e?: unknown) => console.error(`[outbox] ${m}`, e ?? ""));

  async function recipientFor<E extends CommsEventId>(
    event: E,
    opts: NotifyOptions<E>,
    project: Project | null,
    settings: PilotSettings,
  ): Promise<Recipient> {
    if (opts.to) return asRecipient(opts.to);
    const audience = COMMS_EVENTS[event].audience;
    if (audience === "team") return { email: deps.teamInbox() ?? settings.company.email };
    if (audience === "staff" || !project) return {};
    // The project's own details, exactly: an empty field means "no address"
    // (staff may have removed a wrong one on purpose), never "ask the quote".
    return { email: project.customer.email, phone: project.customer.phone, name: project.customer.name };
  }

  /**
   * The one link a message carries, as stored. Customer project links and
   * magic links are the placeholder (minted at send); everything else (team
   * and staff mail, a customer message with no project) is a plain URL.
   */
  function storedLinkFor<E extends CommsEventId>(
    event: E,
    opts: NotifyOptions<E>,
    projectId: string | undefined,
  ): { portalUrl: string; linkPath?: string } {
    if (event === "magic-link") return { portalUrl: LINK_PLACEHOLDER };
    const path = opts.path ?? linkPathFor(event, projectId);
    if (!path) return { portalUrl: deps.appUrl() };
    if (COMMS_EVENTS[event].audience === "customer" && projectId) return { portalUrl: LINK_PLACEHOLDER, linkPath: path };
    return { portalUrl: `${deps.appUrl()}${path}` };
  }

  /** The link for one send of a stored message: a fresh token for the customer's own inbox, else plain. */
  async function linkForSend(m: MessageRecord & { linkPath: string }): Promise<string> {
    const plain = `${deps.appUrl()}${m.linkPath}`;
    // Texts never carry a sign-in token (the contract's links are for email).
    if (m.channel !== "email" || !m.projectId) return plain;
    try {
      return await deps.customerLink(m.projectId, m.linkPath, m.to);
    } catch (err) {
      // A link that asks them to sign in beats no message at all.
      log(`magic link for ${m.event} failed; sending a plain link`, err);
      return plain;
    }
  }

  /**
   * The message as it goes to the provider: the placeholder replaced by a
   * link minted now (or the in-memory magic link). Null when the link can't
   * be made again (a stored magic-link message).
   */
  async function contentForSend(
    m: MessageRecord,
    liveLink?: string,
  ): Promise<{ subject: string; text: string; html?: string } | null> {
    const content = { subject: m.subject ?? "", text: m.bodyText, html: m.bodyHtml };
    if (![content.subject, content.text, content.html ?? ""].some((x) => x.includes(LINK_PLACEHOLDER))) return content;
    let link = liveLink;
    if (!link) {
      if (m.event === "magic-link") return null;
      link = m.linkPath ? await linkForSend({ ...m, linkPath: m.linkPath }) : deps.appUrl();
    }
    const fill = (x: string, value: string) => x.split(LINK_PLACEHOLDER).join(value);
    return {
      subject: fill(content.subject, link),
      text: fill(content.text, link),
      ...(content.html === undefined ? {} : { html: fill(content.html, escapeHtml(link)) }),
    };
  }

  async function delivered(m: MessageRecord, status: "sent" | "demo"): Promise<void> {
    if (!deps.onDelivered) return;
    try {
      await deps.onDelivered(m, status);
    } catch (err) {
      log(`onDelivered for ${m.id} failed`, err);
    }
  }

  /** Send one stored message now and record what happened. `liveLink`: a magic link, on its first send only. */
  async function dispatchMessage(m: MessageRecord, settings?: PilotSettings, liveLink?: string): Promise<ChannelResult> {
    const base = { channel: m.channel, key: m.idempotencyKey, messageId: m.id, to: m.to };
    try {
      if (settings?.comms.disabledEvents.includes(m.event)) {
        await deps.store.update(m.id, { status: "skipped", error: "Event turned off in settings before it was sent" });
        return { ...base, status: "skipped" };
      }
      // A queued follow-up (or a resend) to someone who has opted out since.
      if (FOLLOW_UP_EVENTS.has(m.event) && m.projectId && optedOut(m.event, await deps.loadProject(m.projectId))) {
        await deps.store.update(m.id, { status: "skipped", error: OPTED_OUT });
        return { ...base, status: "skipped", error: OPTED_OUT };
      }
      const provider = m.channel === "email" ? deps.email : deps.sms;
      if (!provider.configured()) {
        await deps.store.update(m.id, { status: "demo", provider: "demo", error: undefined });
        await delivered(m, "demo");
        return { ...base, status: "demo" };
      }
      const content = await contentForSend(m, liveLink);
      if (!content) {
        const error = "Sign-in links aren't kept, so this one can't be sent again. Ask for a new link.";
        await deps.store.update(m.id, { status: "skipped", error });
        return { ...base, status: "skipped", error };
      }
      let res: SendResult;
      try {
        res =
          m.channel === "email"
            ? await deps.email.send(m.to, content.subject, content.html ?? content.text)
            : await deps.sms.send(m.to, content.text);
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      const attempts = m.attempts + 1;
      if (res.ok) {
        await deps.store.update(m.id, {
          status: "sent",
          provider: provider.provider,
          providerRef: res.providerRef,
          sentAt: deps.now(),
          attempts,
          error: undefined,
        });
        await delivered(m, "sent");
        return { ...base, status: "sent" };
      }
      const error = res.error || "The provider didn't accept the message";
      await deps.store.update(m.id, { status: "failed", provider: provider.provider, attempts, error });
      return { ...base, status: "failed", error };
    } catch (err) {
      log(`dispatch ${m.id} failed`, err);
      return { ...base, status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Queue (and normally send) one event to its recipients, once per
   * occurrence per channel. Returns what happened on each channel.
   */
  async function notify<E extends CommsEventId>(event: E, opts: NotifyOptions<E>): Promise<NotifyResult> {
    const def = COMMS_EVENTS[event];
    let channels = opts.channels ? def.channels.filter((c) => opts.channels!.includes(c)) : def.channels;
    const fail = (error: string): NotifyResult => done(event, channels.map((channel) => ({ channel, status: "error", error })));
    const live = { sms: deps.sms.configured(), email: deps.email.configured() };
    try {
      const settings = await deps.getSettings();
      if (settings.comms.disabledEvents.includes(event)) {
        return done(event, channels.map((channel) => ({ channel, status: "disabled" })));
      }
      if (event === "review-request" && !settings.company.reviewUrl) {
        return done(event, channels.map((channel) => ({ channel, status: "disabled", error: NO_REVIEW_LINK })));
      }
      const project = opts.projectId ? await deps.loadProject(opts.projectId) : null;
      if (optedOut(event, project)) {
        return done(event, channels.map((channel) => ({ channel, status: "not-allowed", error: OPTED_OUT })));
      }
      const projectId = project?.id ?? opts.projectId;
      const recipient = await recipientFor(event, opts, project, settings);
      // A text that can't reach them goes by email instead (on-my-way: COMMS_EVENTS fallback).
      if (def.fallback === "email" && (!opts.channels || opts.channels.includes("email")) && onTheWayChannel(recipient, live) === "email") {
        channels = ["email"];
      }
      const marketingOk = MARKETING_EVENTS.has(event) ? Boolean(await deps.marketingConsent?.(project)) : true;

      const results: ChannelResult[] = [];
      const pending: { channel: Channel; key: string; to: string }[] = [];
      for (const channel of channels) {
        const key = idempotencyKey(event, projectId ?? null, opts.discriminator, channel);
        if (!consentAllows(event, marketingOk)) {
          results.push({ channel, key, status: "not-allowed" });
          continue;
        }
        const to = addressFor(channel, recipient);
        if (!to) {
          results.push({ channel, key, status: "no-recipient" });
          continue;
        }
        const existing = await deps.store.findByKey(key);
        if (existing) {
          results.push({ channel, key, status: "duplicate", messageId: existing.id, to: existing.to });
          continue;
        }
        pending.push({ channel, key, to });
      }
      if (pending.length === 0) return done(event, results);

      const link = storedLinkFor(event, opts, projectId);
      const liveLink = event === "magic-link" ? (opts.data as CommsData["magic-link"]).link : undefined;
      const ctx = templateContext({
        settings,
        project,
        live,
        portalUrl: link.portalUrl,
        recipientName: recipient.name ?? (event === "magic-link" ? (opts.data as CommsData["magic-link"]).name : undefined),
      });
      const rendered: RenderedMessage = renderMessage(event, ctx, opts.data);
      const now = deps.now();
      const later = opts.scheduledFor !== undefined && Date.parse(opts.scheduledFor) > Date.parse(now);

      for (const { channel, key, to } of pending) {
        const body = channel === "sms" ? rendered.sms : rendered.text;
        if (!body) {
          results.push({ channel, key, to, status: "error", error: `No ${channel} template for ${event}` });
          continue;
        }
        const record: MessageRecord = {
          id: deps.newId(),
          idempotencyKey: key,
          event,
          channel,
          templateVersion: def.templateVersion,
          to,
          bodyText: body,
          status: "queued",
          attempts: 0,
          createdAt: now,
        };
        if (projectId) record.projectId = projectId;
        if (channel === "email") {
          record.subject = rendered.subject;
          record.bodyHtml = rendered.html;
        }
        if (link.linkPath) record.linkPath = link.linkPath;
        if (opts.scheduledFor) record.scheduledFor = opts.scheduledFor;

        const inserted = await deps.store.insert(record);
        if (!inserted.ok) {
          // A concurrent notify for the same occurrence won the unique key: that's the dedupe working.
          results.push({ channel, key, to, status: inserted.duplicate ? "duplicate" : "error", error: inserted.duplicate ? undefined : inserted.error });
          continue;
        }
        results.push(
          later ? { channel, key, to, messageId: record.id, status: "queued" } : await dispatchMessage(record, undefined, liveLink),
        );
      }
      return done(event, results);
    } catch (err) {
      log(`notify ${event} failed`, err);
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** The cron: send what's due and retry what failed (up to the repo's attempt limit). */
  async function dispatchDue(now: string = deps.now()): Promise<DispatchSummary> {
    const summary: DispatchSummary = { due: 0, sent: 0, demo: 0, failed: 0, skipped: 0, errors: 0 };
    let due: StoredMessage[];
    let settings: PilotSettings | undefined;
    try {
      [due, settings] = await Promise.all([deps.store.due(now), deps.getSettings().catch(() => undefined)]);
    } catch (err) {
      log("dispatchDue: couldn't read the outbox", err);
      summary.errors++;
      return summary;
    }
    summary.due = due.length;
    for (const m of due) {
      try {
        if (!(await deps.store.claim(m.id, m.updatedAt))) continue; // another run has it
        const r = await dispatchMessage(m, settings);
        if (r.status === "sent") summary.sent++;
        else if (r.status === "demo") summary.demo++;
        else if (r.status === "failed") summary.failed++;
        else if (r.status === "skipped") summary.skipped++;
        else summary.errors++;
      } catch (err) {
        log(`dispatchDue: ${m.id}`, err);
        summary.errors++;
      }
    }
    return summary;
  }

  /** A person pressed resend: one more attempt of the same message, same key, same body (with a freshly minted link). */
  async function resend(messageId: string): Promise<ChannelResult | { status: "error"; error: string }> {
    try {
      const m = await deps.store.get(messageId);
      if (!m) return { status: "error", error: "Message not found" };
      if (!(await deps.store.claim(m.id, m.updatedAt))) return { status: "error", error: "That message is being sent right now" };
      return await dispatchMessage(m);
    } catch (err) {
      log(`resend ${messageId} failed`, err);
      return { status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { notify, dispatchDue, resend, dispatchMessage };
}

export type Outbox = ReturnType<typeof createOutbox>;
