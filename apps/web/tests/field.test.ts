import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  generateQuote,
  INSTALL_TEMPLATE_VERSION,
  runsheetFromDesign,
  type CatalogueItem,
  type DesignRecord,
  type MediaItem,
  type Project,
  type StaffMember,
} from "@aircon/domain";
import {
  FieldOutbox,
  LOCAL_MEDIA_PREFIX,
  SendError,
  afterMediaUploaded,
  applyResults,
  badgeState,
  discardSet,
  failBatch,
  memoryStore,
  nextBatch,
  pendingEvidence,
  placeholdersIn,
  retryDelayMs,
  type QueueItem,
  type SyncOp,
  type SyncResult,
} from "../lib/field-outbox.ts";
import { registerAppResolver } from "./helpers/resolve-app.ts";
import { insertProjectRow } from "./helpers/rows.ts";

process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();

const PROJECT = "6a6a6a6a-1111-4111-8111-00000000f601";
const OTHER = "6b6b6b6b-2222-4222-8222-00000000f602";
const MEDIA = "6c6c6c6c-3333-4333-8333-00000000f603";
const AT0 = "2026-11-10T09:00:00.000Z";
const INSTALLER_ID = "aa000000-0000-4000-8000-0000000000f1";

/* ------------------------------------------------------------------ */
/* The outbox queue (pure parts)                                       */
/* ------------------------------------------------------------------ */

const ev = (id: string, over: Partial<Extract<SyncOp, { type: "evidence" }>> = {}): SyncOp => ({
  type: "evidence",
  id,
  projectId: PROJECT,
  specId: "d1-protection.floors",
  at: "2026-11-10T09:00:00.000Z",
  ...over,
});

const item = (op: SyncOp, createdAt: number, over: Partial<QueueItem> = {}): QueueItem => ({
  id: op.id,
  kind: "op",
  op,
  label: "DEMO",
  projectId: op.projectId,
  createdAt,
  attempts: 0,
  nextAttemptAt: 0,
  state: "queued",
  ...over,
});

const mediaItem = (id: string, createdAt: number): QueueItem => ({
  id,
  kind: "media",
  media: { projectId: PROJECT, blob: new Blob(["x"]), fileName: "x.jpg", tag: "progress", source: "install" },
  label: "Photo",
  projectId: PROJECT,
  createdAt,
  attempts: 0,
  nextAttemptAt: 0,
  state: "queued",
});

test("outbox: batches go oldest first, skip ops waiting for photos, respect backoff", () => {
  const items = [
    item(ev("c", { specId: "d1-c.reading" }), 3),
    item(ev("a", { specId: "d1-a.reading" }), 1),
    item(ev("b", { mediaId: `${LOCAL_MEDIA_PREFIX}m1` }), 2),
    item(ev("d", { specId: "d1-d.reading" }), 4, { nextAttemptAt: 10_000 }),
    item(ev("e", { specId: "d1-e.reading" }), 5, { state: "failed" }),
    // A later capture of the slot whose photo is still uploading waits for it: the latest capture is the one that counts.
    item(ev("b2"), 6),
    mediaItem("m1", 0),
  ];
  assert.deepEqual(nextBatch(items, 5_000).map((i) => i.id), ["a", "c"]);
  assert.deepEqual(nextBatch(items, 5_000, { force: true }).map((i) => i.id), ["a", "c", "d"], "force ignores backoff, never failed ones");
  assert.deepEqual(nextBatch(items, 5_000, { max: 1 }).map((i) => i.id), ["a"]);
  assert.deepEqual(placeholdersIn(items[2]!.op!), ["m1"]);
  const resolved = afterMediaUploaded(items, "m1", MEDIA);
  assert.equal(resolved.length, 1);
  assert.equal((resolved[0]!.op as Extract<SyncOp, { type: "evidence" }>).mediaId, MEDIA);
  // Issues with several photos resolve one at a time.
  const issue: SyncOp = { type: "issue", id: "i", projectId: PROJECT, kind: "defect", title: "DEMO", severity: "low", blocking: false, mediaIds: [`${LOCAL_MEDIA_PREFIX}m1`, `${LOCAL_MEDIA_PREFIX}m2`], at: "2026-11-10T09:00:00.000Z" };
  const [once] = afterMediaUploaded([item(issue, 1)], "m1", MEDIA);
  assert.deepEqual(placeholdersIn(once!.op!), ["m2"]);
});

test("outbox: results decide the fate of each op; nothing is dropped without an answer", () => {
  const batch = [item(ev("a"), 1), item(ev("b"), 2), item(ev("c"), 3), item(ev("d"), 4)];
  const results: SyncResult[] = [
    { id: "a", ok: true },
    { id: "b", ok: true, duplicate: true },
    { id: "c", ok: false, error: "Needs an F-gas engineer", permanent: true },
  ];
  const out = applyResults(batch, results, 1_000);
  assert.deepEqual(out.done.map((i) => i.id), ["a", "b"], "a duplicate is a success");
  assert.equal(out.failed[0]!.id, "c");
  assert.equal(out.failed[0]!.state, "failed");
  assert.equal(out.failed[0]!.lastError, "Needs an F-gas engineer");
  assert.equal(out.retry[0]!.id, "d", "no answer: retry");
  assert.equal(out.retry[0]!.nextAttemptAt, 1_000 + retryDelayMs(1));
  const offline = failBatch(batch, "No connection", 0);
  assert.ok(offline.every((i) => i.state === "queued" && i.attempts === 1));
  assert.ok(failBatch(batch, "Forbidden", 0, { permanent: true }).every((i) => i.state === "failed"));
  assert.equal(retryDelayMs(1), 2_000);
  assert.equal(retryDelayMs(30), 300_000, "capped");
});

test("outbox: discarding a photo discards what waits for it; badge text is honest", () => {
  const items = [mediaItem("m1", 0), item(ev("a", { mediaId: `${LOCAL_MEDIA_PREFIX}m1` }), 1), item(ev("b"), 2)];
  assert.deepEqual(discardSet(items, "m1").sort(), ["a", "m1"]);
  assert.deepEqual(discardSet(items, "b"), ["b"]);
  assert.equal(badgeState({ online: true, items: [] }).text, "All synced");
  assert.equal(badgeState({ online: true, items: [], storageOk: false }).text, "Synced (not saved offline)");
  assert.equal(badgeState({ online: true, items }).text, "3 waiting to sync");
  assert.equal(badgeState({ online: false, items }).text, "Offline · 3 waiting");
  assert.equal(badgeState({ online: false, items: [] }).text, "Offline");
  assert.equal(badgeState({ online: true, items: [...items, item(ev("x"), 9, { state: "failed" })] }).text, "1 needs attention");
  const pending = pendingEvidence([item(ev("a", { value: 1 }), 1), item(ev("b", { value: 2 }), 2), item(ev("c", { projectId: OTHER }), 3)], PROJECT);
  assert.equal(pending.size, 1, "latest per slot, this job only");
  assert.equal((pending.get("d1-protection.floors")!.op as Extract<SyncOp, { type: "evidence" }>).value, 2);
});

