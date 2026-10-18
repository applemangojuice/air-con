import { PHOTO_TAG_LABEL, type Annotation, type PhotoTag } from "@aircon/domain";

/**
 * Placeholder "photos" for the DEMO pilots: SVG drawings in a neutral
 * palette, plainly labelled "DEMO PHOTO · <room> · <tag>", with a wall,
 * window or loft outline so the annotated viewer has something real to sit
 * on. Each scene also returns the drawing a surveyor would have made on
 * that photo, placed on the drawn features (the unit above the window's
 * side, the pipe down the brickwork, the route between the loft joists).
 *
 * Pure strings: no images are fetched, nothing real is pictured.
 */

export const DEMO_PHOTO_WIDTH = 1200;
export const DEMO_PHOTO_HEIGHT = 900;

export type DemoScene = "indoor-wall" | "room-overview" | "outdoor" | "loft" | "fuse-board" | "progress" | "completed" | "kit";

export interface DemoPhotoSpec {
  scene: DemoScene;
  room: string;
  tag: PhotoTag;
  /** Small layout variations, so photos of different rooms don't look identical. */
  variant?: number;
  /** For drawings: the unit's label ("Indoor unit · 3.5 kW"), the pipe length, the note. */
  unitLabel?: string;
  routeLabel?: string;
  /** Leave the drawing off (e.g. an "as found" photo). */
  plain?: boolean;
}

export interface DemoPhoto {
  svg: string;
  annotations: Annotation[];
  width: number;
  height: number;
  /** "DEMO PHOTO · Living room · Indoor unit wall". */
  title: string;
}

const W = DEMO_PHOTO_WIDTH;
const H = DEMO_PHOTO_HEIGHT;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Normalised → pixel, rounded, for the drawing. */
const X = (n: number) => Math.round(n * W);
const Y = (n: number) => Math.round(n * H);
const rect = (x: number, y: number, w: number, h: number, attrs: string) =>
  `<rect x="${X(x)}" y="${Y(y)}" width="${X(w)}" height="${Y(h)}" ${attrs}/>`;
const line = (x1: number, y1: number, x2: number, y2: number, attrs: string) =>
  `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}" ${attrs}/>`;

const INK = `stroke="#5b5f68" stroke-width="4" fill="none"`;
const THIN = `stroke="#7d818a" stroke-width="2" fill="none"`;

function room(v: number): string {
  // Ceiling band, cornice, wall, skirting, floor; a window on the left.
  const wx = 0.08 + 0.03 * (v % 3);
  return [
    rect(0, 0, 1, 0.1, `fill="#ebe7df"`),
    line(0, 0.1, 1, 0.1, INK),
    rect(0, 0.88, 1, 0.12, `fill="#a99f8e"`),
    line(0, 0.88, 1, 0.88, INK),
    rect(wx, 0.22, 0.28, 0.44, `fill="#dfe8ee" ${INK}`),
    line(wx + 0.14, 0.22, wx + 0.14, 0.66, THIN),
    line(wx, 0.44, wx + 0.28, 0.44, THIN),
    rect(wx - 0.02, 0.66, 0.32, 0.025, `fill="#d8d2c6" ${THIN}`),
    rect(wx + 0.02, 0.71, 0.24, 0.12, `fill="#e4dfd6" ${THIN}`),
    rect(0.8, 0.78, 0.04, 0.035, `fill="#f4f1ea" ${THIN}`),
  ].join("");
}

function outdoor(v: number): string {
  const courses: string[] = [];
  for (let y = 0.035; y < 0.82; y += 0.035) courses.push(line(0, y, 1, y, `stroke="#9a7f6c" stroke-width="2"`));
  const wx = 0.1 + 0.03 * (v % 3);
  return [
    rect(0, 0, 1, 0.82, `fill="#b98f75"`),
    ...courses,
    rect(wx, 0.12, 0.26, 0.38, `fill="#dfe8ee" ${INK}`),
    line(wx + 0.13, 0.12, wx + 0.13, 0.5, THIN),
    rect(wx - 0.015, 0.5, 0.29, 0.025, `fill="#e6e0d4" ${THIN}`),
    rect(0.885, 0, 0.03, 0.84, `fill="#4f535c"`),
    rect(0, 0.82, 1, 0.18, `fill="#a7a49c"`),
    line(0, 0.82, 1, 0.82, INK),
    line(0.33, 0.82, 0.25, 1, THIN),
    line(0.66, 0.82, 0.72, 1, THIN),
    rect(0.87, 0.85, 0.06, 0.04, `fill="#3d4047"`),
  ].join("");
}

