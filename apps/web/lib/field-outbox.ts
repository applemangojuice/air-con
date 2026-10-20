import type { IssueKind, MediaItem, PhotoTag, Severity, StepOutcome } from "@aircon/domain";
import { askForPersistentStorage, idbConnection } from "./idb-connection.ts";

/**
 * The phone's outbox (F6): evidence, step outcomes, clock events, issues
 * and photos queue here first, in IndexedDB, and go to the server when
 * there's signal. Captures in a loft or a back garden are never lost, a
 * retry is always safe (every op carries an id made on the phone, and the
 * server treats a repeat as success), and nothing is shown as saved until
 * the server has acknowledged it.
 *
 *   const outbox = getFieldOutbox();
 *   const photo = await outbox.enqueueMedia({ projectId, blob, tag: "gauge", … }, "Gauge photo");
 *   await outbox.enqueue({ type: "evidence", id: newId(), projectId, specId, mediaId: photo, at }, "Gauge photo");
 *
 * Photos upload in their own lane (POST /api/media, PUT, confirm, through
 * lib/media-client), and only the ops that use one wait for it, holding a
 * `local:` placeholder that's swapped for the real media id once it lands.
 * Everything else goes straight away in batches to POST /api/field/sync,
 * never behind a slow upload (a safety issue mustn't wait for a video).
 *
 * Every capture is stamped with who made it (`by`, from the signed-in
 * person the field pages tell the outbox about) and only ever sends while
 * that person is signed in on the phone: a capture queued before a sign-out
 * waits for its own author, never goes under the next person's name.
 *
 * Nothing claims to be safe on the phone unless IndexedDB took it: a write
 * that fails (the browser dropped the connection, storage full) is retried
 * on a fresh connection once, and otherwise the item is marked not kept, so
 * the badge and the slot say "keep this page open" instead of "saved".
 *
 * The queue logic is pure (top half of this file) and tested in node; the
 * IndexedDB store and the browser wiring are the bottom half, used only in
 * the browser. Gate actions (start day 1, complete, commissioning, handover)
 * never queue: they need the server's answer there and then.
 */

/* ------------------------------------------------------------------ */
/* What goes to the server                                             */
/* ------------------------------------------------------------------ */

export type TimeKind = "install" | "travel" | "commissioning" | "handover";

/** Who made a capture (staff id and name): it only sends while they're signed in. */
export interface CapturedBy {
  id: string;
  name: string;
}

export type SyncOp = (
  | {
      type: "evidence";
      id: string;
      projectId: string;
      specId: string;
      value?: number;
      ref?: string;
      note?: string;
      mediaId?: string;
      gps?: { lat: number; lng: number };
      at: string;
    }
  | { type: "step-status"; id: string; projectId: string; stepId: string; outcome: StepOutcome; reason?: string; issueId?: string; at: string }
  | { type: "time-start"; id: string; projectId: string; kind: TimeKind; dayN?: number; note?: string; gps?: { lat: number; lng: number }; at: string }
  | { type: "time-stop"; id: string; projectId: string; entryId: string; at: string }
  | {
      type: "issue";
      id: string;
      projectId: string;
      kind: IssueKind;
      title: string;
      detail?: string;
      severity: Severity;
      blocking: boolean;
      mediaIds: string[];
      variation?: { description: string; priceDeltaNetPence: number };
      at: string;
    }
) & { by?: CapturedBy };

export type SyncResult =
  | { id: string; ok: true; duplicate?: boolean }
  | { id: string; ok: false; error: string; permanent: boolean };

/** A photo, video or signature waiting to upload. */
export interface MediaJob {
  projectId: string;
  blob: Blob;
  fileName: string;
  tag: PhotoTag;
  source: MediaItem["source"];
  roomId?: string;
  caption?: string;
  customerVisible?: boolean;
  by?: CapturedBy;
}

