import type { CSSProperties, ReactNode } from "react";
import type { Annotation, Point } from "@aircon/domain";
import { annotatedAlt, annotationColour, chipTextColour, legendEntries, type LegendEntry } from "./annotation-summary";

/**
 * A photo with its drawing on top, read-only: the proposal's room cards,
 * the ops command centre, documents, the portal. Pure and server-renderable
 * (no state, no effects), and it works at any size, from a thumbnail to a
 * full-width print.
 *
 * The drawing is an SVG laid over the image box in normalised coordinates
 * (viewBox 0 0 1 1, preserveAspectRatio none), so a shape stays on the same
 * spot of the photo however the box is scaled. Strokes are non-scaling, so
 * lines keep their weight; round markers (core holes, note pins) are
 * zero-length round-capped lines, which stay round under the stretch; text
 * goes in small HTML chips on top, so it's never squashed.
 *
 * Pass the image's intrinsic `width`/`height` when known: the box then
 * reserves its space before the image loads (no layout shift), and crosses
 * and measurement ticks are drawn square.
 */

export interface AnnotatedImageProps {
  /** A signed URL; null shows a neutral placeholder (file missing or still uploading). */
  src: string | null;
  annotations: Annotation[];
  /** What the photo shows ("Living room, indoor unit wall"); the drawing's summary is added to it. */
  alt?: string;
  width?: number;
  height?: number;
  /** Show the colour key (and numbered notes) under the photo. */
  legend?: boolean;
  /** Text chips on the photo. Off for thumbnails, where they'd crowd it. */
  labels?: boolean;
  caption?: ReactNode;
  className?: string;
  /** Image loading hint. Default lazy. */
  loading?: "lazy" | "eager";
}

const STROKE = {
  // Thin dark underlay under every line, so colours read on any photo.
  under: "rgba(20, 23, 30, 0.55)",
};

const pct = (n: number) => `${(Math.min(1, Math.max(0, n)) * 100).toFixed(3)}%`;
const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const okPoint = (p: Point | undefined): p is Point => !!p && ok(p.x) && ok(p.y);