function loft(): string {
  const joists: string[] = [];
  for (let i = 0; i < 7; i++) {
    const y = 0.52 + i * 0.07;
    joists.push(line(0, y, 1, y + 0.02, `stroke="#8b6f4e" stroke-width="10"`));
  }
  return [
    rect(0, 0, 1, 1, `fill="#cdbfa8"`),
    `<polygon points="0,${Y(0.5)} ${X(0.5)},0 ${X(1)},${Y(0.5)}" fill="#b8a588" stroke="#5b5f68" stroke-width="4"/>`,
    line(0.18, 0.32, 0.5, 0, `stroke="#8b6f4e" stroke-width="12"`),
    line(0.82, 0.32, 0.5, 0, `stroke="#8b6f4e" stroke-width="12"`),
    ...joists,
    rect(0.12, 0.45, 0.22, 0.25, `fill="#7e8d99" ${INK}`),
    rect(0.6, 0.76, 0.16, 0.12, `fill="#efe9dd" ${INK}`),
  ].join("");
}

function fuseBoard(): string {
  const ways: string[] = [];
  for (let i = 0; i < 10; i++) ways.push(rect(0.25 + i * 0.05, 0.34, 0.035, 0.12, `fill="${i >= 8 ? "#d9d4c8" : "#2f333b"}" ${THIN}`));
  return [
    rect(0, 0, 1, 1, `fill="#ddd6c9"`),
    rect(0.2, 0.25, 0.6, 0.3, `fill="#f6f4ef" ${INK}`),
    ...ways,
    rect(0.2, 0.25, 0.6, 0.06, `fill="#e3dfd6" ${THIN}`),
    line(0.5, 0.55, 0.5, 0.9, `stroke="#c9c2b4" stroke-width="18"`),
  ].join("");
}

function indoorUnitDrawing(x: number, y: number): string {
  return [
    `<rect x="${X(x)}" y="${Y(y)}" width="${X(0.3)}" height="${Y(0.1)}" rx="18" fill="#fbfbf9" stroke="#5b5f68" stroke-width="4"/>`,
    line(x + 0.02, y + 0.075, x + 0.28, y + 0.075, THIN),
  ].join("");
}

function label(title: string): string {
  return [
    `<text x="${X(0.5)}" y="${Y(0.52)}" text-anchor="middle" font-size="200" font-weight="800" fill="#ffffff" fill-opacity="0.18" transform="rotate(-18 ${X(0.5)} ${Y(0.5)})" font-family="system-ui, sans-serif">DEMO</text>`,
    `<rect x="${X(0.03)}" y="${Y(0.905)}" width="${Math.min(W - X(0.06), 22 + title.length * 15)}" height="${Y(0.065)}" rx="${Y(0.0325)}" fill="#14171e" fill-opacity="0.82"/>`,
    `<text x="${X(0.03) + 18}" y="${Y(0.948)}" font-size="26" font-weight="700" fill="#ffffff" font-family="system-ui, sans-serif">${esc(title)}</text>`,
  ].join("");
}

