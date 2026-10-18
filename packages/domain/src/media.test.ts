import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOTATION_STYLE,
  MAX_ANNOTATION_LABEL,
  MAX_ANNOTATION_NOTE,
  MAX_ANNOTATION_SHAPES,
  MAX_ROUTE_POINTS,
  PHOTO_TAGS,
  PHOTO_TAG_LABEL,
  estimateLabel,
  validateAnnotations,
  type Annotation,
} from "./media.ts";

type Of<T extends Annotation["type"]> = Extract<Annotation, { type: T }>;

test("every tag has a label and every tool a style", () => {
  for (const tag of PHOTO_TAGS) assert.ok(PHOTO_TAG_LABEL[tag], tag);
  for (const key of ["indoor-unit", "outdoor-unit", "core-hole", "pipe", "condensate", "cable", "obstacle", "measure", "note"]) {
    assert.match(ANNOTATION_STYLE[key]!.colour, /^#[0-9a-f]{6}$/i, key);
  }
});

test("validateAnnotations keeps every well-formed shape as it is", () => {
  const input: Annotation[] = [
    { id: "u1", type: "indoor-unit", x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: "3.5 kW" },
    { id: "u2", type: "outdoor-unit", x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    { id: "h1", type: "core-hole", x: 0.4, y: 0.25 },
    { id: "p1", type: "route", kind: "pipe", points: [{ x: 0.4, y: 0.25 }, { x: 0.4, y: 0.9 }], label: "4 m" },
    { id: "c1", type: "route", kind: "condensate", points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }] },
    { id: "e1", type: "route", kind: "cable", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    { id: "o1", type: "obstacle", x: 0.7, y: 0.6, label: "Downpipe" },
    { id: "m1", type: "measure", from: { x: 0.1, y: 0.8 }, to: { x: 0.6, y: 0.8 }, label: "≈ 3.2 m" },
    { id: "n1", type: "note", x: 0.9, y: 0.1, text: "Customer wants it higher" },
  ];
  assert.deepEqual(validateAnnotations(input), input);
});

test("validateAnnotations clamps to the photo and keeps boxes inside it", () => {
  const out = validateAnnotations([
    { id: "a", type: "core-hole", x: -0.5, y: 1.7 },
    { id: "b", type: "indoor-unit", x: 0.8, y: 0.9, w: 0.5, h: 0.5 },
    { id: "c", type: "route", kind: "pipe", points: [{ x: -1, y: 0.5 }, { x: 2, y: 0.5 }] },
    { id: "d", type: "measure", from: { x: 0.5, y: -3 }, to: { x: 0.5, y: 4 }, label: "2 m" },
  ]);
  assert.deepEqual(out[0], { id: "a", type: "core-hole", x: 0, y: 1 });
  const box = out[1] as Of<"indoor-unit">;
  assert.equal(box.x, 0.8);
  assert.ok(Math.abs(box.w - 0.2) < 1e-9 && Math.abs(box.h - 0.1) < 1e-9, "cut to the photo's edge");
  assert.deepEqual((out[2] as Of<"route">).points, [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
  assert.deepEqual((out[3] as Of<"measure">).from, { x: 0.5, y: 0 });
});

test("validateAnnotations normalises boxes dragged up or left, and drops slips", () => {
  const [box] = validateAnnotations([{ id: "a", type: "outdoor-unit", x: 0.6, y: 0.7, w: -0.2, h: -0.3 }]);
  const b = box as Of<"outdoor-unit">;
  assert.ok(Math.abs(b.x - 0.4) < 1e-9 && Math.abs(b.y - 0.4) < 1e-9);
  assert.ok(Math.abs(b.w - 0.2) < 1e-9 && Math.abs(b.h - 0.3) < 1e-9);
  assert.deepEqual(validateAnnotations([{ id: "z", type: "indoor-unit", x: 0.5, y: 0.5, w: 0.001, h: 0.2 }]), []);
  assert.deepEqual(validateAnnotations([{ id: "z", type: "indoor-unit", x: 1, y: 0.5, w: 0.2, h: 0.2 }]), [], "off the right edge");
});

test("validateAnnotations drops junk: unknown shapes, bad numbers, short routes, empty notes, unlabelled measures", () => {
  const out = validateAnnotations([
    null,
    "string",
    42,
    [1, 2],
    { type: "spaceship", x: 0.5, y: 0.5 },
    { type: "core-hole", x: "0.5", y: 0.5 },
    { type: "core-hole", x: Number.NaN, y: 0.5 },
    { type: "core-hole", x: Infinity, y: 0.5 },
    { type: "indoor-unit", x: 0.1, y: 0.1, w: 0.2 },
    { type: "route", kind: "water", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    { type: "route", kind: "pipe", points: [{ x: 0, y: 0 }] },
    { type: "route", kind: "pipe", points: [{ x: 0, y: 0 }, { x: "1", y: 1 }] },
    { type: "route", kind: "pipe", points: "nope" },
    { type: "note", x: 0.5, y: 0.5, text: "   " },
    { type: "measure", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
    { type: "measure", from: { x: 0, y: 0 }, label: "3 m" },
    { type: "obstacle", x: 0.2, y: 0.3 },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: "a17", type: "obstacle", x: 0.2, y: 0.3, label: "Obstacle" });
  assert.deepEqual(validateAnnotations("nope"), []);
  assert.deepEqual(validateAnnotations({ length: 3 }), []);
  assert.deepEqual(validateAnnotations(undefined), []);
});

test("validateAnnotations strips extra keys rather than storing them", () => {
  const [a] = validateAnnotations([{ id: "a", type: "core-hole", x: 0.5, y: 0.5, onclick: "alert(1)", style: "x" }]);
  assert.deepEqual(Object.keys(a!).sort(), ["id", "type", "x", "y"]);
});

test("validateAnnotations trims and limits text, and strips control characters", () => {
  const long = "x".repeat(500);
  const out = validateAnnotations([
    { id: "a", type: "indoor-unit", x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: `  ${long}  ` },
    { id: "b", type: "note", x: 0.1, y: 0.1, text: long },
    { id: "c", type: "obstacle", x: 0.1, y: 0.1, label: "Gas\u0000 meter\n\tbox" },
    { id: "d", type: "core-hole", x: 0.1, y: 0.1, label: "   " },
    { id: "e", type: "route", kind: "pipe", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], label: 42 },
  ]);
  assert.equal((out[0] as Of<"indoor-unit">).label!.length, MAX_ANNOTATION_LABEL);
  assert.equal((out[1] as Of<"note">).text.length, MAX_ANNOTATION_NOTE);
  assert.equal((out[2] as Of<"obstacle">).label, "Gas meter box");
  assert.equal("label" in out[3]!, false, "a blank label is left off");
  assert.equal("label" in out[4]!, false, "a non-string label is left off");
});

test("validateAnnotations never cuts an emoji in half", () => {
  const label = `${"a".repeat(MAX_ANNOTATION_LABEL - 1)}🙂🙂`;
  const [a] = validateAnnotations([{ id: "a", type: "core-hole", x: 0.1, y: 0.1, label }]);
  const kept = (a as Of<"core-hole">).label!;
  assert.equal(Array.from(kept).length, MAX_ANNOTATION_LABEL);
  assert.ok(kept.endsWith("🙂"));
});

test("validateAnnotations makes ids safe and unique", () => {
  const out = validateAnnotations([
    { id: "same", type: "core-hole", x: 0.1, y: 0.1 },
    { id: "same", type: "core-hole", x: 0.2, y: 0.2 },
    { id: "same", type: "core-hole", x: 0.3, y: 0.3 },
    { id: "<script>", type: "core-hole", x: 0.4, y: 0.4 },
    { type: "core-hole", x: 0.5, y: 0.5 },
    { id: "x".repeat(100), type: "core-hole", x: 0.6, y: 0.6 },
  ]);
  const ids = out.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 5), ["same", "same-2", "same-3", "a4", "a5"]);
  assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(ids[5]!));
});

test("validateAnnotations caps shapes and route points", () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `h${i}`, type: "core-hole", x: 0.5, y: 0.5 }));
  assert.equal(validateAnnotations(many).length, MAX_ANNOTATION_SHAPES);
  // Junk at the front doesn't push real shapes out of the window it reads.
  const junkFirst = [...Array.from({ length: 50 }, () => ({ type: "junk" })), ...many];
  assert.equal(validateAnnotations(junkFirst).length, MAX_ANNOTATION_SHAPES);
  const points = Array.from({ length: 200 }, (_, i) => ({ x: i / 200, y: 0.5 }));
  const [route] = validateAnnotations([{ id: "r", type: "route", kind: "pipe", points }]);
  assert.equal((route as Of<"route">).points.length, MAX_ROUTE_POINTS);
});

test("validateAnnotations is idempotent", () => {
  const messy = [
    { id: "b", type: "indoor-unit", x: 0.9, y: 0.9, w: -0.4, h: 0.5, label: "  big  " },
    { type: "note", x: 2, y: -1, text: " hi " },
    { id: "b", type: "measure", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, label: "3 m" },
  ];
  const once = validateAnnotations(messy);
  assert.deepEqual(validateAnnotations(once), once);
});

test("estimateLabel marks measurements as the surveyor's estimate", () => {
  assert.equal(estimateLabel("3.2 m"), "≈ 3.2 m");
  assert.equal(estimateLabel("  3.2 m "), "≈ 3.2 m");
  assert.equal(estimateLabel("≈ 3.2 m"), "≈ 3.2 m");
  assert.equal(estimateLabel("~3 m"), "~3 m");
  assert.equal(estimateLabel("approx 3 m"), "approx 3 m");
  assert.equal(estimateLabel("   "), "");
  assert.ok(estimateLabel("x".repeat(200)).length <= MAX_ANNOTATION_LABEL);
});
