import { ANNOTATION_STYLE, type Annotation } from "@aircon/domain";

/**
 * Words and legend entries for a drawing, shared by the read-only viewer
 * (annotated-image.tsx), alt text and printed documents. Pure, so it's the
 * same on the server, in the browser and in tests.
 */

/** The ANNOTATION_STYLE key for a shape: routes key on their kind. */
export function annotationStyleKey(a: Annotation): string {
  return a.type === "route" ? a.kind : a.type;
}

export function annotationColour(a: Annotation): string {
  return ANNOTATION_STYLE[annotationStyleKey(a)]?.colour ?? "#ffffff";
}

/** Dark chip text: the ink the rest of the app uses. */
export const CHIP_DARK_TEXT = "#14171e";

/** WCAG 2 relative luminance of a #rrggbb colour (sRGB, linearised). */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2 contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * Readable text on a chip of this colour: whichever of white and dark ink
 * contrasts more (WCAG 2), so dark on the light and mid fills (yellow,
 * orange, cyan, green, white) and white on the deep ones (blue, red,
 * slate). Every ANNOTATION_STYLE colour clears AA (4.5:1) this way.
 */
export function chipTextColour(hex: string): string {
  if (!/^#?[0-9a-f]{6}$/i.test(hex.trim())) return "#ffffff";
  return contrastRatio(CHIP_DARK_TEXT, hex) > contrastRatio("#ffffff", hex) ? CHIP_DARK_TEXT : "#ffffff";
}

const ROUTE_WORDS: Record<"pipe" | "condensate" | "cable", string> = {
  pipe: "pipe route",
  condensate: "condensate route",
  cable: "cable route",
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "indoor unit" + "3.5 kW" → "indoor unit (3.5 kW)"; a label that already names the thing stands alone. */
const withDetail = (base: string, detail?: string) => {
  const d = detail?.trim();
  if (!d) return base;
  return d.toLowerCase().startsWith(base) ? lowerFirst(d) : `${base} (${d})`;
};

/** One shape in words, lower-case ("pipe route 4.2 m", "obstacle: downpipe"). */
export function describeAnnotation(a: Annotation): string {
  switch (a.type) {
    case "indoor-unit":
      return withDetail("indoor unit", a.label);
    case "outdoor-unit":
      return withDetail("outdoor unit", a.label);
    case "core-hole":
      return withDetail("core hole", a.label);
    case "route": {
      const base = ROUTE_WORDS[a.kind] ?? "route";
      const label = a.label?.trim();
      if (!label) return base;
      return label.toLowerCase().startsWith(base) ? lowerFirst(label) : `${base} ${label}`;
    }
    case "obstacle":
      return `obstacle: ${a.label}`;
    case "measure":
      return `measurement ${a.label}`;
    case "note":
      return `note: ${a.text}`;
  }
}

/** The whole drawing as one sentence: "Indoor unit, pipe route 4.2 m, core hole". Empty when there's nothing drawn. */
export function describeAnnotations(list: Annotation[]): string {
  const text = list.map(describeAnnotation).filter(Boolean).join(", ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** Alt text for an annotated photo: what it is, then what's drawn on it. */
export function annotatedAlt(alt: string | undefined, list: Annotation[]): string {
  const base = (alt ?? "").trim();
  const drawn = describeAnnotations(list);
  if (!drawn) return base || "Photo";
  return base ? `${base}. Marked up: ${drawn}` : drawn;
}

export interface LegendEntry {
  key: string;
  label: string;
  colour: string;
  /** How it's drawn, for the swatch. */
  mark: "box" | "dot" | "line" | "dashed" | "dotted" | "cross" | "measure" | "pin";
  count: number;
}

const MARK: Record<string, LegendEntry["mark"]> = {
  "indoor-unit": "box",
  "outdoor-unit": "box",
  "core-hole": "dot",
  pipe: "line",
  condensate: "dashed",
  cable: "dotted",
  obstacle: "cross",
  measure: "measure",
  note: "pin",
};

/** One legend row per kind of shape present, in the order they first appear. */
export function legendEntries(list: Annotation[]): LegendEntry[] {
  const out = new Map<string, LegendEntry>();
  for (const a of list) {
    const key = annotationStyleKey(a);
    const existing = out.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const style = ANNOTATION_STYLE[key];
    out.set(key, { key, label: style?.label ?? key, colour: style?.colour ?? "#ffffff", mark: MARK[key] ?? "dot", count: 1 });
  }
  return [...out.values()];
}
