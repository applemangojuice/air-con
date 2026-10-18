import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommsEventId, MessageRecord } from "@aircon/domain";
import { requireDb } from "../supabase-server.ts";

/**
 * The outbox table (`messages`): one row per message per channel, keyed
 * unique on `idempotency_key`. The `message` JSONB is the MessageRecord and
 * the truth; the typed columns are denormalised for filters and written in
 * the same statement, so they can't drift.
 *
 * Every function takes an optional client (defaults to `requireDb()`), and
 * `messageStore(db)` bundles them for the outbox engine, so tests run the
 * real mapping against the in-memory local backend.
 */

/** A record as stored, plus the row's `updated_at` (the optimistic-lock token for `claim`). */
export type StoredMessage = MessageRecord & { updatedAt: string };

type Row = Record<string, unknown>;

const TABLE = "messages";

export function messageToRow(record: MessageRecord, updatedAt: string): Row {
  return {
    id: record.id,
    idempotency_key: record.idempotencyKey,
    project_id: record.projectId ?? null,
    event: record.event,
    channel: record.channel,
    to_address: record.to,
    status: record.status,
    provider_ref: record.providerRef ?? null,
    scheduled_for: record.scheduledFor ?? null,
    sent_at: record.sentAt ?? null,
    created_at: record.createdAt,
    updated_at: updatedAt,
    message: record,
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** JSONB first; the columns fill anything an older or hand-written row left out. */
export function rowToMessage(row: Row): StoredMessage {
  const m = (row.message && typeof row.message === "object" ? row.message : {}) as Partial<MessageRecord>;
  const record: StoredMessage = {
    id: String(row.id ?? m.id),
    idempotencyKey: String(row.idempotency_key ?? m.idempotencyKey),
    projectId: str(row.project_id) ?? m.projectId,
    event: (str(row.event) ?? m.event) as CommsEventId,
    channel: (str(row.channel) ?? m.channel) === "sms" ? "sms" : "email",
    templateVersion: typeof m.templateVersion === "number" ? m.templateVersion : 1,
    to: str(row.to_address) ?? m.to ?? "",
    subject: m.subject,
    bodyText: m.bodyText ?? "",
    bodyHtml: m.bodyHtml,
    status: (str(row.status) ?? m.status ?? "queued") as MessageRecord["status"],
    provider: m.provider,
    providerRef: str(row.provider_ref) ?? m.providerRef,
    error: m.error,
    attempts: typeof m.attempts === "number" ? m.attempts : 0,
    scheduledFor: str(row.scheduled_for) ?? m.scheduledFor,
    sentAt: str(row.sent_at) ?? m.sentAt,
    createdAt: str(row.created_at) ?? m.createdAt ?? "",
    updatedAt: str(row.updated_at) ?? str(row.created_at) ?? "",
  };
  // Optional fields stay absent rather than undefined, matching what was stored.
  for (const k of Object.keys(record) as (keyof StoredMessage)[]) if (record[k] === undefined) delete record[k];
  return record;
}

const nowIso = () => new Date().toISOString();

// uuid columns error (rather than match nothing) on junk in Postgres, so junk ids short-circuit.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

export async function get(id: string, db: SupabaseClient = requireDb()): Promise<StoredMessage | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`messages.get: ${error.message}`);
  return data ? rowToMessage(data as Row) : null;
}

export async function findByKey(key: string, db: SupabaseClient = requireDb()): Promise<StoredMessage | null> {
  const { data, error } = await db.from(TABLE).select("*").eq("idempotency_key", key).maybeSingle();
  if (error) throw new Error(`messages.findByKey: ${error.message}`);
  return data ? rowToMessage(data as Row) : null;
}

export type InsertResult = { ok: true; message: StoredMessage } | { ok: false; duplicate: boolean; error: string };

/** Insert one message. A unique-key collision (a concurrent send of the same occurrence) is `duplicate`, not an error. */
export async function insert(record: MessageRecord, db: SupabaseClient = requireDb()): Promise<InsertResult> {
  const { data, error } = await db.from(TABLE).insert(messageToRow(record, nowIso())).select("*").single();
  if (error) return { ok: false, duplicate: error.code === "23505", error: error.message };
  return { ok: true, message: rowToMessage(data as Row) };
}