/** The drawing for each scene, on the features above. */
function annotationsFor(spec: DemoPhotoSpec, v: number): Annotation[] {
  if (spec.plain) return [];
  switch (spec.scene) {
    case "indoor-wall":
      return [
        { id: "unit", type: "indoor-unit", x: 0.48, y: 0.13, w: 0.3, h: 0.1, label: spec.unitLabel ?? "Indoor unit" },
        { id: "hole", type: "core-hole", x: 0.84, y: 0.18 },
        { id: "pipe", type: "route", kind: "pipe", points: [{ x: 0.78, y: 0.18 }, { x: 0.84, y: 0.18 }], label: spec.routeLabel ?? "Pipe out, 0.5 m" },
        { id: "drain", type: "route", kind: "condensate", points: [{ x: 0.78, y: 0.215 }, { x: 0.83, y: 0.215 }, { x: 0.84, y: 0.19 }] },
        { id: "width", type: "measure", from: { x: 0.48, y: 0.27 }, to: { x: 0.78, y: 0.27 }, label: "890 mm" },
        { id: "cable", type: "obstacle", x: 0.86 - 0.01 * (v % 2), y: 0.52, label: "Cable run: scan first" },
      ];
    case "outdoor":
      return [
        { id: "unit", type: "outdoor-unit", x: 0.5, y: 0.6, w: 0.27, h: 0.22, label: spec.unitLabel ?? "Outdoor unit" },
        { id: "hole", type: "core-hole", x: 0.58, y: 0.06 },
        {
          id: "pipe",
          type: "route",
          kind: "pipe",
          points: [
            { x: 0.58, y: 0.06 },
            { x: 0.58, y: 0.52 },
            { x: 0.62, y: 0.6 },
          ],
          label: spec.routeLabel ?? "Pipe route 4.2 m",
        },
        { id: "drain", type: "route", kind: "condensate", points: [{ x: 0.76, y: 0.82 }, { x: 0.87, y: 0.86 }] },
        { id: "gap", type: "measure", from: { x: 0.77, y: 0.7 }, to: { x: 0.98, y: 0.7 }, label: "2.1 m to boundary" },
        { id: "downpipe", type: "obstacle", x: 0.9, y: 0.4, label: "Downpipe" },
      ];
    case "loft":
      return [
        {
          id: "pipe",
          type: "route",
          kind: "pipe",
          points: [
            { x: 0.97, y: 0.62 },
            { x: 0.7, y: 0.62 },
            { x: 0.45, y: 0.58 },
            { x: 0.4, y: 0.3 },
          ],
          label: spec.routeLabel ?? "Pipe route via loft, 9 m",
        },
        { id: "cable", type: "route", kind: "cable", points: [{ x: 0.66, y: 0.76 }, { x: 0.66, y: 0.66 }, { x: 0.97, y: 0.66 }] },
        { id: "tank", type: "obstacle", x: 0.23, y: 0.57, label: "Cold water tank" },
        { id: "span", type: "measure", from: { x: 0.4, y: 0.92 }, to: { x: 0.97, y: 0.92 }, label: "3.1 m across the loft" },
        {
          id: "note",
          type: "note",
          x: 0.55,
          y: 0.4,
          text: "Joists run front to back: keep the route between joists 3 and 4, no notching. Tech lead to confirm.",
        },
      ];
    case "fuse-board":
      return [{ id: "ways", type: "note", x: 0.72, y: 0.2, text: "Two spare ways, RCBO board, TN-C-S earthing." }];
    case "completed":
      return [{ id: "unit", type: "indoor-unit", x: 0.48, y: 0.13, w: 0.3, h: 0.1, label: spec.unitLabel ?? "Indoor unit, installed" }];
    default:
      return [];
  }
}

/** One DEMO photo: the SVG and the drawing that goes on it. */
export function demoPhoto(spec: DemoPhotoSpec): DemoPhoto {
  const v = spec.variant ?? 0;
  const title = `DEMO PHOTO · ${spec.room} · ${PHOTO_TAG_LABEL[spec.tag] ?? spec.tag}`;
  let scene: string;
  let bg = ["#e2ddd3", "#cfc8ba"];
  switch (spec.scene) {
    case "outdoor":
      scene = outdoor(v);
      bg = ["#d3dbe0", "#b9c3ca"];
      break;
    case "loft":
      scene = loft();
      break;
    case "fuse-board":
      scene = fuseBoard();
      break;
    case "progress":
      scene = `${room(v)}${rect(0.5, 0.15, 0.26, 0.05, `fill="#9aa0a8" ${THIN}`)}${line(0.78, 0.18, 0.84, 0.18, `stroke="#2563eb" stroke-width="8"`)}`;
      break;
    case "completed":
      scene = `${room(v)}${indoorUnitDrawing(0.48, 0.13)}`;
      break;
    case "kit":
      scene = [
        rect(0, 0, 1, 1, `fill="#d7d0c2"`),
        rect(0.15, 0.3, 0.4, 0.45, `fill="#c4a77d" ${INK}`),
        rect(0.6, 0.4, 0.25, 0.35, `fill="#c4a77d" ${INK}`),
        rect(0.2, 0.36, 0.2, 0.06, `fill="#f6f4ef" ${THIN}`),
      ].join("");
      break;
    case "room-overview":
    case "indoor-wall":
    default:
      scene = room(v);
      break;
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
    scene,
    label(title),
    `</svg>`,
  ].join("");
  return { svg, annotations: annotationsFor(spec, v), width: W, height: H, title };
}
