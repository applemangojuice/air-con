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

/** zod-free manual validation, clamps to 0..1, drops junk. */
export function validateAnnotations(input: unknown): Annotation[] {
  throw new Error("not implemented: validateAnnotations (F2)");
}
