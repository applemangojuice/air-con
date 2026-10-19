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
    item(ev("c"), 3),
    item(ev("a"), 1),
    item(ev("b", { mediaId: `${LOCAL_MEDIA_PREFIX}m1` }), 2),
    item(ev("d"), 4, { nextAttemptAt: 10_000 }),
    item(ev("e"), 5, { state: "failed" }),
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

test("outbox: photos upload first, ops follow with the real id; offline keeps everything; acks are remembered", async () => {
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
  assert.equal(sent.length, 1);
  const first = sent[0]!.find((o) => o.id === "p1") as Extract<SyncOp, { type: "evidence" }>;
  assert.equal(first.mediaId, MEDIA, "the placeholder became the real media id");
  assert.deepEqual(outbox.state().acked.map((o) => o.id).sort(), ["p1", "p2"]);
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

async function seed(install: Project["install"]["status"]): Promise<Project> {
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
    install: { ...base.install, status: install, days: install === "not-started" ? [] : [{ n: 1, date: "2026-11-10", status: "in-progress", startedAt: "2026-11-10T08:00:00.000Z" }] },
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
