import { test } from "node:test";
import assert from "node:assert/strict";
import type { Annotation, StaffMember } from "@aircon/domain";
import { annotatedAlt, chipTextColour, describeAnnotations, legendEntries } from "../components/annotate/annotation-summary.ts";
import { registerAppResolver } from "./helpers/resolve-app.ts";

process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const media = await import("../lib/media-server.ts");
const { requireDb, MEDIA_BUCKET } = await import("../lib/supabase-server.ts");
const mediaRepo = await import("../lib/repo/media.ts");

const PROJECT = "6d6d6d6d-4444-4444-8444-000000000004";
const OTHER = "7e7e7e7e-5555-4555-8555-000000000005";
const MEDIA = "8f8f8f8f-6666-4666-8666-000000000006";

/** DEMO people only. */
const person = (roles: StaffMember["roles"], external = false): StaffMember => ({
  id: `demo-${roles.join("-")}${external ? "-ext" : ""}`,
  email: "demo@demo.dang.invalid",
  name: "DEMO person",
  roles,
  external,
  active: true,
  qualifications: [],
});

/* ------------------------------------------------------------------ */
/* Paths and names                                                     */
/* ------------------------------------------------------------------ */

test("safeMediaName: no directories, safe characters, extension kept or added", () => {
  assert.equal(media.safeMediaName("../../etc/passwd"), "passwd");
  assert.equal(media.safeMediaName("C:\\Users\\me\\Living room 1.JPG"), "Living_room_1.JPG");
  assert.equal(media.safeMediaName(".hidden"), "file.hidden");
  assert.equal(media.safeMediaName("....jpg"), "file.jpg");
  assert.equal(media.safeMediaName("", "image/jpeg"), "file.jpg");
  assert.equal(media.safeMediaName("photo", "image/webp"), "photo.webp");
  assert.equal(media.safeMediaName("Café façade.png"), "Cafe_facade.png");
  const long = media.safeMediaName(`${"x".repeat(200)}.jpeg`);
  assert.ok(long.length <= 80 && long.endsWith(".jpeg"), long);
  assert.doesNotMatch(media.safeMediaName("a/../b\u0000c%2e%2e.pdf"), /[\/\\\u0000]|\.\./);
});

test("mediaObjectPath: <projectId>/<mediaId>-<safeName>, uuids only", () => {
  const path = media.mediaObjectPath(PROJECT, MEDIA, "../Room 1.jpg", "image/jpeg");
  assert.equal(path, `${PROJECT}/${MEDIA}-Room_1.jpg`);
  assert.equal(media.mediaObjectPath(PROJECT.toUpperCase(), MEDIA, "x.jpg"), `${PROJECT}/${MEDIA}-x.jpg`, "ids are lower-cased");
  assert.throws(() => media.mediaObjectPath("../../etc", MEDIA, "x.jpg"), /Unknown project/);
  assert.throws(() => media.mediaObjectPath(PROJECT, "not-an-id", "x.jpg"), /Bad media id/);
});

test("isProjectMediaPath: exactly this project and this media id, nothing nested or escaping", () => {
  const good = `${PROJECT}/${MEDIA}-room.jpg`;
  assert.equal(media.isProjectMediaPath(PROJECT, MEDIA, good), true);
  assert.equal(media.isProjectMediaPath(OTHER, MEDIA, good), false, "another project");
  assert.equal(media.isProjectMediaPath(PROJECT, "9a9a9a9a-7777-4777-8777-000000000007", good), false, "another media id");
  assert.equal(media.isProjectMediaPath(PROJECT, MEDIA, `${PROJECT}/../${OTHER}/${MEDIA}-room.jpg`), false);
  assert.equal(media.isProjectMediaPath(PROJECT, MEDIA, `${PROJECT}/sub/${MEDIA}-room.jpg`), false);
  assert.equal(media.isProjectMediaPath(PROJECT, MEDIA, `${PROJECT}/${MEDIA}-`), false, "no name");
  assert.equal(media.isProjectMediaPath(PROJECT, MEDIA, `/${good}`), false, "not canonical");
});