export interface QueueItem {
  /** The op's id, or the photo's local id. */
  id: string;
  kind: "op" | "media";
  op?: SyncOp;
  media?: MediaJob;
  /** What the person did, for the sync sheet ("Gauge photo, System"). */
  label: string;
  projectId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  /** queued: will retry by itself. failed: the server said no for good; a person decides. */
  state: "queued" | "failed";
  lastError?: string;
}

export const LOCAL_MEDIA_PREFIX = "local:";

/* ------------------------------------------------------------------ */
/* Pure queue logic                                                    */
/* ------------------------------------------------------------------ */

/** 2 s, 4 s, 8 s… capped at 5 minutes, so a dead spot doesn't flatten the battery. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** The local photo ids an op is waiting for. */
export function placeholdersIn(op: SyncOp): string[] {
  const ids: string[] = [];
  if (op.type === "evidence" && op.mediaId?.startsWith(LOCAL_MEDIA_PREFIX)) ids.push(op.mediaId.slice(LOCAL_MEDIA_PREFIX.length));
  if (op.type === "issue") for (const m of op.mediaIds) if (m.startsWith(LOCAL_MEDIA_PREFIX)) ids.push(m.slice(LOCAL_MEDIA_PREFIX.length));
  return ids;
}

/** Swap a landed photo's placeholder for its real media id. */
export function resolvePlaceholder(op: SyncOp, localId: string, mediaId: string): SyncOp {
  const ph = `${LOCAL_MEDIA_PREFIX}${localId}`;
  if (op.type === "evidence" && op.mediaId === ph) return { ...op, mediaId };
  if (op.type === "issue" && op.mediaIds.includes(ph)) return { ...op, mediaIds: op.mediaIds.map((m) => (m === ph ? mediaId : m)) };
  return op;
}

/** Oldest first: the order things happened is the order the server hears them. */
export const byCreated = (a: QueueItem, b: QueueItem) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Who made this item, if the phone knew (older items have no stamp). */
export const authorOf = (item: QueueItem): CapturedBy | undefined => item.op?.by ?? item.media?.by;

/**
 * Is this item waiting for its own author to sign in? `signedIn` is who's
 * signed in on the phone (null: not known yet, so nothing stamped goes;
 * undefined: don't check). Unstamped items go as they always did.
 */
export function heldForAuthor(item: QueueItem, signedIn: string | null | undefined): boolean {
  if (signedIn === undefined) return false;
  const by = authorOf(item);
  return Boolean(by && by.id !== signedIn);
}

/** The next photo to upload: due, not failed, its author signed in, oldest first. */
export function nextMedia(items: QueueItem[], now: number, force = false, signedIn?: string | null): QueueItem | undefined {
  return [...items]
    .sort(byCreated)
    .find((i) => i.kind === "media" && i.state === "queued" && (force || i.nextAttemptAt <= now) && !heldForAuthor(i, signedIn));
}

/**
 * The next batch for /api/field/sync: due ops whose photos have landed, in
 * order, at most `max`, only the signed-in person's own (`signedIn`). A
 * time-stop waits for its own start when both are queued (the start is
 * older, so it's in the same batch or an earlier one). An op waiting for a
 * photo holds back only later captures of the same slot (the latest capture
 * is the one that counts), never anything else.
 */
export function nextBatch(items: QueueItem[], now: number, opts: { max?: number; force?: boolean; signedIn?: string | null } = {}): QueueItem[] {
  const max = opts.max ?? 50;
  const out: QueueItem[] = [];
  const slotsWaiting = new Set<string>();
  const slotOf = (op: SyncOp) => (op.type === "evidence" ? `${op.projectId}:${op.specId}` : null);
  for (const item of [...items].sort(byCreated)) {
    if (out.length >= max) break;
    if (item.kind !== "op" || !item.op || item.state !== "queued") continue;
    const slot = slotOf(item.op);
    if (placeholdersIn(item.op).length) {
      if (slot) slotsWaiting.add(slot);
      continue;
    }
    if (slot && slotsWaiting.has(slot)) continue;
    if (!opts.force && item.nextAttemptAt > now) continue;
    if (heldForAuthor(item, opts.signedIn)) continue;
    out.push(item);
  }
  return out;
}