/** Merge a patch into the record and rewrite JSONB + columns together. Null when the row is gone. */
export async function update(
  id: string,
  patch: Partial<Omit<MessageRecord, "id" | "idempotencyKey" | "createdAt">>,
  db: SupabaseClient = requireDb(),
): Promise<StoredMessage | null> {
  const current = await get(id, db);
  if (!current) return null;
  const { updatedAt: _prev, ...record } = current;
  const next: MessageRecord = { ...record, ...patch };
  for (const k of Object.keys(next) as (keyof MessageRecord)[]) if (next[k] === undefined) delete next[k];
  const row = messageToRow(next, nowIso());
  delete row.id;
  delete row.created_at;
  const { data, error } = await db.from(TABLE).update(row).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(`messages.update: ${error.message}`);
  return data ? rowToMessage(data as Row) : null;
}

/**
 * Optimistic claim before a send: bumps `updated_at` only if nobody else has
 * touched the row since we read it. Two cron runs (or a cron and a resend)
 * racing for the same message: exactly one gets `true`.
 */
export async function claim(id: string, expectedUpdatedAt: string, db: SupabaseClient = requireDb()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await db
    .from(TABLE)
    .update({ updated_at: nowIso() })
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("id");
  if (error) throw new Error(`messages.claim: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

export async function listForProject(projectId: string, limit = 200, db: SupabaseClient = requireDb()): Promise<StoredMessage[]> {
  if (!isUuid(projectId)) return [];
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`messages.listForProject: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToMessage);
}

export interface RecentFilter {
  status?: MessageRecord["status"];
  event?: CommsEventId;
  channel?: MessageRecord["channel"];
}

/** Newest first, for the ops messages log. */
export async function listRecent(
  limit = 100,
  filter: RecentFilter = {},
  db: SupabaseClient = requireDb(),
): Promise<StoredMessage[]> {
  let q = db.from(TABLE).select("*");
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.event) q = q.eq("event", filter.event);
  if (filter.channel) q = q.eq("channel", filter.channel);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`messages.listRecent: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToMessage);
}

/** Retries stop here; after that a person decides (resend from the messages log). */
export const MAX_ATTEMPTS = 3;

/**
 * What the outbox cron should send now, oldest first: queued messages whose
 * time has come (no schedule means "now"), and failed ones with attempts
 * left. A row touched in the last `leaseMs` counts as in flight (a `notify`
 * mid-send, or another run that just claimed it) and waits for the next run;
 * a send that crashed is picked up once the lease has run out.
 */
export async function due(
  now: string,
  opts: { maxAttempts?: number; leaseMs?: number; limit?: number } = {},
  db: SupabaseClient = requireDb(),
): Promise<StoredMessage[]> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const nowMs = Date.parse(now);
  const leaseEndsBefore = nowMs - (opts.leaseMs ?? 2 * 60_000);
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .in("status", ["queued", "failed"])
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 500);
  if (error) throw new Error(`messages.due: ${error.message}`);
  return ((data ?? []) as Row[]).map(rowToMessage).filter((m) => {
    if (Date.parse(m.updatedAt) > leaseEndsBefore) return false;
    if (m.status === "failed") return m.attempts < maxAttempts;
    return !m.scheduledFor || Date.parse(m.scheduledFor) <= nowMs;
  });
}

/** The repository as one object, bound to a client: what the outbox engine takes. */
export interface MessageStore {
  get(id: string): Promise<StoredMessage | null>;
  findByKey(key: string): Promise<StoredMessage | null>;
  insert(record: MessageRecord): Promise<InsertResult>;
  update(id: string, patch: Partial<Omit<MessageRecord, "id" | "idempotencyKey" | "createdAt">>): Promise<StoredMessage | null>;
  claim(id: string, expectedUpdatedAt: string): Promise<boolean>;
  due(now: string, opts?: { maxAttempts?: number; leaseMs?: number; limit?: number }): Promise<StoredMessage[]>;
}

export function messageStore(db: SupabaseClient = requireDb()): MessageStore {
  return {
    get: (id) => get(id, db),
    findByKey: (key) => findByKey(key, db),
    insert: (record) => insert(record, db),
    update: (id, patch) => update(id, patch, db),
    claim: (id, expected) => claim(id, expected, db),
    due: (now, opts) => due(now, opts, db),
  };
}
