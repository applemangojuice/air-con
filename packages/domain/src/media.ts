/**
 * Media: every photo, signature and document on a project, tagged.
 *
 * Files live in the private `project-media` bucket; this is the metadata
 * row. Annotations are an SVG overlay in normalised coordinates (0..1 of the
 * image box), so a drawing renders at any size and survives a re-crop of
 * the viewport. Approved layouts lock their annotations; a change after
 * that is a new version, never an edit in place.
 *
 * Foundation ships the types, tag labels and drawing styles; F2 owns the
 * validation logic.
 */

export const PHOTO_TAGS = [
  "room-overview",
  "indoor-wall",
  "external-wall",
  "outdoor-location",
  "pipe-route",
  "electrical-supply",
  "fuse-board",
  "drainage",
  "access",
  "obstruction",
  "existing-condition",
  "progress",
  "completed",
  "kit",
  "serial",
  "gauge",
  "signature",
  "document",
  "other",
] as const;

export type PhotoTag = (typeof PHOTO_TAGS)[number];

export const PHOTO_TAG_LABEL: Record<PhotoTag, string> = {
  "room-overview": "Room overview",
  "indoor-wall": "Indoor unit wall",
  "external-wall": "Outside wall",
  "outdoor-location": "Outdoor unit spot",
  "pipe-route": "Pipe route",
  "electrical-supply": "Electrical supply",
  "fuse-board": "Fuse board",
  drainage: "Drainage",
  access: "Access",
  obstruction: "Obstruction",
  "existing-condition": "As found",
  progress: "Work in progress",
  completed: "Finished",
  kit: "Kit",
  serial: "Serial number",
  gauge: "Gauge reading",
  signature: "Signature",
  document: "Document",
  other: "Other",
};

export interface Point {
  x: number;
  y: number;
} // normalised 0..1 of the image box

export type Annotation =
  | { id: string; type: "indoor-unit" | "outdoor-unit"; x: number; y: number; w: number; h: number; label?: string }
  | { id: string; type: "core-hole"; x: number; y: number; label?: string }
  | { id: string; type: "route"; kind: "pipe" | "condensate" | "cable"; points: Point[]; label?: string }
  | { id: string; type: "obstacle"; x: number; y: number; label: string }
  | { id: string; type: "measure"; from: Point; to: Point; label: string }
  | { id: string; type: "note"; x: number; y: number; text: string };

/**
 * One look per tool, shared by the editor, the proposal and printed
 * documents. Colours are picked to read on real photos (bright, distinct),
 * not from the page palette. Routes key on their kind.
 */
export const ANNOTATION_STYLE: Record<string, { label: string; colour: string }> = {
  "indoor-unit": { label: "Indoor unit", colour: "#f2711b" },
  "outdoor-unit": { label: "Outdoor unit", colour: "#e11d48" },
  "core-hole": { label: "Core hole", colour: "#facc15" },
  pipe: { label: "Pipe route", colour: "#2563eb" },
  condensate: { label: "Condensate", colour: "#06b6d4" },
  cable: { label: "Cable", colour: "#16a34a" },
  obstacle: { label: "Obstacle", colour: "#dc2626" },
  measure: { label: "Measurement", colour: "#ffffff" },
  note: { label: "Note", colour: "#47698a" },
};

export interface MediaItem {
  id: string;
  projectId: string;
  bucket: string;
  storagePath: string;
  contentType: string;
  tag: PhotoTag;
  roomId?: string;
  caption?: string;
  source: "customer" | "survey" | "install" | "handover" | "ops";
  takenBy?: { kind: "staff" | "customer"; id?: string; name?: string };
  takenAt: string;
  customerVisible: boolean;
  width?: number;
  height?: number;
  annotations: Annotation[];
  annotationsVersion: number;
  locked: boolean;
}

/* ------------------------------------------------------------------ */
/* Validation (F2)                                                     */
/* ------------------------------------------------------------------ */