test("outbox: ops that use a photo follow it with the real id; offline keeps everything; acks are remembered", async () => {
  let online = false;
  let now = 1_000;
  const sent: SyncOp[][] = [];
  const outbox = new FieldOutbox({
    store: memoryStore(),
    now: () => now,
    online: () => online,
    upload: async () => MEDIA,
    send: async (ops) => {
      sent.push(ops);
      return ops.map((o) => ({ id: o.id, ok: true as const }));
    },
  });
  await outbox.ready();
  const local = await outbox.enqueueMedia({ projectId: PROJECT, blob: new Blob(["x"]), fileName: "g.jpg", tag: "gauge", source: "install" }, "Gauge photo");
  await outbox.enqueue(ev("p1", { mediaId: local, specId: "d3-pressure-s.gauge" }), "Gauge photo");
  await outbox.enqueue(ev("p2"), "Floors");
  await outbox.flush();
  assert.equal(outbox.state().items.length, 3, "offline: all kept");
  assert.equal(sent.length, 0);
  assert.equal(badgeState({ online, items: outbox.state().items }).text, "Offline · 3 waiting");

  online = true;
  now += 10;
  await outbox.flush(true);
  assert.equal(outbox.state().items.length, 0);
  const first = sent.flat().find((o) => o.id === "p1") as Extract<SyncOp, { type: "evidence" }>;
  assert.equal(first.mediaId, MEDIA, "the placeholder became the real media id");
  assert.deepEqual(outbox.state().acked.map((o) => o.id).sort(), ["p1", "p2"]);
});

test("outbox: a slow upload never holds up the ops that don't use it (a safety issue, a clock stop)", async () => {
  let release!: () => void;
  const uploading = new Promise<void>((r) => (release = r));
  const sent: SyncOp[] = [];
  const outbox = new FieldOutbox({
    store: memoryStore(),
    now: () => 1_000,
    online: () => true,
    upload: async () => {
      await uploading; // one bar of signal: the photo takes its time
      return MEDIA;
    },
    send: async (ops) => {
      sent.push(...ops);
      return ops.map((o) => ({ id: o.id, ok: true as const }));
    },
  });
  await outbox.ready();
  const photo = await outbox.enqueueMedia({ projectId: PROJECT, blob: new Blob(["x"]), fileName: "d.jpg", tag: "progress", source: "install" }, "Damage photo");
  const damage: SyncOp = { type: "issue", id: "7c7c7c7c-1111-4111-8111-00000000f6a1", projectId: PROJECT, kind: "damage", title: "DEMO: scuffed wall", severity: "low", blocking: false, mediaIds: [photo], at: AT0 };
  const safety: SyncOp = { type: "issue", id: "7c7c7c7c-2222-4222-8222-00000000f6a2", projectId: PROJECT, kind: "safety", title: "DEMO: exposed live cable", severity: "critical", blocking: true, mediaIds: [], at: AT0 };
  const stop: SyncOp = { type: "time-stop", id: "tstop-lane-1", projectId: PROJECT, entryId: "7c7c7c7c-3333-4333-8333-00000000f6a3", at: AT0 };
  await outbox.enqueue(damage, "Damage");
  await outbox.enqueue(safety, "Safety");
  await outbox.enqueue(stop, "Clock stopped");
  // Let the ops lane run while the upload is still going.
  for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.map((o) => o.id), [safety.id, stop.id], "sent while the photo is still uploading");
  assert.ok(outbox.state().items.some((i) => i.id === damage.id), "the issue with the photo waits for it");
  release();
  await outbox.flush();
  assert.deepEqual(sent.map((o) => o.id), [safety.id, stop.id, damage.id]);
  assert.deepEqual((sent[2] as Extract<SyncOp, { type: "issue" }>).mediaIds, [MEDIA]);
  assert.equal(outbox.state().items.length, 0);
});

test("outbox: captures are stamped with who made them and only ever send while that person is signed in", async () => {
  const sent: SyncOp[] = [];
  const outbox = new FieldOutbox({
    store: memoryStore(),
    now: () => 1_000,
    online: () => true,
    upload: async () => MEDIA,
    send: async (ops) => {
      sent.push(...ops);
      return ops.map((o) => ({ id: o.id, ok: true as const }));
    },
  });
  await outbox.ready();
  const IVO = { id: INSTALLER_ID, name: "DEMO Ivo (installer)" };
  const ELI = { id: "aa000000-0000-4000-8000-0000000000e1", name: "DEMO Eli (electrician)" };
  outbox.setSignedIn(IVO);
  await outbox.enqueue(ev("ivo-fall", { specId: "d2-condensate.fall", value: 23 }), "Condensate fall");
  await outbox.flush();
  assert.equal(sent.length, 1, "while Ivo is signed in, his capture goes");
  assert.deepEqual(sent[0]!.by, IVO, "stamped with who made it");

  // Ivo's next capture is still on the phone when he signs out and Eli signs in.
  outbox.setSignedIn(null);
  await outbox.enqueue(ev("ivo-torque", { specId: "d2-flare.torque", value: 18, by: IVO }), "Flare torque");
  outbox.setSignedIn(ELI);
  await outbox.flush(true);
  assert.equal(sent.length, 1, "never sent under Eli's session");
  assert.equal(outbox.state().items.length, 1);
  assert.equal(nextBatch(outbox.state().items, 1_000, { signedIn: ELI.id }).length, 0);
  assert.equal(nextBatch(outbox.state().items, 1_000, { signedIn: null }).length, 0, "nobody known yet: nothing stamped goes");
  // Eli's own capture goes, under him.
  await outbox.enqueue(ev("eli-ir", { specId: "d2-electrical.ir" }), "Insulation resistance");
  await outbox.flush();
  assert.deepEqual(sent.map((o) => [o.id, o.by?.id]), [["ivo-fall", IVO.id], ["eli-ir", ELI.id]]);
  // Ivo signs back in: his capture goes, as his.
  outbox.setSignedIn(IVO);
  await outbox.flush(true);
  assert.deepEqual(sent.at(-1), { ...ev("ivo-torque", { specId: "d2-flare.torque", value: 18 }), by: IVO });
  assert.equal(outbox.state().items.length, 0);
});

test("outbox: a capture the phone's storage refuses is never shown as kept; a later good write clears it", async () => {
  let refuse = true;
  const inner = memoryStore();
  const flaky: typeof inner = {
    get durable() {
      return true;
    },
    all: () => inner.all(),
    put: async (i) => {
      if (refuse) throw new DOMException("The database connection is closing.", "InvalidStateError");
      return inner.put(i);
    },
    delete: (id) => inner.delete(id),
  };
  const outbox = new FieldOutbox({ store: flaky, now: () => 1_000, online: () => false, upload: async () => MEDIA, send: async () => [] });
  await outbox.ready();
  assert.equal(outbox.state().durable, true);
  await outbox.enqueue(ev("lost-1", { specId: "d3-vacuum.reading", value: 380 }), "Vacuum");
  assert.equal(outbox.state().items.length, 1, "still queued in this page, so it sends if there's signal");
  assert.equal(outbox.state().durable, false, "but not claimed as kept on the phone");
  assert.equal(badgeState({ online: false, items: outbox.state().items, storageOk: outbox.state().durable }).text, "Keep open · 1 waiting");
  assert.equal((await inner.all()).length, 0);
  // Storage works again: the next write of that item (a retry) puts it on the phone.
  refuse = false;
  await outbox.retry("lost-1");
  assert.equal(outbox.state().durable, true);
  assert.equal((await inner.all()).length, 1);
});