test("content types: photos, PDFs and MP4 from uploads; SVG only from the system", () => {
  for (const ct of ["image/jpeg", "image/JPG", "image/png; charset=binary", "image/webp", "image/heic", "application/pdf", "video/mp4"]) {
    assert.equal(media.mediaContentTypeAllowed(ct), true, ct);
  }
  for (const ct of ["image/svg+xml", "text/html", "application/javascript", "image/gif", ""]) {
    assert.equal(media.mediaContentTypeAllowed(ct), false, ct);
  }
  assert.equal(media.mediaContentTypeAllowed("image/svg+xml", { system: true }), true);
});

test("permissions: who may add media from each source", () => {
  const installer = person(["installer"]);
  const surveyor = person(["surveyor"]);
  const sub = person(["installer"], true);
  const electrician = person(["electrician"]);
  assert.equal(media.canWriteMedia(installer, "install"), true);
  assert.equal(media.canWriteMedia(installer, "survey"), false);
  assert.equal(media.canWriteMedia(surveyor, "survey"), true);
  assert.equal(media.canWriteMedia(surveyor, "install"), true, "surveyors can edit projects");
  assert.equal(media.canWriteMedia(sub, "install"), true);
  assert.equal(media.canWriteMedia(sub, "ops"), false);
  assert.equal(media.canWriteMedia(electrician, "handover"), true);
  assert.equal(media.canEditMedia(electrician), true);
  assert.equal(media.canEditMedia({ ...installer, active: false }), false);
});

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

