import type { Annotation, Point } from "@aircon/domain";

/**
 * Pure geometry for the annotation editor (annotator.tsx): hit tests, moves
 * and resizes in normalised 0..1 coordinates, and the zoom/pan maths. Kept
 * apart from the component so it's testable without a browser.
 *
 * Distances that a finger cares about (how close counts as "on" a line)
 * are in screen pixels, so callers pass the photo box's current size.
 */

export interface Box {
  /** The photo's drawn size in px at the current zoom. */
  w: number;
  h: number;
}

export type Handle = { id: string; index: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const toPx = (p: Point, box: Box) => ({ x: p.x * box.w, y: p.y * box.h });

function distToSegmentPx(p: Point, a: Point, b: Point, box: Box): number {
  const P = toPx(p, box);
  const A = toPx(a, box);
  const B = toPx(b, box);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

const distPx = (a: Point, b: Point, box: Box) => Math.hypot((a.x - b.x) * box.w, (a.y - b.y) * box.h);

/** The points a shape can be dragged by (corners, route vertices, measure ends, pins). */
export function handlesOf(a: Annotation): Point[] {
  switch (a.type) {
    case "indoor-unit":
    case "outdoor-unit":
      return [
        { x: a.x, y: a.y },
        { x: a.x + a.w, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
        { x: a.x, y: a.y + a.h },
      ];
    case "route":
      return a.points;
    case "measure":
      return [a.from, a.to];
    default:
      return [];
  }
}

/** Is `p` on this shape? `slop` is how far off counts, in px. */
export function hitShape(a: Annotation, p: Point, box: Box, slop = 14): boolean {
  switch (a.type) {
    case "indoor-unit":
    case "outdoor-unit": {
      const sx = slop / Math.max(1, box.w);
      const sy = slop / Math.max(1, box.h);
      return p.x >= a.x - sx && p.x <= a.x + a.w + sx && p.y >= a.y - sy && p.y <= a.y + a.h + sy;
    }
    case "core-hole":
    case "obstacle":
    case "note":
      return distPx(p, { x: a.x, y: a.y }, box) <= slop + 10;
    case "route":
      return a.points.some((pt, i) => i > 0 && distToSegmentPx(p, a.points[i - 1]!, pt, box) <= slop);
    case "measure":
      return distToSegmentPx(p, a.from, a.to, box) <= slop;
  }
}

/** The topmost shape under `p` (later shapes sit on top), or null. */
export function hitTest(list: Annotation[], p: Point, box: Box, slop = 14): Annotation | null {
  for (let i = list.length - 1; i >= 0; i--) if (hitShape(list[i]!, p, box, slop)) return list[i]!;
  return null;
}

/** A handle of `a` under `p`, if any (handles are bigger targets than lines). */
export function hitHandle(a: Annotation, p: Point, box: Box, slop = 22): number | null {
  const hs = handlesOf(a);
  let best: number | null = null;
  let bestD = Infinity;
  hs.forEach((h, i) => {
    const d = distPx(p, h, box);
    if (d <= slop && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** `a` moved by (dx, dy), kept on the photo as a whole (it slides along the edge, never squashes). */
export function moveShape(a: Annotation, dx: number, dy: number): Annotation {
  const bounds = (pts: Point[]) => ({
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  });
  const limit = (pts: Point[]) => {
    const b = bounds(pts);
    return { dx: Math.min(Math.max(dx, -b.minX), 1 - b.maxX), dy: Math.min(Math.max(dy, -b.minY), 1 - b.maxY) };
  };
  const shift = (p: Point, d: { dx: number; dy: number }) => ({ x: clamp01(p.x + d.dx), y: clamp01(p.y + d.dy) });
  switch (a.type) {
    case "indoor-unit":
    case "outdoor-unit": {
      const d = limit([
        { x: a.x, y: a.y },
        { x: a.x + a.w, y: a.y + a.h },
      ]);
      return { ...a, x: clamp01(a.x + d.dx), y: clamp01(a.y + d.dy) };
    }
    case "route": {
      const d = limit(a.points);
      return { ...a, points: a.points.map((p) => shift(p, d)) };
    }
    case "measure": {
      const d = limit([a.from, a.to]);
      return { ...a, from: shift(a.from, d), to: shift(a.to, d) };
    }
    default:
      return { ...a, x: clamp01(a.x + dx), y: clamp01(a.y + dy) };
  }
}

/** Drag handle `index` of `a` to `p` (a box corner resizes, keeping the opposite corner fixed). */
export function dragHandle(a: Annotation, index: number, p: Point): Annotation {
  const q = { x: clamp01(p.x), y: clamp01(p.y) };
  switch (a.type) {
    case "indoor-unit":
    case "outdoor-unit": {
      const corners = handlesOf(a);
      const opposite = corners[(index + 2) % 4]!;
      return rectFrom(a, opposite, q);
    }
    case "route":
      return { ...a, points: a.points.map((pt, i) => (i === index ? q : pt)) };
    case "measure":
      return index === 0 ? { ...a, from: q } : { ...a, to: q };
    default:
      return a;
  }
}

/** A unit box spanning two corners, in either order. */
export function rectFrom<T extends Extract<Annotation, { type: "indoor-unit" | "outdoor-unit" }>>(a: T, p1: Point, p2: Point): T {
  const x = clamp01(Math.min(p1.x, p2.x));
  const y = clamp01(Math.min(p1.y, p2.y));
  return { ...a, x, y, w: clamp01(Math.max(p1.x, p2.x)) - x, h: clamp01(Math.max(p1.y, p2.y)) - y };
}

/**
 * A unit box of a sensible size centred on a tap, for people who tap rather
 * than drag. Sizes are a share of the photo's width, made the right shape
 * on screen whatever the photo's aspect.
 */
export function defaultBox(
  type: "indoor-unit" | "outdoor-unit",
  at: Point,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  // Indoor units are long and thin (~0.8 × 0.3 m); outdoor units squarer (~0.8 × 0.55 m).
  const w = type === "indoor-unit" ? 0.3 : 0.24;
  const h = Math.min(0.9, (type === "indoor-unit" ? w * 0.34 : w * 0.7) * aspect);
  const x = Math.min(Math.max(at.x - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(at.y - h / 2, 0), 1 - h);
  return { x, y, w, h };
}

/* ------------------------------------------------------------------ */
/* Zoom and pan                                                        */
/* ------------------------------------------------------------------ */

export interface View {
  scale: number;
  /** The photo box's top-left corner within the editing area, px. */
  ox: number;
  oy: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;

/** The photo fitted inside the area (contain), at scale 1. */
export function fitBox(area: { w: number; h: number }, aspect: number): Box {
  const safe = aspect > 0 && Number.isFinite(aspect) ? aspect : 4 / 3;
  const w = Math.max(1, Math.min(area.w, area.h * safe));
  return { w, h: w / safe };
}

/** Keep the photo on screen: centred when it's smaller than the area, never pulled past its edges when bigger. */
export function clampView(v: View, base: Box, area: { w: number; h: number }): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
  const w = base.w * scale;
  const h = base.h * scale;
  const ox = w <= area.w ? (area.w - w) / 2 : Math.min(0, Math.max(area.w - w, v.ox));
  const oy = h <= area.h ? (area.h - h) / 2 : Math.min(0, Math.max(area.h - h, v.oy));
  return { scale, ox, oy };
}

/** Zoom to `scale` keeping the photo point under `focus` (area px) where it is. */
export function zoomAround(v: View, scale: number, focus: { x: number; y: number }, base: Box, area: { w: number; h: number }): View {
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const ux = (focus.x - v.ox) / v.scale;
  const uy = (focus.y - v.oy) / v.scale;
  return clampView({ scale: next, ox: focus.x - ux * next, oy: focus.y - uy * next }, base, area);
}

/**
 * Two-finger gesture: the photo point that was under the fingers' midpoint
 * at the start stays under the midpoint now, scaled by how far apart the
 * fingers have moved.
 */
export function pinchView(
  start: View,
  startMid: { x: number; y: number },
  startDist: number,
  mid: { x: number; y: number },
  dist: number,
  base: Box,
  area: { w: number; h: number },
): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * (startDist > 0 ? dist / startDist : 1)));
  const ux = (startMid.x - start.ox) / start.scale;
  const uy = (startMid.y - start.oy) / start.scale;
  return clampView({ scale, ox: mid.x - ux * scale, oy: mid.y - uy * scale }, base, area);
}

/** A typed length as a measurement label: "3.2" → "3.2 m"; anything with its own unit stays as typed. */
export function lengthLabel(input: string): string {
  const t = input.trim().replace(",", ".");
  if (!t) return "";
  return /^\d+(\.\d+)?$/.test(t) ? `${t} m` : t;
}