test("outbox: a signed-out batch is kept and retried, a forbidden one parks for a person", async () => {
  let status: number | null = 401;
  const outbox = new FieldOutbox({
    store: memoryStore(),
    now: () => 0,
    online: () => true,
    upload: async () => MEDIA,
    send: async () => {
      throw new SendError("no", status);
    },
  });
  await outbox.ready();
  await outbox.enqueue(ev("s1"), "DEMO");
  await outbox.flush(true);
  const [kept] = outbox.state().items;
  assert.equal(kept!.state, "queued");
  assert.match(kept!.lastError ?? "", /signed out/);
  status = 403;
  await outbox.flush(true);
  assert.equal(outbox.state().items[0]!.state, "failed");
  await outbox.discard("s1");
  assert.equal(outbox.state().items.length, 0);
});

/* ------------------------------------------------------------------ */
/* The sync endpoint's server side, on the in-memory backend           */
/* ------------------------------------------------------------------ */

const { requireDb } = await import("../lib/supabase-server.ts");
const field = await import("../lib/field-server.ts");
const installJobsRepo = await import("../lib/repo/installJobs.ts");
const evidenceRepo = await import("../lib/repo/evidence.ts");
const issuesRepo = await import("../lib/repo/issues.ts");
const mediaRepo = await import("../lib/repo/media.ts");
const timeRepo = await import("../lib/repo/time.ts");
const { DEMO_SURVEY } = await import("../lib/project-service.ts");

const staffMember = (id: string, over: Partial<StaffMember> = {}): StaffMember => ({
  id,
  email: `${id}@demo.dang.invalid`,
  name: `DEMO ${id.slice(0, 4)}`,
  roles: ["installer"],
  external: false,
  active: true,
  qualifications: [],
  ...over,
});
const INSTALLER = staffMember("aa000000-0000-4000-8000-0000000000f1");
const SUB = staffMember("aa000000-0000-4000-8000-0000000000f2", { external: true });
const FGAS = staffMember("aa000000-0000-4000-8000-0000000000f3", {
  qualifications: [{ kind: "fgas-cat1", reference: "DEMO-F", expiresOn: "2030-12-31", verifiedAt: "2026-01-05T09:00:00.000Z", mediaId: "aa000000-0000-4000-8000-0000000000c1" }],
});

const CATALOGUE: CatalogueItem[] = [
  { id: "in", kind: "indoor", label: "DEMO indoor", model: "DEMO-IN", manufacturer: "Daikin", specs: { liquidPipeMm: 6.35, gasPipeMm: 9.52 }, costPence: null, status: "available", confidence: "provisional", sources: [], active: true },
  { id: "out", kind: "outdoor", label: "DEMO outdoor", model: "DEMO-OUT", specs: { prechargedPipeM: 10, additionalChargeGPerM: 20 }, costPence: null, status: "available", confidence: "provisional", sources: [], active: true },
];

const DESIGN: DesignRecord = {
  id: "6d6d6d6d-4444-4444-8444-00000000f604",
  projectId: PROJECT,
  version: 1,
  status: "approved",
  rooms: [{ roomId: "r1", roomName: "Main bedroom", floor: "first", preliminaryLoadW: 2000, suggestedKw: 2.5, chosenKw: 2.5, pipeRunM: 6, heightDiffM: 3, condensate: "gravity", layoutMediaIds: [] }],
  variants: [
    {
      id: "v",
      label: "Standard",
      tier: "standard",
      systems: [{ id: "s", topology: "single", outdoorItemId: "out", roomIds: ["r1"], compatibility: { ok: true, errors: [], warnings: [] }, electrical: { breaker: "16 A", cableMm2: 2.5, isolator: "Isolator" }, refrigerant: { totalPipeM: 6, prechargedPipeM: 10, additionalChargeG: 0 } }],
      roomUnits: [{ roomId: "r1", indoorItemId: "in" }],
      bom: [],
      rules: [],
      verdict: "auto-approved",
      installDays: 3,
    },
  ],
  overrides: [],
  createdAt: "2026-11-01T09:00:00.000Z",
};

async function seed(install: Project["install"]["status"], startedAt?: string): Promise<Project> {
  const db = requireDb();
  // Deleting the projects takes their jobs, evidence, issues, time, media and messages with them (on delete cascade).
  const cleared = await db.from("projects").delete().not("id", "is", null);
  assert.equal(cleared.error, null);
  const base = createProject({
    id: PROJECT,
    quoteId: "6e6e6e6e-5555-4555-8555-00000000f605",
    createdAt: "2026-11-01T09:00:00.000Z",
    customerName: "DEMO Customer",
    survey: DEMO_SURVEY,
    quote: generateQuote(DEMO_SURVEY),
  });
  const project: Project = {
    ...base,
    booking: { ...base.booking, status: "booked", dates: ["2026-11-10", "2026-11-11", "2026-11-12"], startDate: "2026-11-10", crew: [{ staffId: INSTALLER.id, name: INSTALLER.name, role: "installer", external: false }, { staffId: FGAS.id, name: FGAS.name, role: "installer", external: false }] },
    install: {
      ...base.install,
      status: install,
      ...(startedAt ? { startedAt } : {}),
      days: install === "not-started" ? [] : [{ n: 1, date: "2026-11-10", status: "in-progress", startedAt: startedAt ?? "2026-11-10T08:00:00.000Z" }],
    },
  };
  await insertProjectRow(db, { id: PROJECT, quote_id: project.quoteId, schema_version: 2, project, install_on: "2026-11-10" });
  await installJobsRepo.save({
    id: "6f6f6f6f-6666-4666-8666-00000000f606",
    projectId: PROJECT,
    designId: DESIGN.id,
    templateVersion: INSTALL_TEMPLATE_VERSION,
    runsheet: runsheetFromDesign(DESIGN, "v", CATALOGUE),
    stepStatuses: [],
    exceptionReviews: [],
    qa: { status: "in-progress" },
  });
  const media: MediaItem = { id: MEDIA, projectId: PROJECT, bucket: "project-media", storagePath: `${PROJECT}/${MEDIA}-x.jpg`, contentType: "image/jpeg", tag: "progress", source: "install", takenAt: "2026-11-10T09:00:00.000Z", customerVisible: false, annotations: [], annotationsVersion: 0, locked: false };
  await mediaRepo.insert(media);
  return project;
}

const AT = new Date(Date.now() - 60_000).toISOString();

test("sync: evidence is idempotent on the phone's id; a retry is a duplicate, never a second row", async () => {
  await seed("in-progress");
  const op: SyncOp = { type: "evidence", id: "ev-phone-0001", projectId: PROJECT, specId: "d1-protection.floors", mediaId: MEDIA, at: AT };
  const [first] = await field.processSyncBatch(INSTALLER, [op]);
  assert.deepEqual(first, { id: op.id, ok: true });
  const [again] = await field.processSyncBatch(INSTALLER, [op]);
  assert.deepEqual(again, { id: op.id, ok: true, duplicate: true });
  const rows = await evidenceRepo.listForProject(PROJECT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.byStaffId, INSTALLER.id, "who recorded it comes from the session, not the phone");
  // Future capture times are pulled back to now.
  const future: SyncOp = { type: "evidence", id: "ev-phone-0002", projectId: PROJECT, specId: "d1-arrival.met", at: "2099-01-01T00:00:00.000Z" };
  await field.processSyncBatch(INSTALLER, [future]);
  const stamped = (await evidenceRepo.listForProject(PROJECT)).find((e) => e.id === future.id)!;
  assert.ok(Date.parse(stamped.at) <= Date.now());
});