/** What to do with each item after the server answered: drop it, park it for a person, or retry later. */
export function applyResults(
  batch: QueueItem[],
  results: SyncResult[],
  now: number,
): { done: QueueItem[]; failed: QueueItem[]; retry: QueueItem[] } {
  const byId = new Map(results.map((r) => [r.id, r]));
  const done: QueueItem[] = [];
  const failed: QueueItem[] = [];
  const retry: QueueItem[] = [];
  for (const item of batch) {
    const r = byId.get(item.id);
    if (r?.ok) done.push(item);
    else if (r && r.permanent) failed.push({ ...item, state: "failed", attempts: item.attempts + 1, lastError: r.error });
    else {
      const attempts = item.attempts + 1;
      retry.push({ ...item, attempts, nextAttemptAt: now + retryDelayMs(attempts), lastError: r?.error ?? "No answer from the server." });
    }
  }
  return { done, failed, retry };
}

/** A whole batch that never reached the server (offline, timeout, 5xx): retry everything, nothing lost. */
export function failBatch(batch: QueueItem[], error: string, now: number, opts: { permanent?: boolean } = {}): QueueItem[] {
  return batch.map((item) => {
    const attempts = item.attempts + 1;
    return opts.permanent
      ? { ...item, state: "failed" as const, attempts, lastError: error }
      : { ...item, attempts, nextAttemptAt: now + retryDelayMs(attempts), lastError: error };
  });
}

/** A photo landed: the items that used it, with the real id swapped in. */
export function afterMediaUploaded(items: QueueItem[], localId: string, mediaId: string): QueueItem[] {
  const changed: QueueItem[] = [];
  for (const item of items) {
    if (item.kind !== "op" || !item.op) continue;
    if (!placeholdersIn(item.op).includes(localId)) continue;
    changed.push({ ...item, op: resolvePlaceholder(item.op, localId, mediaId) });
  }
  return changed;
}

/** Discarding a photo takes the ops that were waiting for it with it (they could never send). */
export function discardSet(items: QueueItem[], id: string): string[] {
  const target = items.find((i) => i.id === id);
  if (!target) return [];
  if (target.kind !== "media") return [id];
  return [id, ...items.filter((i) => i.op && placeholdersIn(i.op).includes(id)).map((i) => i.id)];
}

export interface BadgeState {
  tone: "ok" | "waiting" | "offline" | "attention";
  text: string;
  waiting: number;
  failed: number;
}

/** The header badge: "All synced", "3 waiting to sync", "Offline · 3 waiting", "1 needs attention". */
export function badgeState(input: { online: boolean; items: QueueItem[]; storageOk?: boolean }): BadgeState {
  const failed = input.items.filter((i) => i.state === "failed").length;
  const waiting = input.items.length - failed;
  if (failed > 0) return { tone: "attention", text: `${failed} need${failed === 1 ? "s" : ""} attention`, waiting, failed };
  // Waiting, but only in this page's memory: closing it loses them.
  if (waiting > 0 && input.storageOk === false) return { tone: "attention", text: `Keep open · ${waiting} waiting`, waiting, failed };
  if (!input.online) return { tone: "offline", text: waiting ? `Offline · ${waiting} waiting` : "Offline", waiting, failed };
  if (waiting > 0) return { tone: "waiting", text: `${waiting} waiting to sync`, waiting, failed };
  return { tone: "ok", text: input.storageOk === false ? "Synced (not saved offline)" : "All synced", waiting, failed };
}

/** Pending captures for one job, latest per slot, for the runsheet to show as "waiting to sync". */
export function pendingEvidence(items: QueueItem[], projectId: string): Map<string, QueueItem> {
  const out = new Map<string, QueueItem>();
  for (const item of [...items].sort(byCreated)) {
    if (item.projectId !== projectId || item.op?.type !== "evidence") continue;
    out.set(item.op.specId, item);
  }
  return out;
}

/** A random id for an op (crypto.randomUUID where there is one). */
export function newOpId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ------------------------------------------------------------------ */
/* Stores                                                              */
/* ------------------------------------------------------------------ */