/** Round marker: a zero-length line with a round cap, `size` px across whatever the scale. */
function Dot({ x, y, size, colour }: { x: number; y: number; size: number; colour: string }) {
  return (
    <line
      x1={x}
      y1={y}
      x2={x}
      y2={y}
      stroke={colour}
      strokeWidth={size}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function Line({
  points,
  colour,
  width,
  dash,
}: {
  points: Point[];
  colour: string;
  width: number;
  dash?: string;
}) {
  const d = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <>
      <polyline
        points={d}
        fill="none"
        stroke={STROKE.under}
        strokeWidth={width + 2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={d}
        fill="none"
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

interface Chip {
  key: string;
  x: number;
  y: number;
  text: string;
  colour: string;
  /** Where the chip sits relative to its point. */
  anchor: "above-left" | "inside-left" | "centre" | "right";
}

const CHIP_TRANSFORM: Record<Chip["anchor"], string> = {
  "above-left": "translate(0, calc(-100% - 3px))",
  "inside-left": "translate(3px, 3px)",
  centre: "translate(-50%, -50%)",
  right: "translate(10px, -50%)",
};

function midpoint(points: Point[]): Point {
  if (points.length === 2) return { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
  return points[Math.floor(points.length / 2)]!;
}

/** Shapes and chips for one annotation. `ay` stretches vertical offsets so crosses and ticks come out square. */
function render(a: Annotation, ay: number, noteNumber: number): { shape: ReactNode; chips: Chip[] } {
  const colour = annotationColour(a);
  switch (a.type) {
    case "indoor-unit":
    case "outdoor-unit": {
      if (![a.x, a.y, a.w, a.h].every(ok)) return { shape: null, chips: [] };
      return {
        shape: (
          <g key={a.id}>
            <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="none" stroke={STROKE.under} strokeWidth={5} vectorEffect="non-scaling-stroke" />
            <rect
              x={a.x}
              y={a.y}
              width={a.w}
              height={a.h}
              fill={colour}
              fillOpacity={0.18}
              stroke={colour}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ),
        chips: [
          {
            key: a.id,
            x: a.x,
            y: a.y,
            text: a.label?.trim() || (a.type === "indoor-unit" ? "Indoor unit" : "Outdoor unit"),
            colour,
            anchor: a.y < 0.07 ? "inside-left" : "above-left",
          },
        ],
      };
    }
    case "core-hole": {
      if (!ok(a.x) || !ok(a.y)) return { shape: null, chips: [] };
      return {
        shape: (
          <g key={a.id}>
            <Dot x={a.x} y={a.y} size={20} colour={STROKE.under} />
            <Dot x={a.x} y={a.y} size={16} colour={colour} />
            <Dot x={a.x} y={a.y} size={7} colour="rgba(20, 23, 30, 0.85)" />
          </g>
        ),
        chips: a.label?.trim() ? [{ key: a.id, x: a.x, y: a.y, text: a.label.trim(), colour, anchor: "right" }] : [],
      };
    }
    case "route": {
      const points = (a.points ?? []).filter(okPoint);
      if (points.length < 2) return { shape: null, chips: [] };
      const dash = a.kind === "condensate" ? "9 6" : a.kind === "cable" ? "2 6" : undefined;
      const mid = midpoint(points);
      return {
        shape: (
          <g key={a.id}>
            <Line points={points} colour={colour} width={a.kind === "cable" ? 3.5 : 3} dash={dash} />
          </g>
        ),
        chips: a.label?.trim() ? [{ key: a.id, x: mid.x, y: mid.y, text: a.label.trim(), colour, anchor: "right" }] : [],
      };
    }
    case "obstacle": {
      if (!ok(a.x) || !ok(a.y)) return { shape: null, chips: [] };
      const dx = 0.018;
      const dy = dx * ay;
      const cross = (stroke: string, width: number) => (
        <>
          <line x1={a.x - dx} y1={a.y - dy} x2={a.x + dx} y2={a.y + dy} stroke={stroke} strokeWidth={width} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1={a.x - dx} y1={a.y + dy} x2={a.x + dx} y2={a.y - dy} stroke={stroke} strokeWidth={width} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      );
      return {
        shape: (
          <g key={a.id}>
            {cross(STROKE.under, 6.5)}
            {cross(colour, 4)}
          </g>
        ),
        chips: a.label?.trim() ? [{ key: a.id, x: a.x + dx, y: a.y, text: a.label.trim(), colour, anchor: "right" }] : [],
      };
    }
    case "measure": {
      if (!okPoint(a.from) || !okPoint(a.to)) return { shape: null, chips: [] };
      // Ticks square to the line in screen space: work in a box 1 wide and 1/ay tall.
      const vx = a.to.x - a.from.x;
      const vy = (a.to.y - a.from.y) / ay;
      const len = Math.hypot(vx, vy) || 1;
      const t = 0.012;
      const px = (-vy / len) * t;
      const py = (vx / len) * t * ay;
      const tick = (p: Point) => [
        { x: p.x - px, y: p.y - py },
        { x: p.x + px, y: p.y + py },
      ];
      const mid = midpoint([a.from, a.to]);
      return {
        shape: (
          <g key={a.id}>
            <Line points={[a.from, a.to]} colour={colour} width={2} dash="6 4" />
            <Line points={tick(a.from)} colour={colour} width={2.5} />
            <Line points={tick(a.to)} colour={colour} width={2.5} />
          </g>
        ),
        chips: [{ key: a.id, x: mid.x, y: mid.y, text: a.label, colour, anchor: "centre" }],
      };
    }
    case "note": {
      if (!ok(a.x) || !ok(a.y)) return { shape: null, chips: [] };
      return {
        shape: (
          <g key={a.id}>
            <Dot x={a.x} y={a.y} size={24} colour={STROKE.under} />
            <Dot x={a.x} y={a.y} size={20} colour={colour} />
          </g>
        ),
        chips: [{ key: a.id, x: a.x, y: a.y, text: String(noteNumber), colour: "transparent", anchor: "centre" }],
      };
    }
  }
}

function Swatch({ entry }: { entry: LegendEntry }) {
  const c = entry.colour;
  const line = (dash?: string) => (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
      <line x1="1" y1="5" x2="21" y2="5" stroke={STROKE.under} strokeWidth="5" strokeLinecap="round" />
      <line x1="1" y1="5" x2="21" y2="5" stroke={c} strokeWidth="3" strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
  switch (entry.mark) {
    case "box":
      return <span className="inline-block h-3 w-4 rounded-[3px] border-2" style={{ borderColor: c, background: `${c}33` }} aria-hidden="true" />;
    case "dot":
    case "pin":
      return <span className="inline-block h-3 w-3 rounded-full ring-2 ring-ink-900/40" style={{ background: c }} aria-hidden="true" />;
    case "cross":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2 L10 10 M2 10 L10 2" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "dashed":
      return line("5 3");
    case "dotted":
      return line("1 4");
    case "measure":
      return (
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <path d="M2 1 V9 M20 1 V9 M2 5 H20" stroke="#14171e" strokeWidth="1.5" />
        </svg>
      );
    default:
      return line();
  }
}

export function AnnotatedImage({
  src,
  annotations,
  alt,
  width,
  height,
  legend = false,
  labels = true,
  caption,
  className,
  loading = "lazy",
}: AnnotatedImageProps) {
  const list = Array.isArray(annotations) ? annotations : [];
  const hasSize = ok(width) && ok(height) && width > 0 && height > 0;
  // Vertical stretch of the 0..1 box relative to horizontal (4:3 when unknown).
  const ay = hasSize ? width / height : 4 / 3;
  const altText = annotatedAlt(alt, list);

  let noteN = 0;
  const notes: { n: number; text: string }[] = [];
  const shapes: ReactNode[] = [];
  const chips: Chip[] = [];
  for (const a of list) {
    if (a.type === "note") {
      noteN += 1;
      notes.push({ n: noteN, text: a.text });
    }
    const r = render(a, ay, noteN);
    if (r.shape) shapes.push(r.shape);
    chips.push(...r.chips);
  }
  const entries = legend ? legendEntries(list) : [];

  const boxStyle: CSSProperties | undefined = hasSize ? { aspectRatio: `${width} / ${height}` } : src ? undefined : { aspectRatio: "4 / 3" };

  return (
    <figure className={["min-w-0", className].filter(Boolean).join(" ")}>
      <div className="relative w-full overflow-hidden rounded-2xl bg-surface" style={boxStyle}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs: nothing for the optimiser to cache
          <img
            src={src}
            alt={altText}
            width={hasSize ? width : undefined}
            height={hasSize ? height : undefined}
            loading={loading}
            decoding="async"
            className={hasSize ? "absolute inset-0 h-full w-full object-fill" : "block h-auto w-full"}
          />
        ) : (
          <div role="img" aria-label={altText} className="absolute inset-0 grid place-items-center text-sm text-ink-500">
            Photo unavailable
          </div>
        )}
        {shapes.length > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {shapes}
          </svg>
        )}
        {labels && chips.length > 0 && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {chips.map((chip) => {
              const pin = chip.colour === "transparent";
              return (
                <span
                  key={`chip-${chip.key}`}
                  className={
                    pin
                      ? "absolute text-[11px] font-bold leading-none text-white"
                      : "absolute max-w-[45%] truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight shadow-sm"
                  }
                  style={{
                    left: pct(chip.x),
                    top: pct(chip.y),
                    transform: CHIP_TRANSFORM[chip.anchor],
                    ...(pin ? {} : { background: chip.colour, color: chipTextColour(chip.colour) }),
                  }}
                >
                  {chip.text}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {(entries.length > 0 || (legend && notes.length > 0)) && (
        <div className="mt-2 space-y-1.5 text-xs text-ink-700">
          {entries.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Key">
              {entries.map((e) => (
                <li key={e.key} className="inline-flex items-center gap-1.5">
                  <Swatch entry={e} />
                  <span>
                    {e.label}
                    {e.count > 1 ? ` ×${e.count}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {legend && notes.length > 0 && (
            <ol className="space-y-0.5">
              {notes.map((n) => (
                <li key={n.n}>
                  <span className="font-semibold text-ink-900">{n.n}.</span> {n.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {caption && <figcaption className="mt-1.5 text-sm text-ink-500">{caption}</figcaption>}
    </figure>
  );
}

export default AnnotatedImage;