/** At most this many shapes on one photo; more is junk or abuse. */
export const MAX_ANNOTATION_SHAPES = 200;
/** Points on one route line. */
export const MAX_ROUTE_POINTS = 64;
export const MAX_ANNOTATION_LABEL = 80;
export const MAX_ANNOTATION_NOTE = 280;
/** Boxes smaller than this (as a share of the photo) are a slip of the finger, not a unit. */
const MIN_BOX = 0.005;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Control characters out, whitespace collapsed, trimmed, cut to `max` characters (never mid-surrogate). */
const cleanText = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const flat = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, max).join("").trim();
};
const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function pointOf(v: unknown): Point | null {
  const r = record(v);
  const x = finite(r?.x);
  const y = finite(r?.y);
  return x === null || y === null ? null : { x: clamp01(x), y: clamp01(y) };
}

/**
 * Validate a drawing from the browser (zod-free, so the domain stays
 * dependency-free). Never throws: anything that isn't a known shape with
 * usable coordinates is dropped, coordinates are clamped to the photo
 * (0..1), boxes are kept inside it, labels are trimmed and cut short,
 * ids are made safe and unique, and at most 200 shapes survive. A
 * measurement keeps its label (it's the point of the shape), so one
 * without a label is dropped.
 */
export function validateAnnotations(input: unknown): Annotation[] {
  if (!Array.isArray(input)) return [];
  const out: Annotation[] = [];
  const ids = new Set<string>();
  const idFor = (raw: unknown, i: number) => {
    let id = typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : `a${i + 1}`;
    const stem = id.slice(0, 56);
    for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;
    ids.add(id);
    return id;
  };
  // Look a little past the cap, so a few junk entries don't push real shapes out.
  for (const [i, raw] of input.slice(0, MAX_ANNOTATION_SHAPES * 2).entries()) {
    if (out.length >= MAX_ANNOTATION_SHAPES) break;
    const a = record(raw);
    if (!a) continue;
    const label = cleanText(a.label, MAX_ANNOTATION_LABEL);
    const withLabel = label ? { label } : {};
    switch (a.type) {
      case "indoor-unit":
      case "outdoor-unit": {
        const x = finite(a.x);
        const y = finite(a.y);
        const w = finite(a.w);
        const h = finite(a.h);
        if (x === null || y === null || w === null || h === null) continue;
        // A box dragged up or left arrives with a negative size: normalise it,
        // then cut it to the photo (an in-bounds box comes back untouched).
        const fit = (start: number, size: number) => {
          const s = size < 0 ? start + size : start;
          const len = Math.abs(size);
          const c = clamp01(s);
          return { at: c, len: Math.max(0, Math.min(len - (c - s), 1 - c)) };
        };
        const bx = fit(x, w);
        const by = fit(y, h);
        if (bx.len < MIN_BOX || by.len < MIN_BOX) continue;
        out.push({ id: idFor(a.id, i), type: a.type, x: bx.at, y: by.at, w: bx.len, h: by.len, ...withLabel });
        break;
      }
      case "core-hole": {
        const p = pointOf(a);
        if (p) out.push({ id: idFor(a.id, i), type: "core-hole", ...p, ...withLabel });
        break;
      }
      case "route": {
        if (a.kind !== "pipe" && a.kind !== "condensate" && a.kind !== "cable") continue;
        const points = (Array.isArray(a.points) ? a.points : [])
          .slice(0, MAX_ROUTE_POINTS)
          .map(pointOf)
          .filter((p): p is Point => p !== null);
        if (points.length < 2) continue;
        out.push({ id: idFor(a.id, i), type: "route", kind: a.kind, points, ...withLabel });
        break;
      }
      case "obstacle": {
        const p = pointOf(a);
        if (p) out.push({ id: idFor(a.id, i), type: "obstacle", ...p, label: label || "Obstacle" });
        break;
      }
      case "measure": {
        const from = pointOf(a.from);
        const to = pointOf(a.to);
        if (from && to && label) out.push({ id: idFor(a.id, i), type: "measure", from, to, label });
        break;
      }
      case "note": {
        const p = pointOf(a);
        const text = cleanText(a.text, MAX_ANNOTATION_NOTE);
        if (p && text) out.push({ id: idFor(a.id, i), type: "note", ...p, text });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * A measurement as it's saved: always marked as the surveyor's estimate
 * ("≈ 3.2 m"), so no drawing ever reads as a verified dimension. A label
 * that already says it's approximate is left alone.
 */
export function estimateLabel(label: string): string {
  const t = cleanText(label, MAX_ANNOTATION_LABEL - 2);
  if (!t) return "";
  return /^(≈|~|approx|about|est)/i.test(t) ? t : `≈ ${t}`;
}