export interface OutboxStore {
  all(): Promise<QueueItem[]>;
  /** Resolves once it's really on the phone (the write committed); rejects when it isn't. */
  put(item: QueueItem): Promise<void>;
  delete(id: string): Promise<void>;
  /** False when the store can't persist (private browsing, storage blocked, its last write failed). */
  readonly durable: boolean;
}

export function memoryStore(): OutboxStore {
  const items = new Map<string, QueueItem>();
  return {
    durable: false,
    all: async () => [...items.values()],
    put: async (item) => void items.set(item.id, item),
    delete: async (id) => void items.delete(id),
  };
}

const DB_NAME = "dih-field-outbox";
const STORE = "items";

function openOutboxDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

/**
 * IndexedDB, one object store keyed by id, on a connection that reopens
 * itself (idb-connection). Rejects (and the caller falls back to memory)
 * where IndexedDB isn't usable at all; a write that still fails after a
 * reopen rejects, and `durable` says so until a write works again.
 */
export async function indexedDbStore(): Promise<OutboxStore> {
  if (typeof indexedDB === "undefined") throw new Error("No IndexedDB");
  const conn = idbConnection(openOutboxDb);
  await conn.ready();
  let failing = false;
  const write = async <T>(request: (s: IDBObjectStore) => IDBRequest<T>) => {
    try {
      await conn.run("readwrite", STORE, request);
      failing = false;
    } catch (err) {
      failing = true;
      throw err;
    }
  };
  return {
    get durable() {
      return !failing;
    },
    all: () => conn.run("readonly", STORE, (s) => s.getAll() as IDBRequest<QueueItem[]>),
    put: (item) => write((s) => s.put(item)),
    delete: (id) => write((s) => s.delete(id)),
  };
}

/* ------------------------------------------------------------------ */
/* The outbox                                                          */
/* ------------------------------------------------------------------ */

export interface OutboxDeps {
  store: OutboxStore;
  /** POST the batch; resolves with a result per op, or throws (offline, timeout). A Response-shaped error carries `status`. */
  send(ops: SyncOp[]): Promise<SyncResult[]>;
  /** Upload one photo; resolves with the server's media id. Throws `{ retryable: false }` for a file that can never go. */
  upload(media: MediaJob): Promise<string>;
  now(): number;
  online(): boolean;
}

export interface OutboxState {
  items: QueueItem[];
  online: boolean;
  syncing: boolean;
  /** Everything waiting is really on the phone (false: some of it is only in this page's memory). */
  durable: boolean;
  /** Who's signed in on this phone, as the field pages said (null until one has). */
  signedIn: CapturedBy | null;
  /** Ops the server acknowledged since this page loaded: shown as saved until the page's data catches up. */
  acked: SyncOp[];
  lastSyncedAt?: number;
}

export class SendError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "SendError";
    this.status = status;
  }
}

export class FieldOutbox {
  private items: QueueItem[] = [];
  private loaded: Promise<void>;
  /** Two lanes, each single-flight: ops never wait behind an upload. */
  private opsFlight: Promise<void> | null = null;
  private mediaFlight: Promise<void> | null = null;
  /** Asked again while a lane was running: run it once more when it finishes. */
  private opsAgain: boolean | null = null;
  private mediaAgain: boolean | null = null;
  private listeners = new Set<(s: OutboxState) => void>();
  private acked: SyncOp[] = [];
  private lastSyncedAt?: number;
  /** Local photo id → its server media id, for ops queued after the photo landed. */
  private landed = new Map<string, string>();
  /** Items only in memory: the phone's storage refused them. */
  private unsaved = new Set<string>();
  private signedIn: CapturedBy | null = null;
  private isLoaded = false;

  private readonly deps: OutboxDeps;

  constructor(deps: OutboxDeps) {
    this.deps = deps;
    this.loaded = deps.store
      .all()
      .then((items) => {
        this.items = items.sort(byCreated);
      })
      .catch(() => {
        this.items = [];
      })
      .then(() => {
        this.isLoaded = true;
        this.emit();
      });
  }