test("sync: gates hold on the server: qualifications, day not started, other people's jobs", async () => {
  await seed("in-progress");
  const pressure: SyncOp = { type: "evidence", id: "ev-phone-0003", projectId: PROJECT, specId: "d3-pressure-s-s.applied", value: 30, at: AT };
  const [locked] = await field.processSyncBatch(INSTALLER, [pressure]);
  assert.equal(locked!.ok, false);
  assert.equal(!locked!.ok && locked!.permanent, true);
  assert.match(!locked!.ok ? locked!.error : "", /F-gas engineer/);
  const [ok] = await field.processSyncBatch(FGAS, [pressure]);
  assert.equal(ok!.ok, true);
  const [stranger] = await field.processSyncBatch(SUB, [{ ...pressure, id: "ev-phone-0004" }]);
  assert.match(!stranger!.ok ? stranger!.error : "", /isn't one of yours/);
  const [unknown] = await field.processSyncBatch(INSTALLER, [{ type: "evidence", id: "ev-phone-0005", projectId: PROJECT, specId: "nope.nope", at: AT }]);
  assert.match(!unknown!.ok ? unknown!.error : "", /isn't on this job/);
  await seed("not-started");
  const [early] = await field.processSyncBatch(INSTALLER, [{ type: "evidence", id: "ev-phone-0006", projectId: PROJECT, specId: "d1-arrival.met", at: AT }]);
  assert.match(!early!.ok ? early!.error : "", /Day 1 hasn't started/);
});

test("sync: a lapsed F-gas certificate can't be got round by backdating the phone's capture time", async () => {
  await seed("in-progress");
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  // Same person as FGAS (on the crew), but the certificate ran out two days ago.
  const LAPSED: StaffMember = { ...FGAS, qualifications: [{ ...FGAS.qualifications[0]!, expiresOn: daysAgo(2).slice(0, 10) }] };
  const pressure: SyncOp = { type: "evidence", id: "ev-phone-lapsed-1", projectId: PROJECT, specId: "d3-pressure-s-s.applied", value: 30, at: AT };
  const [now] = await field.processSyncBatch(LAPSED, [pressure]);
  assert.equal(now!.ok, false);
  assert.match(!now!.ok ? now!.error : "", /F-gas engineer/);
  // The identical reading dated before the expiry: still refused, and it says why.
  const [backdated] = await field.processSyncBatch(LAPSED, [{ ...pressure, id: "ev-phone-lapsed-2", at: daysAgo(5) }]);
  assert.equal(backdated!.ok, false);
  assert.equal(!backdated!.ok && backdated!.permanent, true);
  assert.match(!backdated!.ok ? backdated!.error : "", /F-gas engineer: your certificate on file isn't current today/);
  // A pass outcome on the same gated step, backdated: refused too.
  const [outcome] = await field.processSyncBatch(LAPSED, [{ type: "step-status", id: "st-phone-lapsed-1", projectId: PROJECT, stepId: "d3-pressure-s-s", outcome: "pass", at: daysAgo(5) }]);
  assert.equal(outcome!.ok, false);
  assert.match(!outcome!.ok ? outcome!.error : "", /F-gas engineer/);
  assert.equal((await evidenceRepo.listForProject(PROJECT)).length, 0, "nothing was stored under the lapsed certificate");
  assert.equal((await installJobsRepo.getForProject(PROJECT))!.stepStatuses.length, 0);
  // Blocked is still open to them: saying "I can't" isn't doing the work.
  const [blocked] = await field.processSyncBatch(LAPSED, [{ type: "step-status", id: "st-phone-lapsed-2", projectId: PROJECT, stepId: "d3-pressure-s-s", outcome: "blocked", reason: "My F-gas card has run out", at: AT }]);
  assert.equal(blocked!.ok, true);
});

test("sync: a capture can't be dated before the install started (the RAMS, read before setting off, can)", async () => {
  const startedAt = new Date(Date.now() - 3_600_000).toISOString();
  await seed("in-progress", startedAt);
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [r] = await field.processSyncBatch(INSTALLER, [{ type: "evidence", id: "ev-phone-floor-1", projectId: PROJECT, specId: "d1-protection.floors", mediaId: MEDIA, at: week }]);
  assert.equal(r!.ok, true);
  const stored = (await evidenceRepo.listForProject(PROJECT)).find((e) => e.id === "ev-phone-floor-1")!;
  assert.ok(Date.parse(stored.at) >= Date.parse(startedAt), "dated no earlier than day 1's start");
  const [s] = await field.processSyncBatch(INSTALLER, [{ type: "step-status", id: "st-phone-floor-1", projectId: PROJECT, stepId: "d1-protection", outcome: "pass", at: week }]);
  assert.equal(s!.ok, true);
  const status = (await installJobsRepo.getForProject(PROJECT))!.stepStatuses.find((x) => x.id === "st-phone-floor-1")!;
  assert.ok(Date.parse(status.at) >= Date.parse(startedAt));
});

test("sync: outcomes dedupe by id; Blocked raises one blocking issue however often it's retried", async () => {
  await seed("in-progress");
  const issueId = "7a7a7a7a-7777-4777-8777-00000000f607";
  const blocked: SyncOp = { type: "step-status", id: "st-phone-0001", projectId: PROJECT, stepId: "d1-protection", outcome: "blocked", reason: "No dust sheets on the van", issueId, at: AT };
  const [a] = await field.processSyncBatch(INSTALLER, [blocked]);
  const [b] = await field.processSyncBatch(INSTALLER, [blocked]);
  assert.equal(a!.ok, true);
  assert.deepEqual(b, { id: blocked.id, ok: true, duplicate: true });
  const job = await installJobsRepo.getForProject(PROJECT);
  assert.equal(job!.stepStatuses.length, 1);
  assert.equal(job!.stepStatuses[0]!.issueId, issueId);
  const issues = await issuesRepo.listForProject(PROJECT);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.blocking, true);
  assert.equal(issues[0]!.gate, "install-complete");
  // N/A without a reason is refused for good.
  const [na] = await field.processSyncBatch(INSTALLER, [{ type: "step-status", id: "st-phone-0002", projectId: PROJECT, stepId: "d1-protection", outcome: "na", at: AT }]);
  assert.equal(na!.ok, false);
});

test("sync: time entries and issues are idempotent too; a stop before its start waits", async () => {
  await seed("in-progress");
  const entryId = "7b7b7b7b-8888-4888-8888-00000000f608";
  const stopEarly: SyncOp = { type: "time-stop", id: "tstop-0001", projectId: PROJECT, entryId, at: AT };
  const [wait] = await field.processSyncBatch(INSTALLER, [stopEarly]);
  assert.equal(wait!.ok, false);
  assert.equal(!wait!.ok && wait!.permanent, false, "retry later, don't drop");
  const start: SyncOp = { type: "time-start", id: entryId, projectId: PROJECT, kind: "install", dayN: 1, at: new Date(Date.now() - 3_600_000).toISOString() };
  const results = await field.processSyncBatch(INSTALLER, [start, start, stopEarly, stopEarly]);
  assert.deepEqual(results.map((r) => r.ok && ("duplicate" in r ? Boolean(r.duplicate) : false)), [false, true, false, true]);
  const entry = await timeRepo.get(entryId);
  assert.ok(entry?.endedAt);
  assert.ok((entry?.minutes ?? 0) >= 58);
  const issue: SyncOp = { type: "issue", id: "7c7c7c7c-9999-4999-8999-00000000f609", projectId: PROJECT, kind: "shortage", title: "Short one trunking length", severity: "high", blocking: true, mediaIds: [MEDIA], at: AT };
  await field.processSyncBatch(INSTALLER, [issue]);
  const [dupe] = await field.processSyncBatch(INSTALLER, [issue]);
  assert.deepEqual(dupe, { id: issue.id, ok: true, duplicate: true });
  assert.equal((await issuesRepo.listForProject(PROJECT)).length, 1);
  // A photo from another job can't be attached.
  const [bad] = await field.processSyncBatch(INSTALLER, [{ ...issue, id: "7d7d7d7d-aaaa-4aaa-8aaa-00000000f60a", mediaIds: ["7e7e7e7e-bbbb-4bbb-8bbb-00000000f60b"] }]);
  assert.equal(bad!.ok, false);
});

test("joining a day someone else started: no clock today until they arrive, and the arrival keeps where it was", async () => {
  await seed("in-progress");
  const before = await field.loadFieldJob(PROJECT, FGAS);
  assert.equal(before.clockedToday, false, "they haven't clocked on here today: Arrived, not Resume");
  assert.equal(before.clock, null);
  const id = "7a7a7a7a-dddd-4ddd-8ddd-00000000f60d";
  const [r] = await field.processSyncBatch(FGAS, [{ type: "time-start", id, projectId: PROJECT, kind: "install", dayN: 1, note: "Arrived", gps: { lat: 51.45, lng: -0.14 }, at: AT }]);
  assert.equal(r!.ok, true);
  const entry = await timeRepo.get(id);
  assert.equal(entry?.note, "Arrived");
  assert.deepEqual(entry?.gps, { lat: 51.45, lng: -0.14 });
  const after = await field.loadFieldJob(PROJECT, FGAS);
  assert.equal(after.clockedToday, true);
  assert.equal(after.clock?.entryId, id);
  // Paused: still clocked on today, so the next tap is Resume.
  await field.processSyncBatch(FGAS, [{ type: "time-stop", id: "tstop-join-1", projectId: PROJECT, entryId: id, at: new Date().toISOString() }]);
  const paused = await field.loadFieldJob(PROJECT, FGAS);
  assert.equal(paused.clock, null);
  assert.equal(paused.clockedToday, true);
});

test("variations from site wait for the office, then go to the customer at the checked price", async () => {
  const seeded = await seed("in-progress");
  // A customer to email.
  await requireDb().from("projects").update({ project: { ...seeded, customer: { ...seeded.customer, email: "demo.customer@example.com" } } }).eq("id", PROJECT);
  const v: SyncOp = { type: "issue", id: "7f7f7f7f-cccc-4ccc-8ccc-00000000f60c", projectId: PROJECT, kind: "variation", title: "Condensate pump in the bedroom", severity: "medium", blocking: false, mediaIds: [], variation: { description: "No fall to the outside: a pump is needed.", priceDeltaNetPence: 18_000 }, at: AT };
  const [r] = await field.processSyncBatch(INSTALLER, [v]);
  assert.equal(r!.ok, true);
  const [issue] = await issuesRepo.listForProject(PROJECT);
  assert.equal(issue!.variation?.status, "draft");
  assert.equal(issue!.customerVisible, false, "an estimate from site never reaches the customer unchecked");
  assert.equal(issue!.status, "open");
  assert.equal(issue!.variation?.totalDeltaPence, 18_000, "not VAT registered by default: no tax");
  const messages = async () => (await requireDb().from("messages").select("*")).data as { event: string }[];
  assert.ok(!(await messages()).some((m) => m.event === "variation-approval"), "no email to the customer yet");
  assert.ok((await messages()).some((m) => m.event === "team-alert"), "the office hears about it");

  const { sendVariation } = await import("../lib/variation-server.ts");
  const refusedSub = await sendVariation(PROJECT, issue!.id, { description: "Pump", priceDeltaNetPence: 1 }, SUB);
  assert.equal(refusedSub.ok, false, "subcontractors can't send prices");
  const office = staffMember("aa000000-0000-4000-8000-0000000000f9", { roles: ["admin"] });
  const sent = await sendVariation(PROJECT, issue!.id, { description: "No fall to the outside, so a condensate pump is needed.", priceDeltaNetPence: 15_000 }, office);
  assert.equal(sent.ok, true);
  const after = (await issuesRepo.get(issue!.id))!;
  assert.equal(after.variation?.status, "proposed");
  assert.equal(after.variation?.priceDeltaNetPence, 15_000, "the office's price, not the estimate");
  assert.equal(after.customerVisible, true);
  assert.equal(after.status, "awaiting-customer");
  assert.ok((await messages()).some((m) => m.event === "variation-approval"), "now the customer is asked");
  const again = await sendVariation(PROJECT, issue!.id, { description: "Again", priceDeltaNetPence: 1 }, office);
  assert.equal(again.ok, false, "sent once");
});

test("end of day: an issue's photo is never offered for the customer's update, nor accepted", async () => {
  await seed("in-progress");
  const issuePhoto = "7f7f7f7f-dddd-4ddd-8ddd-00000000f60d";
  await mediaRepo.insert({ id: issuePhoto, projectId: PROJECT, bucket: "project-media", storagePath: `${PROJECT}/${issuePhoto}-x.jpg`, contentType: "image/jpeg", tag: "obstruction", source: "install", caption: "DEMO: cracked tile by the core hole", takenAt: "2026-11-10T10:00:00.000Z", customerVisible: false, annotations: [], annotationsVersion: 0, locked: false });
  const raise: SyncOp = { type: "issue", id: "7f7f7f7f-eeee-4eee-8eee-00000000f60e", projectId: PROJECT, kind: "damage", title: "DEMO: cracked tile by the core hole", severity: "high", blocking: false, mediaIds: [issuePhoto], at: AT };
  assert.equal((await field.processSyncBatch(INSTALLER, [raise]))[0]!.ok, true);
  const offered = (await field.dayPhotos(PROJECT, INSTALLER, 1)).map((p) => p.id);
  assert.deepEqual(offered, [MEDIA], "the day's work photo, not the issue's");
  await assert.rejects(
    field.endDay(PROJECT, INSTALLER, { n: 1, summary: "", customerText: "Holes drilled.", mediaIds: [issuePhoto], learnings: [] }),
    /on an issue/,
  );
  assert.equal((await mediaRepo.get(issuePhoto))!.customerVisible, false, "and it stays private");
});

test("Today keeps the job after commissioning while the crew still has the handover and the day to end", () => {
  const base = createProject({
    id: PROJECT,
    quoteId: "6e6e6e6e-5555-4555-8555-00000000f605",
    createdAt: "2026-11-01T09:00:00.000Z",
    customerName: "DEMO Customer",
    survey: DEMO_SURVEY,
    quote: generateQuote(DEMO_SURVEY),
  });
  const TODAY = "2026-11-12";
  const commissioned = (mut: (p: Project) => void = () => {}): Project => {
    const p: Project = {
      ...base,
      booking: { ...base.booking, status: "booked", dates: ["2026-11-10", "2026-11-11", TODAY], startDate: "2026-11-10" },
      install: {
        status: "complete",
        completedAt: `${TODAY}T15:00:00.000Z`,
        days: [
          { n: 1, date: "2026-11-10", status: "done", startedAt: "2026-11-10T08:00:00.000Z", endedAt: "2026-11-10T17:00:00.000Z", summary: "Day 1" },
          { n: 2, date: "2026-11-11", status: "done", startedAt: "2026-11-11T08:00:00.000Z", endedAt: "2026-11-11T17:00:00.000Z", summary: "Day 2" },
          // Closed by commissioning, no summary yet: the wrap-up day.
          { n: 3, date: TODAY, status: "done", startedAt: `${TODAY}T08:00:00.000Z`, endedAt: `${TODAY}T15:00:00.000Z` },
        ],
      },
      handover: { ...base.handover, status: "commissioned", commissionedAt: `${TODAY}T15:00:00.000Z` },
    };
    mut(p);
    return p;
  };
  assert.deepEqual(field.wrapUpToday(commissioned(), TODAY), { handover: true, endDay: true });
  assert.equal(field.installDateFor(commissioned(), TODAY), TODAY, "still on Today");
  const handedOver = commissioned((p) => (p.handover = { ...p.handover, status: "handed-over", handedOverAt: `${TODAY}T16:00:00.000Z` }));
  assert.deepEqual(field.wrapUpToday(handedOver, TODAY), { handover: false, endDay: true });
  const allDone = commissioned((p) => {
    p.handover = { ...p.handover, status: "handed-over", handedOverAt: `${TODAY}T16:00:00.000Z` };
    p.install.days[2]!.summary = "All done";
  });
  assert.equal(field.wrapUpToday(allDone, TODAY), null);
  assert.equal(field.installDateFor(allDone, TODAY), null, "everything's finished: off Today, into Recent");
  assert.equal(field.installDateFor(commissioned(), "2026-11-13"), null, "the next day it's in Recent");
});

test("a surveyor on an install crew that day can't be given a survey on it", async () => {
  await seed("not-started");
  const { surveyorClash } = await import("../lib/booking-server.ts");
  const clash = await surveyorClash(OTHER, { staffId: INSTALLER.id, name: INSTALLER.name }, "2026-11-11T10:00:00.000Z");
  assert.match(clash ?? "", new RegExp(`${INSTALLER.name} is on the install for DEMO Customer on Wed 11 Nov`));
  assert.equal(await surveyorClash(OTHER, { staffId: INSTALLER.id, name: INSTALLER.name }, "2026-11-13T10:00:00.000Z"), null, "free the day after");
  assert.equal(await surveyorClash(OTHER, { staffId: SUB.id, name: SUB.name }, "2026-11-11T10:00:00.000Z"), null, "not on that crew");
  assert.equal(await surveyorClash(PROJECT, { staffId: INSTALLER.id, name: INSTALLER.name }, "2026-11-11T10:00:00.000Z"), null, "its own install doesn't count");
  assert.equal(await surveyorClash(OTHER, { staffId: INSTALLER.id, name: INSTALLER.name }, undefined), null, "no survey date yet");
});

test("sync: a capture made by someone else on this phone is never saved under the signed-in person", async () => {
  await seed("in-progress");
  const byFgas: SyncOp = { type: "evidence", id: "ev-other-0001", projectId: PROJECT, specId: "d1-protection.floors", mediaId: MEDIA, at: AT, by: { id: FGAS.id, name: FGAS.name } };
  const [held] = await field.processSyncBatch(INSTALLER, [byFgas]);
  assert.equal(held!.ok, false);
  assert.equal(!held!.ok && held!.permanent, false, "kept on the phone for its author, not dropped");
  assert.match(!held!.ok ? held!.error : "", new RegExp(`Captured by ${FGAS.name}`));
  assert.equal((await evidenceRepo.listForProject(PROJECT)).length, 0, "nothing recorded under the installer");
  // Its own author sends it: recorded as theirs.
  const [mine] = await field.processSyncBatch(FGAS, [byFgas]);
  assert.equal(mine!.ok, true);
  const rows = await evidenceRepo.listForProject(PROJECT);
  assert.deepEqual(rows.map((r) => [r.id, r.byStaffId]), [[byFgas.id, FGAS.id]]);
  // An unstamped op (queued before this update) still goes as it always did.
  const [legacy] = await field.processSyncBatch(INSTALLER, [{ type: "time-start", id: "7a7a7a7a-eeee-4eee-8eee-00000000f6b1", projectId: PROJECT, kind: "install", dayN: 1, at: AT }]);
  assert.equal(legacy!.ok, true);
});

test("ending a day a colleague already ended still stops this person's clock, and sends nothing twice", async () => {
  await seed("in-progress", "2026-11-10T08:00:00.000Z");
  const mine = "7a7a7a7a-ffff-4fff-8fff-00000000f6c1";
  const theirs = "7a7a7a7a-ffff-4fff-8fff-00000000f6c2";
  const startedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
  await field.processSyncBatch(INSTALLER, [{ type: "time-start", id: mine, projectId: PROJECT, kind: "install", dayN: 1, at: startedAt }]);
  await field.processSyncBatch(FGAS, [{ type: "time-start", id: theirs, projectId: PROJECT, kind: "install", dayN: 1, at: startedAt }]);
  // The F-gas engineer's phone ends day 1 first.
  const first = await field.endDay(PROJECT, FGAS, { n: 1, summary: "DEMO: pipes in.", customerText: "", mediaIds: [], learnings: [], clockEntryId: theirs });
  assert.equal(first.alreadyEnded, false);
  assert.equal(first.clockStopped, true);
  // The installer's phone, loaded before that, still offers End day 1, with a photo picked.
  const second = await field.endDay(PROJECT, INSTALLER, { n: 1, summary: "DEMO: tidy.", customerText: "DEMO: all done today.", mediaIds: [MEDIA], learnings: [], clockEntryId: mine });
  assert.equal(second.alreadyEnded, true, "told it was already ended, not 'Day 1 hasn't started'");
  assert.equal(second.clockStopped, true);
  const entry = await timeRepo.get(mine);
  assert.ok(entry?.endedAt, "the installer's clock stopped: no overnight entry");
  assert.ok((entry?.minutes ?? 0) >= 119 && (entry?.minutes ?? 0) <= 121);
  assert.equal((await mediaRepo.get(MEDIA))!.customerVisible, false, "nothing shared by the second phone");
  const msgs = ((await requireDb().from("messages").select("event")).data ?? []) as { event: string }[];
  assert.equal(msgs.filter((m) => m.event === "install-day-update").length, 0, "no second customer update");
  // Someone else's clock is never stopped from this phone.
  const third = await field.endDay(PROJECT, INSTALLER, { n: 1, summary: "", customerText: "", mediaIds: [], learnings: [], clockEntryId: theirs });
  assert.equal(third.clockStopped, false);
});

test("commissioning: a capture the signer's screen didn't show is named, so the signature is never over it", () => {
  const job = {
    runsheet: [
      { id: "s1", item: "System 1", evidence: [{ id: "c-added", kind: "number", label: "Refrigerant added" }] },
      { id: "s2", evidence: [{ id: "c-vac", kind: "number", label: "Vacuum" }] },
    ],
    evidence: [
      { id: "e1", specId: "c-added", value: 0, at: AT, by: "DEMO" },
      { id: "e2", specId: "c-vac", value: 300, at: AT, by: "DEMO" },
      // Re-weighed on another phone after the signer's screen loaded.
      { id: "e3", specId: "c-added", value: 250, at: AT, by: "DEMO" },
    ],
  } as unknown as Parameters<typeof field.unseenEvidence>[0];
  assert.deepEqual(field.unseenEvidence(job, ["e1", "e2"]), [{ specId: "c-added", label: "Refrigerant added, System 1" }]);
  assert.deepEqual(field.unseenEvidence(job, ["e1", "e2", "e3"]), [], "seen everything: fine");
  assert.deepEqual(field.unseenEvidence(job, ["e3", "e2"]), [], "an older capture superseded on screen doesn't matter");
});

test("a clock stopped on the night the clocks go back (25 October 2026) counts the real hours", () => {
  // 23:30 BST on Saturday 24 October to 08:30 GMT on Sunday 25 October: 9 hours on the clock face, 10 worked
  // (01:00 to 02:00 happens twice). Computed on instants, never wall-clock times.
  assert.equal(field.clockMinutes("2026-10-24T22:30:00.000Z", "2026-10-25T08:30:00.000Z"), 600);
  // 08:00 BST Saturday to 17:00 GMT Sunday: 34 hours elapsed, not the 33 the dates suggest.
  assert.equal(field.clockMinutes("2026-10-24T07:00:00.000Z", "2026-10-25T17:00:00.000Z"), 34 * 60);
  // A stop before its start (a phone's clock wrong) is never negative.
  assert.equal(field.clockMinutes("2026-10-25T09:00:00.000Z", "2026-10-25T08:00:00.000Z"), 0);
});

/* ------------------------------------------------------------------ */
/* Steps that answer with the result: safe to send twice              */
/* ------------------------------------------------------------------ */

/** The seeded job at handover: install complete, commissioning signed, the walkthrough marked done (N/A). */
async function seedHandover(): Promise<void> {
  await seed("complete");
  const db = requireDb();
  const row = await db.from("projects").select("project").eq("id", PROJECT).single();
  const p = (row.data as { project: Project }).project;
  p.handover = { ...p.handover, status: "commissioned", commissionedAt: AT, commissionedBy: FGAS.name };
  assert.equal((await db.from("projects").update({ project: p }).eq("id", PROJECT)).error, null);
  const job = (await installJobsRepo.getForProject(PROJECT))!;
  const { handoverSteps } = await import("@aircon/domain");
  const walk = handoverSteps(job.runsheet);
  assert.ok(walk.length > 0, "the runsheet has a walkthrough");
  await installJobsRepo.save({
    ...job,
    stepStatuses: walk.map((s, i) => ({ id: `st-walk-${i}`, stepId: s.id, outcome: "na" as const, reason: "DEMO: shown at handover", at: AT, by: INSTALLER.name, byStaffId: INSTALLER.id })),
  });
}

const handoverMessages = async () => (((await requireDb().from("messages").select("event")).data ?? []) as { event: string }[]).filter((m) => m.event === "handover-ready").length;

test("handover: the same tap published twice is one pack and one email; the answer carries the header the screen needs", async () => {
  await seedHandover();
  const tap = "7c7c7c7c-1111-4111-8111-00000000f6e1";
  const first = await field.publishHandoverPack(PROJECT, INSTALLER, { requestId: tap });
  assert.equal(first.document.id, tap, "the tap's id is the pack's id");
  assert.equal(first.replayed, false);
  const header = field.headerStateOf(first.project);
  assert.equal(header.packDocumentId, tap, "the sign-off can open from the answer alone");
  assert.equal(header.handoverStatus, "commissioned");
  // The reply was lost (or the tap bounced): the phone sends the same id again.
  const again = await field.publishHandoverPack(PROJECT, INSTALLER, { requestId: tap });
  assert.equal(again.replayed, true);
  assert.equal(again.document.id, tap);
  assert.equal(field.headerStateOf(again.project).version, header.version, "nothing new happened");
  const { listDocuments } = await import("../lib/documents-server.ts");
  const packs = (await listDocuments(PROJECT, { includeSuperseded: true })).filter((d) => d.kind === "handover-pack");
  assert.equal(packs.length, 1, "one version");
  assert.equal(again.project.events.filter((e) => e.type === "handover-pack-published").length, 1, "recorded once (so emailed once)");
  assert.ok((await handoverMessages()) <= 1, "never a second email");
  // A new tap is a new version (Publish an updated pack), and a newer header.
  const update = await field.publishHandoverPack(PROJECT, INSTALLER, { requestId: "7c7c7c7c-1111-4111-8111-00000000f6e2" });
  assert.equal(update.replayed, false);
  assert.ok(field.headerStateOf(update.project).version > header.version);
  assert.equal((await listDocuments(PROJECT, { includeSuperseded: true })).filter((d) => d.kind === "handover-pack").length, 2);
  // Someone else's document id is never taken as a replay.
  await assert.rejects(field.publishHandoverPack(OTHER, INSTALLER, { requestId: tap }), /Not found|isn't one of yours|not found/i);
});

test("handover: the pack's warranty is the contract's wording, never the catalogue's research notes", async () => {
  await seedHandover();
  const catalogueRepo = await import("../lib/repo/catalogue.ts");
  const research =
    "Panasonic UK: 3 years standard; up to 5 years parts & labour when installed by a Panasonic Accredited Installer who registers the unit on the PRO Club portal. NOT confirmed: confirm current T&Cs before quoting customers.";
  for (const item of CATALOGUE) await catalogueRepo.upsert({ ...item, ...(item.kind === "outdoor" ? { warranty: research } : {}) });
  const draft = await field.handoverDraft(PROJECT, FGAS);
  const text = JSON.stringify(draft.snapshot);
  assert.ok(!text.includes("Accredited Installer") && !text.includes("NOT confirmed"), "no catalogue warranty text in the pack");
  // No accepted proposal here: the settings' wording (none by default), never invented.
  const { getSettings } = await import("../lib/settings-server.ts");
  assert.equal(draft.snapshot.warranty.text, (await getSettings())?.warranty.manufacturerSummary?.trim() || null);
  // With an accepted proposal, its frozen wording wins over today's settings.
  assert.equal(field.packWarrantyText({ warranty: "DEMO: the manufacturer's standard parts warranty, as set out in your contract." }, { warranty: { workmanshipYears: null, manufacturerSummary: "Changed since" } }), "DEMO: the manufacturer's standard parts warranty, as set out in your contract.");
  assert.equal(field.packWarrantyText({ warranty: null }, { warranty: { workmanshipYears: null, manufacturerSummary: "Set after the contract" } }), null, "the contract stated none, so the pack states none");
  assert.equal(field.packWarrantyText(null, { warranty: { workmanshipYears: null, manufacturerSummary: " DEMO summary " } }), "DEMO summary");
});

test("handover: signing an already-signed handover answers with the sign-off on record, not an error", async () => {
  await seedHandover();
  await field.publishHandoverPack(PROJECT, INSTALLER, { requestId: "7c7c7c7c-2222-4222-8222-00000000f6e3" });
  const signed = await field.signHandover(PROJECT, INSTALLER, { name: "Pat Example", outcome: "all-good", snags: [] });
  assert.equal(signed.already, false);
  assert.equal(signed.signoff.name, "Pat Example");
  assert.equal(field.headerStateOf(signed.project).handoverStatus, "handed-over");
  // The reply was lost; the phone (or another one) signs again, even with other words.
  const twice = await field.signHandover(PROJECT, INSTALLER, { name: "Someone Else", outcome: "snags", snags: [{ id: "7c7c7c7c-3333-4333-8333-00000000f6e4", text: "DEMO: a mark" }] });
  assert.equal(twice.already, true);
  assert.deepEqual(twice.signoff, signed.signoff, "the sign-off on record");
  assert.equal((await issuesRepo.listForProject(PROJECT)).filter((i) => i.kind === "snag").length, 0, "no snag raised by the second try");
  assert.equal(field.headerStateOf(twice.project).version, field.headerStateOf(signed.project).version);
});

test("commissioning: signing a job that's already signed answers with the record and its certificate", async () => {
  await seedHandover();
  const tech = staffMember("aa000000-0000-4000-8000-0000000000f4", { roles: ["tech-lead"], qualifications: FGAS.qualifications });
  const job = (await installJobsRepo.getForProject(PROJECT))!;
  const record = { signedBy: { staffId: tech.id, name: tech.name, qualificationRef: "DEMO-F" }, at: AT, results: [] };
  await installJobsRepo.save({ ...job, commissioning: record });
  const r = await field.signCommissioning(PROJECT, tech, "again", []);
  assert.equal(r.already, true);
  assert.equal(r.record.at, AT);
  assert.equal(field.headerStateOf(r.project).handoverStatus, "commissioned");
});

test("starting the day that's already under way answers with it, not 'already started'", async () => {
  await seed("in-progress", "2026-11-10T08:00:00.000Z");
  const before = (await field.loadFieldJob(PROJECT, INSTALLER)).header;
  assert.equal(before.currentDay, 1);
  const p = await field.startDay(PROJECT, INSTALLER, 1);
  const state = field.headerStateOf(p);
  assert.equal(state.currentDay, 1);
  assert.equal(state.version, before.version, "nothing recorded twice");
});

test("the end-of-day picker draws the newest 24 photos, keeps picked ones, and reuses its URLs when opened again", async () => {
  const { PICKER_PAGE, URL_REUSE_MS, pickerShown, reuseUrls } = await import("../components/field/day-photos.ts");
  assert.equal(PICKER_PAGE, 24);
  // A long day: 40 work photos in two steps, 10 check photos; every one a 2048 px original.
  const at = (i: number) => new Date(Date.UTC(2026, 10, 10, 8, i)).toISOString();
  const photo = (i: number) => ({ id: `p${i}`, url: `/files/p${i}.jpg?sig=a`, takenAt: at(i) });
  const groups = [
    { key: "pipes", photos: Array.from({ length: 25 }, (_, i) => photo(i)) },
    { key: "units", photos: Array.from({ length: 15 }, (_, i) => photo(25 + i)) },
    { key: "checks", photos: Array.from({ length: 10 }, (_, i) => photo(40 + i)) },
  ];
  const first = pickerShown(groups, PICKER_PAGE, []);
  const drawn = first.groups.flatMap((g) => g.photos.map((p) => p.id));
  assert.equal(drawn.length, 24, "never all 50 at once");
  assert.equal(first.hidden, 26);
  assert.ok(drawn.includes("p49") && !drawn.includes("p25"), "the newest ones");
  assert.deepEqual(first.groups.map((g) => g.key), ["units", "checks"], "groups with nothing drawn are left out, order kept");
  // An older photo already picked stays in view; "Show more" brings in the rest.
  assert.ok(pickerShown(groups, PICKER_PAGE, ["p0"]).groups.some((g) => g.photos.some((p) => p.id === "p0")));
  assert.equal(pickerShown(groups, 2 * PICKER_PAGE, []).hidden, 2);
  assert.equal(pickerShown(groups, 3 * PICKER_PAGE, []).hidden, 0);

  // Opened again: the server's new URLs are swapped for the ones the phone already has, while they're young.
  const t0 = Date.parse(at(0));
  const opened = reuseUrls(groups, undefined, t0);
  const resigned = groups.map((g) => ({ ...g, photos: g.photos.map((p) => ({ ...p, url: p.url.replace("sig=a", "sig=b") })) }));
  const again = reuseUrls(resigned, opened.urls, t0 + 10 * 60_000);
  assert.ok(again.groups.every((g) => g.photos.every((p) => p.url?.endsWith("sig=a"))), "same src: the browser's copy");
  const late = reuseUrls(resigned, opened.urls, t0 + URL_REUSE_MS + 1);
  assert.ok(late.groups.every((g) => g.photos.every((p) => p.url?.endsWith("sig=b"))), "old URLs are let go before they'd expire");
  // A photo synced since the last open gets its own URL.
  const withNew = reuseUrls([{ key: "units", photos: [...resigned[1]!.photos, { id: "p99", url: "/files/p99.jpg?sig=b", takenAt: at(59) }] }], opened.urls, t0 + 60_000);
  assert.equal(withNew.groups[0]!.photos.find((p) => p.id === "p99")!.url, "/files/p99.jpg?sig=b");
  assert.equal(withNew.urls.get("p99")?.at, t0 + 60_000);
});

test("the picker's thumbnails are small, lazy and fixed-size; the list is capped with Show more", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/field/quick-actions.tsx", import.meta.url), "utf8");
  assert.match(src, /<img src=\{p\.url\} alt="" width=\{320\} height=\{240\} loading="lazy" decoding="async"/);
  assert.match(src, /pickerShown\(/);
  assert.match(src, /Show more photos/);
  assert.match(src, /reuseUrls\(groups, dayPhotoUrls\.get\(key\)/);
});

test("outbox: a photo refused because the sign-in ran out (401) waits for sign-in and sends after, never 'needs attention' for good", async () => {
  let signedOut = true;
  const outbox = new FieldOutbox({
    store: memoryStore(),
    now: () => 1_000,
    online: () => true,
    upload: async () => {
      if (signedOut) throw Object.assign(new Error("Sign in required"), { status: 401, retryable: false });
      return MEDIA;
    },
    send: async (ops) => ops.map((o) => ({ id: o.id, ok: true as const })),
  });
  await outbox.ready();
  outbox.setSignedIn({ id: "s-1", name: "DEMO Joe" });
  await outbox.enqueueMedia({ projectId: PROJECT, blob: new Blob(["x"]), fileName: "d.jpg", tag: "progress", source: "install" }, "Day photo");
  await outbox.flush(true);
  const held = outbox.state().items[0]!;
  assert.notEqual(held.state, "failed", "not a permanent failure");
  assert.match(held.lastError ?? "", /signed out\. Sign in again and it will send/);
  assert.equal(badgeState(outbox.state()).text.includes("needs attention"), false);
  // Signed in again (the page after the sign-in link): it goes by itself.
  signedOut = false;
  await outbox.flush(true);
  assert.equal(outbox.state().items.length, 0);
});
