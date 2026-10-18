import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMeasuredSurvey, type Annotation, type MeasuredSurvey } from "@aircon/domain";
import { canonical, decideResume, hashSurvey, retryDelayMs, sameSurvey, type LocalDraft } from "../components/field/survey/draft-store.ts";
import {
  clampView,
  defaultBox,
  dragHandle,
  fitBox,
  hitHandle,
  hitTest,
  lengthLabel,
  moveShape,
  pinchView,
  zoomAround,
} from "../components/annotate/annotator-geometry.ts";

/* ------------------------------------------------------------------ */
/* The phone's copy of the survey                                      */
/* ------------------------------------------------------------------ */

const base = emptyMeasuredSurvey();
const edited: MeasuredSurvey = { ...base, wishes: { ...base.wishes, notes: "Quiet please (DEMO)" } };
const other: MeasuredSurvey = { ...base, wishes: { ...base.wishes, notes: "Someone else's edit (DEMO)" } };
const server = (data: MeasuredSurvey, token = "T1") => ({ recordId: "rec-1", token, data });
const local = (over: Partial<LocalDraft> = {}): LocalDraft => ({
  recordId: "rec-1",
  baseToken: "T1",
  data: edited,
  dirty: true,
  savedAt: "2026-10-18T10:00:00.000Z",
  ...over,
});