  ready(): Promise<void> {
    return this.loaded;
  }

  state(): OutboxState {
    return {
      items: this.items,
      online: this.deps.online(),
      syncing: Boolean(this.opsFlight || this.mediaFlight),
      // Not known until the store has opened: don't warn before then.
      durable: !this.isLoaded || (this.deps.store.durable && this.unsaved.size === 0),
      signedIn: this.signedIn,
      acked: this.acked,
      ...(this.lastSyncedAt ? { lastSyncedAt: this.lastSyncedAt } : {}),
    };
  }

  /**
   * Who's signed in on this phone (every field page says). New captures are
   * stamped with it, and only their own author's captures send.
   */
  setSignedIn(who: CapturedBy | null): void {
    if (who?.id === this.signedIn?.id && who?.name === this.signedIn?.name) return;
    this.signedIn = who ? { id: who.id, name: who.name } : null;
    this.emit();
    if (who) void this.flush(true);
  }

  subscribe(listener: (s: OutboxState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  /** Keep it (in memory at once, on the phone if the store takes it). False when it's only in memory. */
  private async save(item: QueueItem): Promise<boolean> {
    this.items = [...this.items.filter((i) => i.id !== item.id), item].sort(byCreated);
    try {
      await this.deps.store.put(item);
      this.unsaved.delete(item.id);
      return true;
    } catch (err) {
      console.error("[outbox] couldn't save to this phone:", err);
      this.unsaved.add(item.id);
      return false;
    }
  }

  private async drop(ids: string[]): Promise<void> {
    const set = new Set(ids);
    this.items = this.items.filter((i) => !set.has(i.id));
    for (const id of ids) this.unsaved.delete(id);
    for (const id of ids) {
      try {
        await this.deps.store.delete(id);
      } catch (err) {
        console.error("[outbox] couldn't remove from this phone:", err);
      }
    }
  }

  /**
   * Queue an op, stamped with who's signed in. Resolves once it's queued:
   * on the phone, or (when the phone's storage refused it) in this page's
   * memory, which `state().durable` and the badge then say. Sending happens
   * in the background.
   */
  async enqueue(op: SyncOp, label: string): Promise<void> {
    await this.loaded;
    let resolved: SyncOp = op.by || !this.signedIn ? op : { ...op, by: this.signedIn };
    for (const local of placeholdersIn(op)) {
      const real = this.landed.get(local);
      if (real) resolved = resolvePlaceholder(resolved, local, real);
    }
    await this.save({ id: op.id, kind: "op", op: resolved, label, projectId: op.projectId, createdAt: this.deps.now(), attempts: 0, nextAttemptAt: 0, state: "queued" });
    this.emit();
    void this.flush();
  }

  /** Queue a photo; resolves with the placeholder ("local:<id>") to put in the ops that use it. */
  async enqueueMedia(media: MediaJob, label: string): Promise<string> {
    await this.loaded;
    const id = newOpId();
    const stamped = media.by || !this.signedIn ? media : { ...media, by: this.signedIn };
    await this.save({ id, kind: "media", media: stamped, label, projectId: media.projectId, createdAt: this.deps.now(), attempts: 0, nextAttemptAt: 0, state: "queued" });
    this.emit();
    void this.flush();
    return `${LOCAL_MEDIA_PREFIX}${id}`;
  }

  /** Try a failed item again now. */
  async retry(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    await this.save({ ...item, state: "queued", nextAttemptAt: 0 });
    this.emit();
    void this.flush(true);
  }

  /** Give up on an item (and, for a photo, everything waiting for it). */
  async discard(id: string): Promise<void> {
    await this.drop(discardSet(this.items, id));
    this.emit();
  }

  /**
   * Send what's due: ops and photos in two lanes side by side, so no op
   * waits behind an upload. Each lane is single-flight, and a call while it
   * runs makes it go round once more when it finishes (nothing queued in
   * between is left for the next tick). Resolves when both lanes are idle.
   * `force` ignores the backoff (we just came online).
   */
  async flush(force = false): Promise<void> {
    await Promise.all([this.flushOps(force), this.flushMedia(force)]);
    // A landed photo may have set its ops going after the ops lane went idle: wait for that too.
    while (this.opsFlight || this.mediaFlight) await Promise.all([this.opsFlight, this.mediaFlight]);
  }

  private flushOps(force: boolean): Promise<void> {
    if (this.opsFlight) {
      this.opsAgain = Boolean(this.opsAgain) || force;
      return this.opsFlight;
    }
    this.opsFlight = (async () => {
      let next: boolean | null = force;
      try {
        while (next !== null) {
          this.opsAgain = null;
          await this.runOps(next);
          next = this.opsAgain;
        }
      } finally {
        this.opsFlight = null;
        this.opsAgain = null;
        this.emit();
      }
    })();
    this.emit();
    return this.opsFlight;
  }

  private flushMedia(force: boolean): Promise<void> {
    if (this.mediaFlight) {
      this.mediaAgain = Boolean(this.mediaAgain) || force;
      return this.mediaFlight;
    }
    this.mediaFlight = (async () => {
      let next: boolean | null = force;
      try {
        while (next !== null) {
          this.mediaAgain = null;
          await this.runMedia(next);
          next = this.mediaAgain;
        }
      } finally {
        this.mediaFlight = null;
        this.mediaAgain = null;
        this.emit();
      }
    })();
    this.emit();
    return this.mediaFlight;
  }

  /** Whose captures may send now: the signed-in person's (null until a field page says who that is). */
  private author(): string | null {
    return this.signedIn?.id ?? null;
  }

  private async runMedia(force: boolean): Promise<void> {
    await this.loaded;
    if (!this.deps.online()) return;
    for (let rounds = 0; rounds < 40; rounds++) {
      const media = nextMedia(this.items, this.deps.now(), force, this.author());
      if (!media?.media) return;
      try {
        const mediaId = await this.deps.upload(media.media);
        this.landed.set(media.id, mediaId);
        for (const changed of afterMediaUploaded(this.items, media.id, mediaId)) await this.save(changed);
        await this.drop([media.id]);
        this.emit();
        // The ops that were waiting for it can go now.
        void this.flushOps(false);
      } catch (err) {
        // Signed out (the 30-day sign-in ran out, or the staff check failed for a moment): the photo waits
        // for sign-in, like the ops lane, and goes by itself after, never "needs attention" for good.
        const signedOut = Boolean(err && typeof err === "object" && "status" in err && (err as { status: number | null }).status === 401);
        const retryable = signedOut || !(err && typeof err === "object" && "retryable" in err && (err as { retryable: boolean }).retryable === false);
        const message = signedOut ? "You're signed out. Sign in again and it will send." : err instanceof Error ? err.message : "The photo didn't upload.";
        const [next] = failBatch([media], message, this.deps.now(), { permanent: !retryable });
        await this.save(next!);
        this.emit();
        if (retryable) return; // signal's gone: stop and wait
      }
    }
  }

  private async runOps(force: boolean): Promise<void> {
    await this.loaded;
    if (!this.deps.online()) return;
    for (let rounds = 0; rounds < 40; rounds++) {
      const now = this.deps.now();
      const batch = nextBatch(this.items, now, { force, signedIn: this.author() });
      if (!batch.length) break;
      let results: SyncResult[];
      try {
        results = await this.deps.send(batch.map((b) => b.op!));
      } catch (err) {
        const status = err instanceof SendError ? err.status : null;
        const message =
          status === 401
            ? "You're signed out. Sign in again and these will send."
            : status === 403
              ? "You don't have permission to save these."
              : err instanceof Error
                ? err.message
                : "No connection.";
        for (const item of failBatch(batch, message, this.deps.now(), { permanent: status === 403 })) await this.save(item);
        this.emit();
        return;
      }
      const outcome = applyResults(batch, results, this.deps.now());
      await this.drop(outcome.done.map((d) => d.id));
      this.acked = [...this.acked, ...outcome.done.map((d) => d.op!)].slice(-500);
      for (const item of [...outcome.failed, ...outcome.retry]) await this.save(item);
      if (outcome.done.length) this.lastSyncedAt = this.deps.now();
      this.emit();
      if (outcome.retry.length && !outcome.done.length) return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Browser wiring                                                      */
/* ------------------------------------------------------------------ */

let singleton: FieldOutbox | null = null;

/** A sync request that hasn't answered in this long is treated as no signal (and retried), never left hanging. */
export const SYNC_TIMEOUT_MS = 30_000;

async function postBatch(ops: SyncOp[]): Promise<SyncResult[]> {
  let res: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SYNC_TIMEOUT_MS);
  try {
    res = await fetch("/api/field/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops }),
      credentials: "same-origin",
      cache: "no-store",
      signal: abort.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new SendError("No connection. It'll send when you're back in signal.", null);
  }
  const body = (await res.json().catch(() => null)) as { results?: SyncResult[]; error?: string } | null;
  clearTimeout(timer);
  // Cut off before the answer arrived: the server may have saved some (every op is idempotent), so retry them all.
  if (!body && abort.signal.aborted) throw new SendError("No connection. It'll send when you're back in signal.", null);
  if (!res.ok || !body?.results) throw new SendError(body?.error ?? `The server said no (${res.status}).`, res.status);
  return body.results;
}

/** The browser's outbox: IndexedDB when the phone allows it, else memory (and the badge says so). */
export function getFieldOutbox(): FieldOutbox {
  if (singleton) return singleton;
  let resolveStore!: (s: OutboxStore) => void;
  const storePromise = new Promise<OutboxStore>((r) => (resolveStore = r));
  indexedDbStore()
    .then(resolveStore)
    .catch(() => resolveStore(memoryStore()));
  // A store that waits for IndexedDB to open (or fail) before the first call.
  let opened: OutboxStore | null = null;
  void storePromise.then((s) => (opened = s));
  askForPersistentStorage();
  const lazy: OutboxStore = {
    get durable() {
      return opened ? opened.durable : false;
    },
    all: async () => (await storePromise).all(),
    put: async (i) => (await storePromise).put(i),
    delete: async (id) => (await storePromise).delete(id),
  };
  const outbox = new FieldOutbox({
    store: lazy,
    send: postBatch,
    upload: async (m) => {
      const { uploadMedia } = await import("./media-client");
      const item = await uploadMedia(m.blob, {
        projectId: m.projectId,
        tag: m.tag,
        source: m.source,
        fileName: m.fileName,
        ...(m.roomId ? { roomId: m.roomId } : {}),
        ...(m.caption ? { caption: m.caption } : {}),
        ...(m.customerVisible !== undefined ? { customerVisible: m.customerVisible } : {}),
      });
      return item.id;
    },
    now: () => Date.now(),
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  });
  singleton = outbox;
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      outbox.emit();
      void outbox.flush(true);
    });
    window.addEventListener("offline", () => outbox.emit());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void outbox.flush(true);
    });
    window.setInterval(() => {
      if (outbox.state().items.some((i) => i.state === "queued")) void outbox.flush();
    }, 15_000);
    // The app opening again (a reload, back in signal after a dead spot) is a fresh start: send what's
    // waiting now, past any backoff, instead of on the next tick or up to five minutes later.
    void outbox.ready().then(() => {
      if (navigator.onLine !== false && outbox.state().items.some((i) => i.state === "queued")) void outbox.flush(true);
    });
  }
  return outbox;
}

/**
 * The field layout mounting: make sure the outbox exists on every field
 * screen (even one with nothing to capture) and send what's queued now,
 * backoff reset.
 */
export function kickFieldOutbox(): void {
  if (typeof window === "undefined") return;
  const fresh = !singleton;
  const outbox = getFieldOutbox();
  if (fresh) return; // creating it already flushes once it has loaded
  void outbox.ready().then(() => {
    if (navigator.onLine !== false) void outbox.flush(true);
  });
}
