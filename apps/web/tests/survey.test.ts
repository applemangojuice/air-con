import { test } from "node:test";
import assert from "node:assert/strict";
import { PD_CHECKS, generateQuote, type MeasuredSurvey, type StaffMember, type Survey } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";
import { quoteRow } from "./helpers/rows.ts";

// The real survey server on the in-memory local backend: nothing touches disk or a real database.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const survey = await import("../lib/survey-server.ts");
const { createProjectForQuote, dispatch, loadProject } = await import("../lib/project-service.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const mediaRepo = await import("../lib/repo/media.ts");
const timeRepo = await import("../lib/repo/time.ts");
const { listDocuments } = await import("../lib/documents-server.ts");

/** DEMO people and a fictional DEMO home only. */
const surveyor: StaffMember = {
  id: "de300000-0000-4000-8000-0000000000a2",
  email: "demo.surveyor.test@demo.dang.invalid",
  name: "DEMO Sam",
  roles: ["surveyor"],
  external: false,
  active: true,
  qualifications: [],
  demo: true,
};

const SELF: Survey = {
  postcode: "SW16 9ZZ",
  addressLine: "1 Demo Street",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [
    { id: "self-r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
  ],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

async function newProject(opts: { phone?: string } = {}): Promise<string> {
  const db = requireDb();
  const quoteId = crypto.randomUUID();
  const { error } = await db.from("quote_requests").insert(
    quoteRow({
      id: quoteId,
      customer_name: "Alex Rivers (DEMO)",
      email: `demo.${quoteId.slice(0, 8)}@example.com`,
      phone: opts.phone ?? null,
      postcode: SELF.postcode,
      address_line: SELF.addressLine,
      survey: SELF,
      quote: generateQuote(SELF),
      source: "demo",
    }),
  );
  assert.equal(error, null);
  const created = await createProjectForQuote(quoteId);
  assert.ok("id" in created, "project created");
  const id = (created as { id: string }).id;
  const booked = await dispatch(id, { type: "ops-book-survey", scheduledFor: "2099-01-05T10:00:00.000Z", mode: "in-person" }, surveyor);
  assert.ok("project" in booked, "survey booked");
  return id;
}

async function addPhoto(projectId: string, tag: "indoor-wall" | "outdoor-location" | "fuse-board", roomId?: string): Promise<string> {
  const id = crypto.randomUUID();
  await mediaRepo.insert({
    id,
    projectId,
    bucket: "project-media",
    storagePath: `${projectId}/${id}-photo.jpg`,
    contentType: "image/jpeg",
    tag,
    ...(roomId ? { roomId } : {}),
    source: "survey",
    takenAt: new Date().toISOString(),
    customerVisible: false,
    annotations: [],
    annotationsVersion: 0,
    locked: false,
  });
  return id;
}

/** Finish a draft the way a surveyor would. */
function finish(m: MeasuredSurvey, photos: { room: string; outdoor: string; board: string }): MeasuredSurvey {
  return {
    ...m,
    site: { ...m.site, confirmedAddress: true, decisionMaker: "Alex Rivers", ownerConfirmed: true, tenure: "owner", accessNotes: "Side gate (DEMO)" },
    wishes: { ...m.wishes, heatingUse: "supplementary" },
    house: { ...m.house, asbestosRisk: "none-suspected" },
    rooms: m.rooms.map((r) => ({
      ...r,
      lengthM: 4,
      widthM: 3.5,
      areaM2: 14,
      ceilingHeightM: 2.4,
      pipeRunM: 5,
      heightDropM: 3,
      route: "external-trunking" as const,
      condensate: "gravity" as const,
      mediaIds: [photos.room],
    })),
    outdoor: {
      positions: [
        {
          id: "outdoor-1",
          label: "Rear patio",
          location: "ground-rear",
          base: "ground-feet",
          accessEquipment: "none",
          chosen: true,
          mediaId: photos.outdoor,
          distanceToNeighbourWindowM: 5,
          reflectingSurfaces: "two",
          defrostDrainage: "Gravel to the gully",
        },
      ],
    },
    electrics: { ...m.electrics, boardType: "modern-rcbo", spareWays: 2, cableRouteM: 8, mediaIds: [photos.board] },
    permissions: { pd: Object.fromEntries(PD_CHECKS.map((c) => [c.id, "yes"])) },
    risks: { ...m.risks, answered: ["workingAtHeight", "structuralConcern", "concealedServicesConcern"] },
  };
}

test("parseMeasuredSurvey: accepts the prefill, strips unknown keys, refuses junk", async () => {
  const { emptyMeasuredSurvey } = await import("@aircon/domain");
  const m = emptyMeasuredSurvey(SELF);
  const ok = survey.parseMeasuredSurvey({ ...m, extra: "<script>", site: { ...m.site, sneaky: 1 } });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal("extra" in ok.data, false);
    assert.equal("sneaky" in ok.data.site, false);
    assert.deepEqual(ok.data.rooms[0]!.mediaIds, []);
  }
  assert.equal(survey.parseMeasuredSurvey(null).ok, false);
  assert.equal(survey.parseMeasuredSurvey({ ...m, version: 2 }).ok, false);
  const badNumber = survey.parseMeasuredSurvey({ ...m, rooms: [{ ...m.rooms[0]!, ceilingHeightM: 40 }] });
  assert.equal(badNumber.ok, false);
  if (!badNumber.ok) assert.match(badNumber.error, /rooms\.0\.ceilingHeightM/);
  assert.equal(survey.parseMeasuredSurvey({ ...m, rooms: [{ ...m.rooms[0]!, mediaIds: ["not-a-uuid"] }] }).ok, false);
  assert.equal(survey.parseMeasuredSurvey({ ...m, rooms: [{ ...m.rooms[0]!, id: "../x" }] }).ok, false);
  assert.equal(survey.parseMeasuredSurvey({ ...m, rooms: [m.rooms[0]!, m.rooms[0]!] }).ok, false, "duplicate room ids");
  assert.equal(survey.parseMeasuredSurvey({ ...m, permissions: { pd: { "heating-use": "maybe" } } }).ok, false);
  const many = survey.parseMeasuredSurvey({ ...m, rooms: Array.from({ length: 31 }, (_, i) => ({ ...m.rooms[0]!, id: `r${i}` })) });
  assert.equal(many.ok, false);
});

test("keepMedia drops photos that aren't this project's; nextToken always moves forward", () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const m = {
    rooms: [{ mediaIds: [a, b, a] }],
    outdoor: { positions: [{ id: "o", mediaId: b }, { id: "p", mediaId: a }] },
    electrics: { mediaIds: [b] },
  } as unknown as MeasuredSurvey;
  const kept = survey.keepMedia(m, new Set([a]));
  assert.deepEqual(kept.rooms[0]!.mediaIds, [a]);
  assert.equal(kept.outdoor.positions[0]!.mediaId, undefined);
  assert.equal(kept.outdoor.positions[1]!.mediaId, a);
  assert.deepEqual(kept.electrics.mediaIds, []);
  assert.deepEqual(survey.referencedMediaIds(m).sort(), [a, b, a, b, a, b].sort());

  const prev = "2026-10-18T10:00:00.500Z";
  assert.equal(survey.nextToken(prev, new Date("2026-10-18T10:00:00.100Z")), "2026-10-18T10:00:00.501Z");
  assert.equal(survey.nextToken(prev, new Date("2026-10-18T10:00:05.000Z")), "2026-10-18T10:00:05.000Z");
  assert.ok(survey.nextToken("2026-10-18T10:00:00.123456+00:00") > "2026-10-18T10:00:00.123");
});

test("on my way: records the ETA and says honestly that the text is demo-only here", async () => {
  const projectId = await newProject({ phone: "07700 900101" });
  const project = (await loadProject(projectId))!;
  const preview = await survey.onMyWayPreview(project, 20, surveyor.name, new Date("2026-10-18T09:00:00.000Z"));
  assert.match(preview, /DEMO Sam is on the way to your home survey/);
  assert.match(preview, /around 10:20/, "arrival time in London (BST)");
  assert.ok(preview.length <= 306, "fits two SMS segments");

  const bad = await survey.sendOnMyWay(projectId, 0, surveyor);
  assert.equal(bad.ok, false);
  const sent = await survey.sendOnMyWay(projectId, 20, surveyor);
  assert.equal(sent.ok, true);
  if (sent.ok) {
    assert.equal(sent.etaMinutes, 20);
    assert.equal(sent.text.state, "demo", "no SMS provider here: stored, never claimed as sent");
    assert.equal(sent.smsMode, "demo");
  }
  // No mobile: a text could never arrive, so it goes by email instead (recorded as demo here).
  const noPhone = await newProject();
  const quiet = await survey.sendOnMyWay(noPhone, 15, surveyor);
  assert.ok(quiet.ok && quiet.text.channel === "email" && quiet.text.state === "demo", JSON.stringify(quiet));
});

test("start → autosave with an optimistic check → submit, end to end", async () => {
  const projectId = await newProject({ phone: "07700 900102" });

  const started = await survey.startSurvey(projectId, surveyor);
  assert.ok(started.ok, "started");
  if (!started.ok) return;
  assert.equal(started.created, true);
  const draft = started.draft;
  assert.equal(draft.record.status, "draft");
  assert.equal(draft.record.data.rooms[0]!.name, "Main bedroom", "prefilled from the customer's survey");
  assert.equal(draft.record.data.site.siteContactPhone, "07700 900102");
  let project = (await loadProject(projectId))!;
  assert.equal(project.survey.status, "in-progress");
  assert.equal(project.survey.surveyor?.staffId, surveyor.id, "the person who started it is the surveyor");
  const open = await timeRepo.openForStaff(surveyor.id);
  assert.equal(open?.kind, "survey");
  assert.equal(open?.projectId, projectId);

  // Pressing start again (or a retry) resumes the same draft.
  const again = await survey.startSurvey(projectId, surveyor);
  assert.ok(again.ok && !again.created && again.draft.record.id === draft.record.id);

  // A save based on the current token lands; one based on an old token is refused with the current copy.
  const edited = { ...draft.record.data, wishes: { ...draft.record.data.wishes, notes: "Quiet bedroom unit (DEMO)" } };
  const saved = await survey.saveDraft(projectId, edited, draft.updatedAt, surveyor);
  assert.ok(saved.ok, "saved");
  if (!saved.ok) return;
  assert.notEqual(saved.updatedAt, draft.updatedAt);
  const stale = await survey.saveDraft(projectId, draft.record.data, draft.updatedAt, surveyor);
  assert.equal(stale.ok, false);
  assert.ok(!stale.ok && "conflict" in stale && stale.current.record.data.wishes.notes === "Quiet bedroom unit (DEMO)");
  const junk = await survey.saveDraft(projectId, { nope: true }, saved.updatedAt, surveyor);
  assert.ok(!junk.ok && junk.status === 400);

  // Submitting an unfinished survey is refused with exactly what's missing.
  const early = await survey.submitSurvey(projectId, edited, saved.updatedAt, surveyor);
  assert.equal(early.ok, false);
  assert.ok(!early.ok && "completeness" in early && early.completeness!.missing.length > 5);
  const afterEarly = (await survey.loadDraft(projectId))!;
  assert.equal(afterEarly.record.status, "draft", "a refused submit leaves the draft editable");

  // Photos: this project's are kept, another project's are dropped.
  const photos = {
    room: await addPhoto(projectId, "indoor-wall", draft.record.data.rooms[0]!.id),
    outdoor: await addPhoto(projectId, "outdoor-location"),
    board: await addPhoto(projectId, "fuse-board"),
  };
  const otherProject = await newProject();
  const foreign = await addPhoto(otherProject, "indoor-wall");
  const done = finish(edited, photos);
  done.rooms[0]!.mediaIds.push(foreign);
  const finalSave = await survey.saveDraft(projectId, done, afterEarly.updatedAt, surveyor);
  assert.ok(finalSave.ok);
  if (!finalSave.ok) return;
  assert.deepEqual(finalSave.record.data.rooms[0]!.mediaIds, [photos.room], "someone else's photo never rides along");
  assert.equal(finalSave.completeness.pct, 100);

  const submitted = await survey.submitSurvey(projectId, finalSave.record.data, finalSave.updatedAt, surveyor);
  assert.ok(submitted.ok, `submitted: ${!submitted.ok ? submitted.error : ""}`);
  if (!submitted.ok) return;
  assert.equal(submitted.record.status, "submitted");
  assert.equal(typeof submitted.record.minutes, "number");
  project = (await loadProject(projectId))!;
  assert.equal(project.survey.status, "submitted");
  assert.equal(project.survey.surveyRecordId, submitted.record.id);
  assert.equal(project.electrics.status, "validated", "the surveyor's board finding replaces the funnel's guess");
  assert.equal(project.customer.accessNotes, "Side gate (DEMO)", "access notes reach the crew");
  assert.equal(await timeRepo.openForStaff(surveyor.id), null, "the survey clock stopped");
  const docs = await listDocuments(projectId);
  const report = docs.find((d) => d.kind === "survey-report");
  assert.ok(report, "the customer's survey report is issued");
  assert.equal(report!.customerVisible, true);
  const entries = await timeRepo.listForProject(projectId);
  assert.ok(entries.some((e) => e.kind === "survey" && e.endedAt));

  // Frozen after submit; a retried submit finishes cleanly.
  const latest = (await survey.loadDraft(projectId))!;
  const late = await survey.saveDraft(projectId, latest.record.data, latest.updatedAt, surveyor);
  assert.ok(!late.ok && late.status === 409);
  const retry = await survey.submitSurvey(projectId, latest.record.data, latest.updatedAt, surveyor);
  assert.ok(retry.ok, "a retried submit is not an error");
  const restart = await survey.startSurvey(projectId, surveyor);
  assert.ok(!restart.ok && restart.status === 409);
});

test("no signal at the door: a draft prepared online starts on the phone, and the start reaches the server later", async () => {
  const projectId = await newProject({ phone: "07700 900103" });
  // "On my way" (signal in the car) gets the draft ready, without starting anything.
  const sent = await survey.sendOnMyWay(projectId, 10, surveyor);
  assert.ok(sent.ok && sent.prepared, "the on-my-way answer carries the prepared draft");
  if (!sent.ok || !sent.prepared) return;
  const prepared = sent.prepared;
  assert.equal(prepared.record.status, "draft");
  assert.equal(prepared.record.startedAt, undefined, "not started");
  assert.equal(prepared.record.data.rooms[0]!.name, "Main bedroom", "prefilled like a normal start");
  assert.equal((await loadProject(projectId))!.survey.status, "booked", "the customer sees nothing yet");
  assert.equal((await timeRepo.openForStaff(surveyor.id))?.projectId === projectId, false, "no clock yet");
  const twice = await survey.prepareSurveyDraft((await loadProject(projectId))!, surveyor);
  assert.equal(twice?.record.id, prepared.record.id, "preparing again reuses it");

  // The phone started at the door with no signal, and its autosave lands first when signal returns.
  const startedOnPhone = new Date(Date.now() - 10 * 60_000).toISOString();
  const edited = { ...prepared.record.data, wishes: { ...prepared.record.data.wishes, notes: "Started with no signal (DEMO)" } };
  const saved = await survey.saveDraft(projectId, edited, prepared.updatedAt, surveyor);
  assert.ok(saved.ok, "a prepared draft takes saves");
  if (!saved.ok) return;

  // Then the start is replayed with the phone's time.
  const started = await survey.startSurvey(projectId, surveyor, { startedAt: startedOnPhone });
  assert.ok(started.ok, !started.ok ? started.error : "");
  if (!started.ok) return;
  assert.equal(started.created, false);
  assert.equal(started.draft.record.id, prepared.record.id);
  // The same instant (PostgREST writes a timestamptz back as "…+00:00", not the phone's "…Z").
  assert.equal(Date.parse(started.draft.record.startedAt ?? ""), Date.parse(startedOnPhone), "dated when it really began");
  assert.equal(started.draft.updatedAt, saved.updatedAt, "the save token doesn't move, so the phone carries on saving");
  assert.equal(started.draft.record.data.wishes.notes, "Started with no signal (DEMO)");
  const project = (await loadProject(projectId))!;
  assert.equal(project.survey.status, "in-progress");
  const clock = await timeRepo.openForStaff(surveyor.id);
  assert.equal(clock?.projectId, projectId);
  assert.equal(Date.parse(clock?.startedAt ?? ""), Date.parse(startedOnPhone), "the survey clock runs from the phone's start");
  const next = await survey.saveDraft(projectId, edited, saved.updatedAt, surveyor);
  assert.ok(next.ok, "the phone's next save isn't a conflict");

  // The phone's time is bounded: never in the future, never more than 12 hours back.
  const now = "2026-10-19T10:00:00.000Z";
  assert.equal(survey.startedAtFrom("2026-10-19T09:40:00.000Z", now), "2026-10-19T09:40:00.000Z");
  assert.equal(survey.startedAtFrom("2026-10-19T11:00:00.000Z", now), now);
  assert.equal(survey.startedAtFrom("2026-10-18T21:00:00.000Z", now), now);
  assert.equal(survey.startedAtFrom("junk", now), now);
  assert.equal(survey.startedAtFrom(undefined, now), now);
});

test("the phone's pending start is sent once there's signal, and kept until then", async () => {
  const { canStartOnPhone, pendingStart, replayPendingStart, setPendingStart } = await import("../components/field/survey/pending-start.ts");
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
  const id = "de300000-0000-4000-8000-00000000c0de";
  assert.equal(await replayPendingStart(id, fetch, store), "none");
  setPendingStart(id, "2026-10-19T09:40:00.000Z", store);
  assert.equal(pendingStart(id, store), "2026-10-19T09:40:00.000Z");
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  assert.equal(await replayPendingStart(id, offline, store), "kept");
  const busy = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
  assert.equal(await replayPendingStart(id, busy, store), "kept");
  let body = "";
  const ok = (async (_url: string, init?: RequestInit) => {
    body = String(init?.body ?? "");
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await replayPendingStart(id, ok, store), "sent");
  assert.deepEqual(JSON.parse(body), { startedAt: "2026-10-19T09:40:00.000Z" });
  assert.equal(pendingStart(id, store), null);
  setPendingStart(id, "2026-10-19T09:40:00.000Z", store);
  const submitted = (async () => new Response("{}", { status: 409 })) as unknown as typeof fetch;
  assert.equal(await replayPendingStart(id, submitted, store), "dropped", "already submitted elsewhere: nothing to replay");
  assert.equal(canStartOnPhone({ record: { status: "draft" } }), true);
  assert.equal(canStartOnPhone({ record: { status: "draft", startedAt: "2026-10-19T09:00:00.000Z" } }), false);
  assert.equal(canStartOnPhone(null), false);
});

test("documents consent in person, and stop-work issues raised once", async () => {
  const projectId = await newProject();
  const consent = await survey.recordDocumentsConsent(projectId, surveyor);
  assert.ok(consent.ok && consent.consent.channel === "in-person");
  const project = (await loadProject(projectId))!;
  assert.equal(project.proposal.documentsByEmailConsent?.channel, "in-person");

  const first = await survey.raiseSurveyIssue(projectId, "asbestos", "Artex ceiling on the landing (DEMO)", surveyor);
  assert.ok(first.ok && first.created);
  const second = await survey.raiseSurveyIssue(projectId, "asbestos", "again", surveyor);
  assert.ok(second.ok && !second.created && first.ok && second.issue.id === first.issue.id);
  const open = await survey.openSurveyIssues(projectId);
  assert.ok(open.asbestos);
  assert.equal(open.structural, undefined);
});

test("every submitted DEMO survey passes the completeness check (the seed and the rules agree)", async () => {
  const { buildDemoDataset } = await import("../lib/demo-seed/builder.ts");
  const { surveyCompleteness } = await import("@aircon/domain");
  const data = buildDemoDataset({ now: "2026-10-18T10:00:00.000Z" });
  const surveyed = data.projects.filter((p) => p.survey);
  assert.ok(surveyed.length >= 3);
  for (const p of surveyed) {
    const c = surveyCompleteness(p.survey!.data);
    assert.deepEqual(c.missing, [], `${p.project.pilot?.label ?? p.project.id}: ${c.missing.map((m) => m.item).join("; ")}`);
  }
});

test("the surveyor's list shows booked and in-progress surveys they can work on", async () => {
  const projectId = await newProject();
  const list = await survey.listSurveysFor(surveyor);
  assert.ok(list.some((s) => s.projectId === projectId && s.status === "booked"));
  const sub: StaffMember = { ...surveyor, id: "de300000-0000-4000-8000-0000000000a9", external: true };
  const theirs = await survey.listSurveysFor(sub);
  assert.equal(theirs.some((s) => s.projectId === projectId), false, "a subcontractor sees only surveys assigned to them");
});