test("canonical JSON ignores key order and undefined values", () => {
  assert.equal(canonical({ b: 1, a: { d: undefined, c: [1, { y: 2, x: 1 }] } }), canonical({ a: { c: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
  assert.equal(sameSurvey(edited, JSON.parse(JSON.stringify(edited))), true);
  assert.equal(hashSurvey(edited), hashSurvey(JSON.parse(JSON.stringify(edited))));
  assert.notEqual(hashSurvey(edited), hashSurvey(other));
});

test("resume: no phone copy, a clean one, or another record's: use the server's", () => {
  assert.deepEqual(decideResume(null, server(base)), { use: "server" });
  assert.deepEqual(decideResume(local({ dirty: false }), server(base)), { use: "server" });
  assert.deepEqual(decideResume(local({ recordId: "rec-2" }), server(base)), { use: "server" });
  assert.deepEqual(decideResume(local(), server(edited, "T9")), { use: "server" }, "already the same");
});

test("resume: unsaved changes on top of the server's current copy carry on", () => {
  assert.deepEqual(decideResume(local(), server(base, "T1")), { use: "phone", data: edited });
});

test("resume: the server moved on to a copy this phone sent itself: not a conflict", () => {
  const later: MeasuredSurvey = { ...edited, unknowns: ["Loft hatch size (DEMO)"] };
  const r = decideResume(local({ data: later, sent: [hashSurvey(edited)] }), server(edited, "T2"));
  assert.deepEqual(r, { use: "phone", data: later });
});

test("resume: both moved on independently: the person decides", () => {
  assert.deepEqual(decideResume(local({ sent: [hashSurvey(edited)] }), server(other, "T2")), { use: "conflict", phone: edited });
});

test("save retries back off, then settle at 20 s", () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(retryDelayMs), [2000, 5000, 10000, 20000, 20000]);
});

/* ------------------------------------------------------------------ */
/* Annotation editor geometry                                          */
/* ------------------------------------------------------------------ */

const box = { w: 400, h: 300 };
const unit: Annotation = { id: "u", type: "indoor-unit", x: 0.2, y: 0.2, w: 0.3, h: 0.1 };
const route: Annotation = { id: "r", type: "route", kind: "pipe", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };
const hole: Annotation = { id: "h", type: "core-hole", x: 0.5, y: 0.8 };

test("hit tests find the topmost shape within a finger's reach", () => {
  assert.equal(hitTest([unit, route, hole], { x: 0.3, y: 0.25 }, box)?.id, "u");
  assert.equal(hitTest([unit, route, hole], { x: 0.5, y: 0.51 }, box)?.id, "r", "near the line counts");
  assert.equal(hitTest([unit, route, hole], { x: 0.51, y: 0.81 }, box)?.id, "h");
  assert.equal(hitTest([unit, route, hole], { x: 0.95, y: 0.05 }, box), null);
  // Later shapes sit on top.
  const over: Annotation = { id: "u2", type: "outdoor-unit", x: 0.25, y: 0.2, w: 0.1, h: 0.1 };
  assert.equal(hitTest([unit, over], { x: 0.3, y: 0.25 }, box)?.id, "u2");
  assert.equal(hitHandle(unit, { x: 0.5, y: 0.3 }, box), 2, "the bottom-right corner");
  assert.equal(hitHandle(unit, { x: 0.35, y: 0.25 }, box), null);
});

test("moving keeps the whole shape on the photo; handles reshape", () => {
  const moved = moveShape(unit, 0.9, 0) as Extract<Annotation, { type: "indoor-unit" }>;
  assert.equal(moved.x + moved.w <= 1 + 1e-9, true);
  assert.equal(moved.w, unit.type === "indoor-unit" ? unit.w : 0, "never squashed");
  const r = moveShape(route, 0, -0.9) as Extract<Annotation, { type: "route" }>;
  assert.deepEqual(r.points.map((p) => p.y), [0, 0]);
  const resized = dragHandle(unit, 2, { x: 0.6, y: 0.5 }) as Extract<Annotation, { type: "indoor-unit" }>;
  assert.deepEqual([resized.x, resized.y], [0.2, 0.2], "the opposite corner stays put");
  assert.ok(Math.abs(resized.w - 0.4) < 1e-9 && Math.abs(resized.h - 0.3) < 1e-9);
  const flipped = dragHandle(unit, 2, { x: 0.1, y: 0.1 }) as Extract<Annotation, { type: "indoor-unit" }>;
  assert.ok(flipped.w > 0 && flipped.h > 0, "dragging past the corner flips, never negative");
  const vertex = dragHandle(route, 1, { x: 2, y: 0.4 }) as Extract<Annotation, { type: "route" }>;
  assert.deepEqual(vertex.points[1], { x: 1, y: 0.4 });
});

test("a tapped unit gets a sensible box centred on the tap, inside the photo", () => {
  const b = defaultBox("indoor-unit", { x: 0.99, y: 0.01 }, 4 / 3);
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9);
  assert.ok(b.w > b.h, "indoor units are long and thin");
  const o = defaultBox("outdoor-unit", { x: 0.5, y: 0.5 }, 4 / 3);
  assert.ok(Math.abs(o.x + o.w / 2 - 0.5) < 1e-9);
});

test("zoom and pan keep the photo on screen and the pinched point under the fingers", () => {
  const area = { w: 390, h: 600 };
  const base = fitBox(area, 4 / 3);
  assert.equal(base.w, 390);
  assert.ok(Math.abs(base.h - 292.5) < 1e-9);
  const centred = clampView({ scale: 1, ox: 50, oy: 0 }, base, area);
  assert.equal(centred.ox, 0);
  assert.ok(Math.abs(centred.oy - (600 - 292.5) / 2) < 1e-9);
  const zoomed = zoomAround(centred, 2, { x: 195, y: 300 }, base, area);
  assert.equal(zoomed.scale, 2);
  // The point under the focus stays under it.
  const before = { x: (195 - centred.ox) / centred.scale, y: (300 - centred.oy) / centred.scale };
  const after = { x: (195 - zoomed.ox) / zoomed.scale, y: (300 - zoomed.oy) / zoomed.scale };
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-6);
  assert.equal(zoomAround(centred, 100, { x: 0, y: 0 }, base, area).scale, 6, "capped");
  assert.equal(zoomAround(centred, 0.1, { x: 0, y: 0 }, base, area).scale, 1, "never smaller than fitted");
  const pinched = pinchView(centred, { x: 195, y: 300 }, 100, { x: 195, y: 300 }, 300, base, area);
  assert.equal(pinched.scale, 3);
  const panned = clampView({ scale: 3, ox: 10_000, oy: -10_000 }, base, area);
  assert.equal(panned.ox, 0, "can't drag the photo off its left edge");
  assert.equal(panned.oy, area.h - base.h * 3, "or past its bottom");
});

test("typed lengths become measurement labels", () => {
  assert.equal(lengthLabel("3.2"), "3.2 m");
  assert.equal(lengthLabel("3,2"), "3.2 m");
  assert.equal(lengthLabel("320 mm"), "320 mm");
  assert.equal(lengthLabel("  "), "");
});
