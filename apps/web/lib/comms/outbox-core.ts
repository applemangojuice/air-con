import { COMMS_EVENTS, idempotencyKey, type CommsEventId, type MessageRecord, type PilotSettings, type Project } from "@aircon/domain";
import type { MessageStore, StoredMessage } from "../repo/messages.ts";
import { isTextable, normaliseUkPhone } from "../providers/sms.ts";
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
  | "disabled" //    event turned off in settings
  | "no-recipient" // no usable address for this channel
  | "not-allowed" // consent doesn't allow it
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
  loadProject(id: string): Promise<Project | null>;
  /** Legacy projects keep contact details on the quote; fills gaps in `project.customer`. */
  quoteContact?(quoteId: string): Promise<{ email?: string | null; phone?: string | null } | null>;
  /** Absolute URL with a fresh single-use sign-in token for the project's customer. */
  customerLink(projectId: string, path: string): Promise<string>;
  appUrl(): string;
  teamInbox(): string | null;
  /** Marketing events only (none exist today): has this customer opted in? */
  marketingConsent?(project: Project | null): Promise<boolean>;
  email: { configured(): boolean; provider: string; send(to: string, subject: string, html: string): Promise<SendResult> };
  sms: { configured(): boolean; provider: string; send(to: string, body: string): Promise<SendResult> };
  log?(message: string, err?: unknown): void;
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
    const r: Recipient = { email: project.customer.email, phone: project.customer.phone, name: project.customer.name };
    if ((!r.email || !r.phone) && deps.quoteContact && project.quoteId) {
      const q = await deps.quoteContact(project.quoteId).catch(() => null);
      r.email ||= q?.email ?? undefined;
      r.phone ||= q?.phone ?? undefined;
    }
    return r;
  }

  async function linkFor<E extends CommsEventId>(event: E, opts: NotifyOptions<E>, projectId: string | undefined): Promise<string> {
    if (event === "magic-link") return (opts.data as CommsData["magic-link"]).link;
    const path = opts.path ?? linkPathFor(event, projectId);
    if (!path) return deps.appUrl();
    if (COMMS_EVENTS[event].audience === "customer" && projectId) {
      try {
        return await deps.customerLink(projectId, path);
      } catch (err) {
        // A link that asks them to sign in beats no message at all.
        log(`magic link for ${event} failed; sending a plain link`, err);
      }
    }
    return `${deps.appUrl()}${path}`;
  }

  /** Send one stored message now and record what happened. */
  async function dispatchMessage(m: MessageRecord, settings?: PilotSettings): Promise<ChannelResult> {
    const base = { channel: m.channel, key: m.idempotencyKey, messageId: m.id, to: m.to };
    try {
      if (settings?.comms.disabledEvents.includes(m.event)) {
        await deps.store.update(m.id, { status: "skipped", error: "Event turned off in settings before it was sent" });
        return { ...base, status: "skipped" };
      }
      const provider = m.channel === "email" ? deps.email : deps.sms;
      if (!provider.configured()) {
        await deps.store.update(m.id, { status: "demo", provider: "demo", error: undefined });
        return { ...base, status: "demo" };
      }
      let res: SendResult;
      try {
        res =
          m.channel === "email"
            ? await deps.email.send(m.to, m.subject ?? "", m.bodyHtml ?? m.bodyText)
            : await deps.sms.send(m.to, m.bodyText);
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
    const channels = opts.channels ? def.channels.filter((c) => opts.channels!.includes(c)) : def.channels;
    const fail = (error: string): NotifyResult => done(event, channels.map((channel) => ({ channel, status: "error", error })));
    try {
      const settings = await deps.getSettings();
      if (settings.comms.disabledEvents.includes(event)) {
        return done(event, channels.map((channel) => ({ channel, status: "disabled" })));
      }
      const project = opts.projectId ? await deps.loadProject(opts.projectId) : null;
      const projectId = project?.id ?? opts.projectId;
      const recipient = await recipientFor(event, opts, project, settings);
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

      const ctx = templateContext({
        settings,
        project,
        portalUrl: await linkFor(event, opts, projectId),
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
        if (opts.scheduledFor) record.scheduledFor = opts.scheduledFor;

        const inserted = await deps.store.insert(record);
        if (!inserted.ok) {
          // A concurrent notify for the same occurrence won the unique key: that's the dedupe working.
          results.push({ channel, key, to, status: inserted.duplicate ? "duplicate" : "error", error: inserted.duplicate ? undefined : inserted.error });
          continue;
        }
        results.push(later ? { channel, key, to, messageId: record.id, status: "queued" } : await dispatchMessage(record));
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

  /** A person pressed resend: one more attempt of the same message, same key, same body. */
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