test("cleanAnnotations: clamps to 0..1, drops junk, unique ids, short labels", () => {
  const out = media.cleanAnnotations([
    { id: "u", type: "indoor-unit", x: -0.2, y: 0.1, w: 1.5, h: 0.1, label: "Unit" },
    { id: "u", type: "core-hole", x: 0.5, y: 2 },
    { type: "route", kind: "pipe", points: [{ x: 0.1, y: 0.1 }, { x: "bad" }, { x: 0.3, y: 0.4 }], label: "x".repeat(300) },
    { type: "route", kind: "gas", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    { type: "route", kind: "pipe", points: [{ x: 0, y: 0 }] },
    { type: "measure", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
    { type: "measure", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, label: "2 m" },
    { type: "obstacle", x: 0.5, y: 0.5 },
    { type: "note", x: 0.5, y: 0.5, text: "   " },
    { type: "note", x: 0.5, y: 0.5, text: "Joists" },
    { type: "script", x: 0, y: 0 },
    null,
    "junk",
  ]);
  assert.deepEqual(
    out.map((a) => a.type),
    ["indoor-unit", "core-hole", "route", "measure", "obstacle", "note"],
  );
  const unit = out[0] as Extract<Annotation, { type: "indoor-unit" | "outdoor-unit" }>;
  assert.deepEqual([unit.x, unit.y, unit.w, unit.h], [0, 0.1, 1, 0.1]);
  assert.equal((out[1] as Extract<Annotation, { type: "core-hole" }>).y, 1);
  assert.equal(new Set(out.map((a) => a.id)).size, out.length, "ids are unique");
  assert.equal((out[2] as Extract<Annotation, { type: "route" }>).points.length, 2);
  assert.equal((out[2] as Extract<Annotation, { type: "route" }>).label!.length, 80);
  assert.equal((out[4] as Extract<Annotation, { type: "obstacle" }>).label, "Obstacle");
  assert.deepEqual(media.cleanAnnotations("nope"), []);
  assert.equal(media.cleanAnnotations(Array.from({ length: 500 }, (_, i) => ({ type: "core-hole", x: 0.1, y: 0.1, id: `h${i}` }))).length, media.MAX_ANNOTATIONS);
});

test("validateAnnotationsSafe: F2's validator, as a result", () => {
  const result = media.validateAnnotationsSafe([{ id: "a", type: "core-hole", x: 0.4, y: 0.6 }, { type: "nonsense" }]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.annotations.length, 1);
    assert.equal(result.annotations[0]!.type, "core-hole");
  }
});

test("annotation summary: alt text, legend and chip contrast", () => {
  const list: Annotation[] = [
    { id: "1", type: "indoor-unit", x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
    { id: "2", type: "route", kind: "pipe", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], label: "4.2 m" },
    { id: "3", type: "core-hole", x: 0.5, y: 0.5 },
  ];
  assert.equal(describeAnnotations(list), "Indoor unit, pipe route 4.2 m, core hole");
  assert.equal(annotatedAlt("Living room wall (DEMO)", list), "Living room wall (DEMO). Marked up: Indoor unit, pipe route 4.2 m, core hole");
  assert.equal(annotatedAlt(undefined, []), "Photo");
  // A label that already names the thing isn't said twice.
  assert.equal(
    describeAnnotations([
      { id: "a", type: "route", kind: "pipe", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], label: "Pipe route 13 m" },
      { id: "b", type: "indoor-unit", x: 0, y: 0, w: 0.2, h: 0.1, label: "Indoor unit · 3.5 kW" },
    ]),
    "Pipe route 13 m, indoor unit · 3.5 kW",
  );
  assert.equal(
    describeAnnotations([
      { id: "a", type: "route", kind: "condensate", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: "b", type: "obstacle", x: 0, y: 0, label: "downpipe" },
      { id: "c", type: "measure", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, label: "2.1 m to boundary" },
      { id: "d", type: "note", x: 0, y: 0, text: "Check joists" },
      { id: "e", type: "outdoor-unit", x: 0, y: 0, w: 0.2, h: 0.2, label: "Duo 50" },
    ]),
    "Condensate route, obstacle: downpipe, measurement 2.1 m to boundary, note: Check joists, outdoor unit (Duo 50)",
  );
  const legend = legendEntries([...list, { id: "4", type: "route", kind: "pipe", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
  assert.deepEqual(
    legend.map((e) => [e.key, e.count, e.mark]),
    [
      ["indoor-unit", 1, "box"],
      ["pipe", 2, "line"],
      ["core-hole", 1, "dot"],
    ],
  );
  assert.equal(chipTextColour("#ffffff"), "#14171e");
  assert.equal(chipTextColour("#facc15"), "#14171e");
  assert.equal(chipTextColour("#2563eb"), "#ffffff");
});

/* ------------------------------------------------------------------ */
/* Upload, register, read, edit (memory backend)                       */
/* ------------------------------------------------------------------ */

const takenBy = { kind: "staff" as const, id: "demo-staff", name: "DEMO Sam" };
const bytes = (n: number) => new Uint8Array(n).fill(7);

async function upload(path: string, contentType: string, size = 64) {
  const { error } = await requireDb().storage.from(MEDIA_BUCKET).upload(path, bytes(size), { contentType });
  assert.equal(error, null);
}

test("upload flow: a row only once the file is there, everything from the signed ticket, idempotent", async () => {
  const started = await media.createMediaUpload({
    projectId: PROJECT,
    fileName: "../Bedroom wall.jpg",
    contentType: "image/jpeg",
    tag: "indoor-wall",
    roomId: "r1",
    source: "survey",
    takenBy,
    customerVisible: true,
    width: 2048,
    height: 1536,
  });
  assert.equal(media.isProjectMediaPath(PROJECT, started.mediaId, started.path), true);
  assert.match(started.signedUrl, /^\/api\/local-files\/project-media\//);
  assert.equal(await mediaRepo.get(started.mediaId), null, "nothing recorded before the upload");

  const early = await media.registerMedia(started.ticket);
  assert.equal(early.ok, false);
  assert.equal(!early.ok && early.status, 409, "the file hasn't arrived");

  await upload(started.path, "image/jpeg");
  const first = await media.registerMedia(started.ticket);
  assert.ok(first.ok);
  assert.equal(first.created, true);
  assert.equal(first.item.id, started.mediaId);
  assert.equal(first.item.storagePath, started.path);
  assert.equal(first.item.tag, "indoor-wall");
  assert.equal(first.item.roomId, "r1");
  assert.deepEqual(first.item.takenBy, takenBy);
  assert.equal(first.item.width, 2048);
  assert.equal(first.item.customerVisible, true);

  const again = await media.registerMedia(started.ticket);
  assert.ok(again.ok);
  assert.equal(again.created, false, "confirming twice is safe");

  const urls = await media.signedMediaUrls([first.item, { id: "missing", bucket: MEDIA_BUCKET, storagePath: `${PROJECT}/${MEDIA}-gone.jpg` }]);
  assert.match(urls.get(first.item.id) ?? "", /op=get/);
  assert.equal(urls.has("missing"), false);

  const listed = await media.listProjectMedia(PROJECT, { customerVisibleOnly: true });
  assert.ok(listed.some((m) => m.id === first.item.id && m.url));
});

test("upload flow: forged, expired and mismatched uploads are refused", async () => {
  const started = await media.createMediaUpload({ projectId: PROJECT, fileName: "a.png", contentType: "image/png", tag: "fuse-board", source: "survey", takenBy });
  const [payload, sig] = started.ticket.split(".");
  const forged = `${payload!.slice(0, -2)}AA.${sig}`;
  assert.equal((await media.registerMedia(forged)).ok, false);
  assert.equal(await media.verifyUploadTicket(`${payload}.${"0".repeat(64)}`), null);
  assert.equal(await media.verifyUploadTicket(started.ticket, { nowSec: Math.floor(Date.now() / 1000) + 3 * 3600 }), null, "expired");
  assert.equal(await media.verifyUploadTicket(42), null);

  // Declared a PNG, uploaded HTML: refused, and the object is removed.
  await upload(started.path, "text/html");
  const refused = await media.registerMedia(started.ticket);
  assert.equal(!refused.ok && refused.status, 415);
  const { data } = await requireDb().storage.from(MEDIA_BUCKET).exists(started.path);
  assert.equal(data, false);

  await assert.rejects(
    media.createMediaUpload({ projectId: PROJECT, fileName: "x.svg", contentType: "image/svg+xml", tag: "other", source: "ops", takenBy }),
    /can't be uploaded/,
  );
  await assert.rejects(media.createMediaUpload({ projectId: "nope", fileName: "x.jpg", contentType: "image/jpeg", tag: "other", source: "ops" }), /Unknown project/);
});

test("updateMedia: drawings versioned, stale saves refused, locked items keep their drawing", async () => {
  const item = await media.storeSystemMedia({
    projectId: PROJECT,
    fileName: "demo.svg",
    contentType: "image/svg+xml",
    body: "<svg xmlns='http://www.w3.org/2000/svg'/>",
    tag: "indoor-wall",
    source: "ops",
  });
  assert.equal(item.annotationsVersion, 0);
  const drawn = await media.updateMedia(item.id, { annotations: [{ id: "h", type: "core-hole", x: 0.3, y: 0.3 }], expectedVersion: 0 });
  assert.ok(drawn.ok);
  assert.equal(drawn.item.annotationsVersion, 1);
  assert.equal(drawn.item.annotations.length, 1);

  const stale = await media.updateMedia(item.id, { annotations: [], expectedVersion: 0 });
  assert.equal(!stale.ok && stale.status, 409);

  const captioned = await media.updateMedia(item.id, { caption: "  Bedroom (DEMO) ", customerVisible: true, tag: "room-overview" });
  assert.ok(captioned.ok);
  assert.deepEqual([captioned.item.caption, captioned.item.customerVisible, captioned.item.tag], ["Bedroom (DEMO)", true, "room-overview"]);

  await mediaRepo.update({ ...captioned.item, locked: true });
  for (const patch of [{ annotations: [] }, { tag: "other" as const }, { roomId: "r9" }]) {
    const r = await media.updateMedia(item.id, patch);
    assert.equal(!r.ok && r.status, 409, JSON.stringify(patch));
  }
  const fine = await media.updateMedia(item.id, { caption: null });
  assert.ok(fine.ok);
  assert.equal(fine.item.caption, undefined);
  assert.equal(fine.item.annotations.length, 1, "the locked drawing is untouched");

  assert.equal((await media.updateMedia(MEDIA, { caption: "x" })).ok, false);
});
