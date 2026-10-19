"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ANNOTATION_STYLE, estimateLabel, sameJson, validateAnnotations, type Annotation, type Point } from "@aircon/domain";
import { annotationColour, chipTextColour, legendEntries } from "./annotation-summary";
import { ModalPortal } from "./modal-portal";
import {
  clampView,
  defaultBox,
  dragHandle,
  fitBox,
  handlesOf,
  hitHandle,
  hitTest,
  lengthLabel,
  moveShape,
  pinchView,
  rectFrom,
  zoomAround,
  type Box,
  type View,
} from "./annotator-geometry";

/**
 * The photo mark-up editor (plan §7.7): the real photo, with the indoor
 * unit, outdoor unit, core hole, pipe, condensate and cable routes,
 * obstacles, measurements and notes drawn on it. Full screen on a phone,
 * one hand: 48 px controls, pinch to zoom, drag to pan, undo and redo.
 *
 * Coordinates are normalised (0..1 of the photo) so the drawing renders at
 * any size; the read-only twin is annotated-image.tsx. Measurements are
 * always saved as the surveyor's estimate ("≈ 3.2 m"): a photo can't verify
 * a dimension, and nothing here pretends to know what's inside a wall.
 *
 * Unsaved work is kept in this browser (localStorage, keyed by `draftKey`)
 * until it's saved, so a dropped signal or a closed tab never loses it. A
 * failed save retries when signal returns; closing offers to keep the
 * drawing on the phone (the survey saves it once online) or, explicitly, to
 * discard it.
 * `locked` (an approved layout) shows the drawing read-only.
 */

export type ToolId =
  | "select"
  | "indoor-unit"
  | "outdoor-unit"
  | "core-hole"
  | "pipe"
  | "condensate"
  | "cable"
  | "obstacle"
  | "measure"
  | "note";

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
  colour: string;
}

const STYLE = (key: string) => ANNOTATION_STYLE[key]?.colour ?? "#ffffff";

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", hint: "Tap a shape to select it, then drag to move it or its handles to reshape it.", colour: "#ffffff" },
  { id: "indoor-unit", label: "Indoor unit", hint: "Drag a box where the indoor unit goes, or tap for a standard size.", colour: STYLE("indoor-unit") },
  { id: "outdoor-unit", label: "Outdoor unit", hint: "Drag a box where the outdoor unit goes, or tap for a standard size.", colour: STYLE("outdoor-unit") },
  { id: "core-hole", label: "Core hole", hint: "Tap where the hole goes through the wall.", colour: STYLE("core-hole") },
  { id: "pipe", label: "Pipe route", hint: "Tap points along the pipe route, then Done.", colour: STYLE("pipe") },
  { id: "condensate", label: "Condensate", hint: "Tap points along the condensate drain, then Done.", colour: STYLE("condensate") },
  { id: "cable", label: "Cable route", hint: "Tap points along the cable route, then Done.", colour: STYLE("cable") },
  { id: "obstacle", label: "Obstacle", hint: "Tap on the obstacle, then say what it is.", colour: STYLE("obstacle") },
  { id: "measure", label: "Measure", hint: "Tap the start, then the end, then type your estimate.", colour: "#ffffff" },
  { id: "note", label: "Note", hint: "Tap where the note belongs, then type it.", colour: STYLE("note") },
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>;
const ROUTE_TOOLS: ToolId[] = ["pipe", "condensate", "cable"];

const SHAPE_NAME: Record<string, string> = {
  "indoor-unit": "Indoor unit",
  "outdoor-unit": "Outdoor unit",
  "core-hole": "Core hole",
  pipe: "Pipe route",
  condensate: "Condensate route",
  cable: "Cable route",
  obstacle: "Obstacle",
  measure: "Measurement",
  note: "Note",
};
const shapeName = (a: Annotation) => SHAPE_NAME[a.type === "route" ? a.kind : a.type] ?? "Shape";

const UNDER = "rgba(20, 23, 30, 0.6)";
const HISTORY_LIMIT = 100;
const TAP_SLOP_PX = 10;

let idCounter = 0;
const newId = () => `a${Date.now().toString(36)}${(idCounter++).toString(36)}`;

type Prompt =
  | { kind: "obstacle"; at: Point; value: string }
  | { kind: "note"; at: Point; value: string }
  | { kind: "measure"; from: Point; to: Point; value: string };

type Drag =
  | { mode: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { mode: "move"; id: string; start: Point; before: Annotation[]; moved: boolean; startX: number; startY: number }
  | { mode: "handle"; id: string; index: number; before: Annotation[]; moved: boolean; startX: number; startY: number }
  | { mode: "rect"; type: "indoor-unit" | "outdoor-unit"; start: Point; current: Point; startX: number; startY: number }
  | { mode: "tap"; startX: number; startY: number; view: View; moved: boolean }
  | { mode: "pinch"; startView: View; startMid: { x: number; y: number }; startDist: number };

export interface AnnotatorProps {
  /** The photo's read URL; null shows a placeholder. */
  src: string | null;
  width?: number;
  height?: number;
  initial: Annotation[];
  /** What the photo is ("Main bedroom · unit wall"). */
  title: string;
  /** Read-only: the drawing is part of an approved layout. */
  locked?: boolean;
  defaultTool?: ToolId;
  /** Key for keeping unsaved work in this browser (the media id and version). */
  draftKey?: string;
  /** Resolve when saved; throw (or reject) with a message to keep the editor open. */
  onSave: (annotations: Annotation[]) => Promise<void>;
  onClose: () => void;
}

/** The unsaved drawing this browser keeps for `key`, if any (see draftKey). */
export function readAnnotationDraft(key: string | undefined): Annotation[] | null {
  return readDraft(key);
}

/** Keep (or, with null, forget) an unsaved drawing for `key` in this browser. */
export function writeAnnotationDraft(key: string | undefined, annotations: Annotation[] | null): void {
  writeDraft(key, annotations);
}

/**
 * The surveyor asked for this kept drawing to be saved (they pressed Save
 * with no signal, or kept it and closed): the survey saves it once online.
 * A draft left by simply navigating away is only restored, never sent.
 */
export function drawingWaitingToSave(key: string | undefined): boolean {
  if (!key || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`dih-annotate-save:${key}`) !== null;
  } catch {
    return false;
  }
}

/** Ask for a kept drawing to be saved once there's signal (see drawingWaitingToSave). */
export function markAnnotationToSave(key: string | undefined): void {
  markWaitingToSave(key, true);
}

function markWaitingToSave(key: string | undefined, on: boolean): void {
  if (!key || typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(`dih-annotate-save:${key}`, new Date().toISOString());
    else window.localStorage.removeItem(`dih-annotate-save:${key}`);
  } catch {
    // storage blocked: it's restored when the photo is opened again instead
  }
}

function readDraft(key: string | undefined): Annotation[] | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`dih-annotate:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { annotations?: unknown };
    return validateAnnotations(parsed.annotations);
  } catch {
    return null;
  }
}

/** Fired on window whenever a kept drawing is written or forgotten, so tiles can say "not saved yet". */
export const ANNOTATION_DRAFT_EVENT = "dih-annotate-draft";

function writeDraft(key: string | undefined, annotations: Annotation[] | null): void {
  if (!key || typeof window === "undefined") return;
  try {
    const k = `dih-annotate:${key}`;
    const had = window.localStorage.getItem(k) !== null;
    if (annotations === null) {
      window.localStorage.removeItem(k);
      window.localStorage.removeItem(`dih-annotate-save:${key}`);
    } else window.localStorage.setItem(k, JSON.stringify({ annotations, at: new Date().toISOString() }));
    if (had !== (annotations !== null)) window.dispatchEvent(new Event(ANNOTATION_DRAFT_EVENT));
  } catch {
    // Storage full or blocked: the drawing is still in memory.
  }
}

const same = (a: Annotation[], b: Annotation[]) => sameJson(a, b);

/** The editor as a true modal: everything behind it is inert until it closes. */
export function Annotator(props: AnnotatorProps) {
  return (
    <ModalPortal>
      <AnnotatorDialog {...props} />
    </ModalPortal>
  );
}

function AnnotatorDialog({ src, width, height, initial, title, locked = false, defaultTool, draftKey, onSave, onClose }: AnnotatorProps) {
  const dialogId = useId();
  const startList = useMemo(() => validateAnnotations(initial), [initial]);
  const [restored] = useState(() => {
    if (locked) return null;
    const d = readDraft(draftKey);
    return d && !same(d, startList) ? d : null;
  });
  const [list, setList] = useState<Annotation[]>(restored ?? startList);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [tool, setTool] = useState<ToolId>(locked ? "select" : (defaultTool ?? "select"));
  const [selected, setSelected] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState<Point[]>([]);
  const [measureFrom, setMeasureFrom] = useState<Point | null>(null);
  const [rectDraft, setRectDraft] = useState<{ type: "indoor-unit" | "outdoor-unit"; a: Point; b: Point } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [status, setStatus] = useState<{ tone: "info" | "error" | "ok"; text: string } | null>(
    restored ? { tone: "info", text: "We kept your unsaved drawing from last time." } : null,
  );
  const [saving, setSaving] = useState(false);
  // The last save failed (usually no signal): the close panel offers to keep it on this phone.
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(width && height ? { w: width, h: height } : null);
  const [imgFailed, setImgFailed] = useState(false);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });

  const areaRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<Drag | null>(null);

  const aspect = natural ? natural.w / natural.h : 4 / 3;
  const base = useMemo(() => fitBox(area, aspect), [area, aspect]);
  const box: Box = { w: base.w * view.scale, h: base.h * view.scale };
  const dirty = !same(list, startList);

  /* ---------------- layout ---------------- */

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setArea({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Re-centre whenever the area or the photo's shape changes.
  useEffect(() => {
    setView((v) => clampView(v, base, area));
  }, [base, area]);

  /* ---------------- dialog behaviour ---------------- */

  // The portal handles inertness, scrolling and returning focus; start focus on Close.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Unsaved work survives a dropped signal, a closed tab or a crash.
  useEffect(() => {
    if (locked) return;
    writeDraft(draftKey, dirty ? list : null);
  }, [list, dirty, draftKey, locked]);

  /* ---------------- edits ---------------- */

  const commit = useCallback(
    (next: Annotation[], before: Annotation[] = list) => {
      if (same(next, before)) return;
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), before]);
      setFuture([]);
      setList(next);
      setStatus(null);
    },
    [list],
  );

  const undo = () => {
    if (routeDraft.length) return setRouteDraft(routeDraft.slice(0, -1));
    if (measureFrom) return setMeasureFrom(null);
    if (past.length === 0) return;
    setPast(past.slice(0, -1));
    setFuture([list, ...future].slice(0, HISTORY_LIMIT));
    setList(past[past.length - 1]!);
    setSelected(null);
  };

  const redo = () => {
    if (future.length === 0) return;
    setFuture(future.slice(1));
    setPast([...past, list].slice(-HISTORY_LIMIT));
    setList(future[0]!);
    setSelected(null);
  };

  const remove = useCallback(
    (id: string) => {
      commit(list.filter((a) => a.id !== id));
      setSelected(null);
    },
    [commit, list],
  );

  const finishRoute = useCallback(() => {
    if (routeDraft.length >= 2 && ROUTE_TOOLS.includes(tool)) {
      const shape: Annotation = { id: newId(), type: "route", kind: tool as "pipe" | "condensate" | "cable", points: routeDraft };
      commit([...list, shape]);
    }
    setRouteDraft([]);
  }, [routeDraft, tool, commit, list]);

  const pickTool = (id: ToolId) => {
    if (routeDraft.length >= 2) finishRoute();
    else setRouteDraft([]);
    setMeasureFrom(null);
    setPrompt(null);
    setTool(id);
    if (id !== "select") setSelected(null);
  };

  const updateShape = (id: string, patch: (a: Annotation) => Annotation) => {
    commit(list.map((a) => (a.id === id ? patch(a) : a)));
  };

  /* ---------------- pointer input ---------------- */

  const areaPoint = (e: { clientX: number; clientY: number }) => {
    const r = areaRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** Area px → photo coordinates (0..1), unclamped. */
  const photoPoint = (ap: { x: number; y: number }): Point => ({
    x: (ap.x - view.ox) / Math.max(1, box.w),
    y: (ap.y - view.oy) / Math.max(1, box.h),
  });
  const onPhoto = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const clampPt = (p: Point): Point => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) });

  const startPinch = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    // A gesture beats whatever one finger had started.
    const d = drag.current;
    if (d && (d.mode === "move" || d.mode === "handle") && d.moved) setList(d.before);
    setRectDraft(null);
    drag.current = { mode: "pinch", startView: view, startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, startDist: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prompt) return;
    areaRef.current?.setPointerCapture(e.pointerId);
    const ap = areaPoint(e);
    pointers.current.set(e.pointerId, ap);
    if (pointers.current.size >= 2) return startPinch();
    const p = photoPoint(ap);
    const common = { startX: ap.x, startY: ap.y };

    if (locked) {
      drag.current = { mode: "pan", ...common, view, moved: false };
      return;
    }
    if (tool === "select") {
      const sel = selected ? list.find((a) => a.id === selected) : undefined;
      const handle = sel ? hitHandle(sel, p, box) : null;
      if (sel && handle !== null) {
        drag.current = { mode: "handle", id: sel.id, index: handle, before: list, moved: false, ...common };
        return;
      }
      const hit = hitTest(list, p, box);
      if (hit) {
        setSelected(hit.id);
        drag.current = { mode: "move", id: hit.id, start: p, before: list, moved: false, ...common };
        return;
      }
      setSelected(null);
      drag.current = { mode: "pan", ...common, view, moved: false };
      return;
    }
    if ((tool === "indoor-unit" || tool === "outdoor-unit") && onPhoto(p)) {
      drag.current = { mode: "rect", type: tool, start: p, current: p, ...common };
      return;
    }
    // Tap tools: a tap acts on release; a drag pans the zoomed photo instead.
    drag.current = { mode: "tap", ...common, view, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const ap = areaPoint(e);
    pointers.current.set(e.pointerId, ap);
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      setView(pinchView(d.startView, d.startMid, d.startDist, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(a.x - b.x, a.y - b.y), base, area));
      return;
    }
    const far = Math.hypot(ap.x - d.startX, ap.y - d.startY) > TAP_SLOP_PX;
    switch (d.mode) {
      case "pan":
      case "tap":
        if (!far && !d.moved) return;
        d.moved = true;
        setView(clampView({ scale: d.view.scale, ox: d.view.ox + (ap.x - d.startX), oy: d.view.oy + (ap.y - d.startY) }, base, area));
        return;
      case "move": {
        if (!far && !d.moved) return;
        d.moved = true;
        const p = photoPoint(ap);
        const original = d.before.find((a) => a.id === d.id);
        if (!original) return;
        const moved = moveShape(original, p.x - d.start.x, p.y - d.start.y);
        setList(d.before.map((a) => (a.id === d.id ? moved : a)));
        return;
      }
      case "handle": {
        if (!far && !d.moved) return;
        d.moved = true;
        const original = d.before.find((a) => a.id === d.id);
        if (!original) return;
        const next = dragHandle(original, d.index, photoPoint(ap));
        setList(d.before.map((a) => (a.id === d.id ? next : a)));
        return;
      }
      case "rect": {
        d.current = clampPt(photoPoint(ap));
        if (far) setRectDraft({ type: d.type, a: d.start, b: d.current });
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const ap = areaPoint(e);
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pinch") {
      // Lifting one finger of two ends the gesture; nothing else happens.
      if (pointers.current.size === 0) drag.current = null;
      return;
    }
    drag.current = null;
    const far = Math.hypot(ap.x - d.startX, ap.y - d.startY) > TAP_SLOP_PX;
    const p = photoPoint(ap);
    switch (d.mode) {
      case "move":
      case "handle": {
        if (d.moved) commit(list, d.before);
        return;
      }
      case "rect": {
        setRectDraft(null);
        const shape =
          far && Math.abs(d.current.x - d.start.x) > 0.01 && Math.abs(d.current.y - d.start.y) > 0.01
            ? rectFrom({ id: newId(), type: d.type, x: 0, y: 0, w: 0, h: 0 }, d.start, d.current)
            : { id: newId(), type: d.type, ...defaultBox(d.type, clampPt(d.start), natural ? natural.w / natural.h : 4 / 3) };
        commit([...list, shape]);
        setSelected(shape.id);
        setTool("select");
        return;
      }
      case "tap": {
        if (d.moved || far || !onPhoto(p)) return;
        const at = clampPt(p);
        if (tool === "core-hole") {
          commit([...list, { id: newId(), type: "core-hole", ...at }]);
        } else if (ROUTE_TOOLS.includes(tool)) {
          setRouteDraft((r) => (r.length >= 64 ? r : [...r, at]));
        } else if (tool === "obstacle") {
          setPrompt({ kind: "obstacle", at, value: "" });
        } else if (tool === "note") {
          setPrompt({ kind: "note", at, value: "" });
        } else if (tool === "measure") {
          if (!measureFrom) setMeasureFrom(at);
          else {
            setPrompt({ kind: "measure", from: measureFrom, to: at, value: "" });
            setMeasureFrom(null);
          }
        }
        return;
      }
      default:
        return;
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d && (d.mode === "move" || d.mode === "handle") && d.moved) setList(d.before);
    setRectDraft(null);
    if (pointers.current.size === 0) drag.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const factor = Math.exp(-e.deltaY / 300);
    setView((v) => zoomAround(v, v.scale * factor, areaPoint(e), base, area));
  };

  const zoomBy = (factor: number) => setView((v) => zoomAround(v, v.scale * factor, { x: area.w / 2, y: area.h / 2 }, base, area));
  const zoomReset = () => setView(clampView({ scale: 1, ox: 0, oy: 0 }, base, area));

  /* ---------------- prompts ---------------- */

  const confirmPrompt = () => {
    if (!prompt) return;
    const value = prompt.value.trim();
    if (prompt.kind === "obstacle") {
      commit([...list, { id: newId(), type: "obstacle", ...prompt.at, label: value.slice(0, 80) || "Obstacle" }]);
    } else if (prompt.kind === "note") {
      if (!value) return;
      commit([...list, { id: newId(), type: "note", ...prompt.at, text: value.slice(0, 280) }]);
    } else {
      const label = estimateLabel(lengthLabel(value));
      if (!label) return;
      commit([...list, { id: newId(), type: "measure", from: prompt.from, to: prompt.to, label }]);
    }
    setPrompt(null);
  };

  /* ---------------- save / close ---------------- */

  const save = async () => {
    if (saving || locked) return;
    let toSave = list;
    if (routeDraft.length >= 2 && ROUTE_TOOLS.includes(tool)) {
      toSave = [...list, { id: newId(), type: "route", kind: tool as "pipe" | "condensate" | "cable", points: routeDraft }];
      setList(toSave);
      setRouteDraft([]);
    }
    setSaving(true);
    setStatus({ tone: "info", text: "Saving the drawing…" });
    try {
      await onSave(validateAnnotations(toSave));
      writeDraft(draftKey, null);
      setSaveFailed(false);
      setStatus({ tone: "ok", text: "Saved." });
      onClose();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Couldn't save. Check your signal and try again.";
      setSaveFailed(true);
      // They meant to save it: once there's signal the survey sends it, even if they close first.
      writeDraft(draftKey, validateAnnotations(toSave));
      markWaitingToSave(draftKey, true);
      setStatus({
        tone: "error",
        text: draftKey
          ? `${message} Your drawing is kept on this phone: it saves by itself when signal returns, or close and carry on.`
          : `${message} Try again when you have signal.`,
      });
    } finally {
      setSaving(false);
    }
  };

  // Signal back after a failed save: try again by itself while the editor is open.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!saveFailed) return;
    const retry = () => void saveRef.current();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [saveFailed]);

  const requestClose = () => {
    if (dirty && !locked) setConfirmClose(true);
    else onClose();
  };

  /** Leave the editor with the drawing kept in this browser (it's there when the photo is opened again, and saves when signal returns). */
  const keepAndClose = () => {
    writeDraft(draftKey, list);
    markWaitingToSave(draftKey, true);
    onClose();
  };

  // Only an explicit "Discard changes" (on the panel that says they'll be lost) forgets the drawing.
  const discard = () => {
    writeDraft(draftKey, null);
    onClose();
  };

  // Keyboard: Escape backs out one step; Delete removes the selection; Ctrl/⌘+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        e.preventDefault();
        if (prompt) setPrompt(null);
        else if (confirmClose) setConfirmClose(false);
        else if (routeDraft.length || measureFrom) {
          setRouteDraft([]);
          setMeasureFrom(null);
        } else if (selected) setSelected(null);
        else requestClose();
        return;
      }
      if (typing || locked) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove(selected);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (selected && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.02 : 0.005;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        updateShape(selected, (a) => moveShape(a, dx, dy));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------- render ---------------- */

  const sel = selected ? list.find((a) => a.id === selected) ?? null : null;
  const entries = legendEntries(list);
  const hint = locked
    ? "Pinch or use the zoom buttons to look closer."
    : measureFrom
      ? "Now tap the other end of what you're measuring."
      : routeDraft.length
        ? `${routeDraft.length} point${routeDraft.length === 1 ? "" : "s"}. Keep tapping along the route, then Done.`
        : TOOL[tool].hint;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      className="fixed inset-0 z-[60] flex flex-col bg-ink-950 text-white"
    >
      {/* Top bar */}
      <div className="flex min-h-14 items-center gap-2 border-b border-white/10 px-2 pt-[env(safe-area-inset-top)]">
        <button
          ref={closeRef}
          type="button"
          onClick={requestClose}
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full text-white hover:bg-white/10"
          aria-label="Close the editor"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h2 id={`${dialogId}-title`} className="truncate text-base font-semibold">
            {title}
          </h2>
          <p className="truncate text-xs text-white/70">{locked ? "Locked by design approval" : dirty ? "Unsaved changes" : "Mark up the photo"}</p>
        </div>
        {!locked && (
          <button
            type="button"
            onClick={save}
            disabled={saving || (!dirty && routeDraft.length < 2)}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent-700 px-5 text-base font-semibold text-white shadow-sm hover:bg-accent-800 disabled:bg-white/10 disabled:text-white/50 disabled:shadow-none"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {status?.text ?? ""}
      </p>
      {locked && (
        <div className="border-b border-white/10 bg-amber-100 px-4 py-2 text-sm text-amber-950">
          <span className="font-semibold">Locked by design approval.</span> This drawing is part of the approved layout, so it can only be viewed. A change needs a new design version.
        </div>
      )}
      {status && status.tone !== "ok" && (
        <div
          className={`px-4 py-2 text-sm ${status.tone === "error" ? "bg-red-100 text-red-900" : "bg-sage-100 text-sage-900"}`}
          role={status.tone === "error" ? "alert" : undefined}
        >
          {status.text}
        </div>
      )}

      {/* Photo */}
      <div
        ref={areaRef}
        className="relative min-h-0 flex-1 overflow-hidden select-none"
        style={{ touchAction: "none", cursor: locked ? "grab" : tool === "select" ? "default" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      >
        <div className="absolute" style={{ left: view.ox, top: view.oy, width: box.w, height: box.h }}>
          {src && !imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
            <img
              src={src}
              alt={title}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setImgFailed(true)}
              className="pointer-events-none absolute inset-0 h-full w-full object-fill"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/5 p-6 text-center text-sm text-white/80">
              The photo couldn&apos;t be loaded. You can still draw; it will line up once the photo is back.
            </div>
          )}
          <Overlay
            list={list}
            box={box}
            selected={sel}
            routeDraft={routeDraft}
            routeKind={ROUTE_TOOLS.includes(tool) ? (tool as "pipe" | "condensate" | "cable") : "pipe"}
            measureFrom={measureFrom}
            rectDraft={rectDraft}
            showHandles={!locked && tool === "select"}
          />
        </div>

        {/* Zoom controls */}
        <div className="absolute right-2 top-2 flex flex-col gap-2">
          <IconButton label="Zoom in" onClick={() => zoomBy(1.5)}>
            <path d="M12 5v14M5 12h14" />
          </IconButton>
          <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>
            <path d="M5 12h14" />
          </IconButton>
          {view.scale > 1.01 && (
            <IconButton label="Fit the photo" onClick={zoomReset}>
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-white/10 bg-ink-900 pb-[env(safe-area-inset-bottom)]">
        {entries.length > 0 && (
          <ul aria-label="Key" className="flex flex-wrap gap-x-3 gap-y-1 px-3 pt-2 text-xs text-white/85">
            {entries.map((e) => (
              <li key={e.key} className="inline-flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white/40" style={{ background: e.colour }} />
                {e.key === "measure" ? "Measurement (surveyor estimate)" : e.label}
                {e.count > 1 ? ` ×${e.count}` : ""}
              </li>
            ))}
          </ul>
        )}

        {confirmClose ? (
          <div className="space-y-3 p-3">
            <p className="text-base font-semibold">{saveFailed ? "It hasn't saved yet" : "Close without saving?"}</p>
            <p className="text-sm text-white/75">
              {draftKey
                ? "Keep it on this phone and carry on: it's here when you open this photo again, and saves by itself when there's signal. Or throw these changes away."
                : "Your changes to this drawing will be lost."}
            </p>
            {draftKey && (
              <PanelButton onClick={keepAndClose} tone="accent">
                Keep it on this phone and close
              </PanelButton>
            )}
            <div className="grid grid-cols-2 gap-2">
              <PanelButton onClick={() => setConfirmClose(false)}>Keep editing</PanelButton>
              <PanelButton onClick={discard} tone="danger">
                Discard changes
              </PanelButton>
            </div>
          </div>
        ) : prompt ? (
          <PromptPanel prompt={prompt} onChange={(value) => setPrompt({ ...prompt, value })} onCancel={() => setPrompt(null)} onConfirm={confirmPrompt} />
        ) : sel && !locked && tool === "select" ? (
          <SelectionPanel
            shape={sel}
            onLabel={(text) =>
              updateShape(sel.id, (a) => {
                if (a.type === "note") return text.trim() ? { ...a, text: text.trim().slice(0, 280) } : a;
                if (a.type === "measure") {
                  const label = estimateLabel(lengthLabel(text));
                  return label ? { ...a, label } : a;
                }
                if (a.type === "obstacle") return { ...a, label: text.trim().slice(0, 80) || "Obstacle" };
                const label = text.trim().slice(0, 80);
                if (label) return { ...a, label };
                const { label: _drop, ...rest } = a as Annotation & { label?: string };
                return rest as Annotation;
              })
            }
            onDelete={() => remove(sel.id)}
            onDone={() => setSelected(null)}
          />
        ) : (
          <>
            <p className="min-h-10 px-3 pt-2 text-sm text-white/85" aria-live="polite">
              {hint}
            </p>
            {!locked && (
              <div className="flex items-center gap-2 px-3 pb-2">
                <PanelButton onClick={undo} disabled={past.length === 0 && !routeDraft.length && !measureFrom} compact>
                  Undo
                </PanelButton>
                <PanelButton onClick={redo} disabled={future.length === 0} compact>
                  Redo
                </PanelButton>
                {routeDraft.length > 0 && (
                  <PanelButton onClick={finishRoute} tone="accent" compact disabled={routeDraft.length < 2}>
                    Done
                  </PanelButton>
                )}
              </div>
            )}
            {!locked && (
              <div role="toolbar" aria-label="Drawing tools" className="flex gap-1.5 overflow-x-auto px-2 pb-2">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={tool === t.id}
                    onClick={() => pickTool(t.id)}
                    className={`flex min-h-14 min-w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 text-xs font-semibold transition ${
                      tool === t.id ? "bg-white text-ink-950" : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    <ToolIcon id={t.id} colour={t.colour} active={tool === t.id} />
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink-950/75 text-white ring-1 ring-white/25 backdrop-blur hover:bg-ink-950"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

function PanelButton({
  onClick,
  children,
  disabled,
  tone = "plain",
  compact = false,
  type = "button",
}: {
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  tone?: "plain" | "accent" | "danger";
  compact?: boolean;
  type?: "button" | "submit";
}) {
  const tones = {
    plain: "bg-white/10 text-white hover:bg-white/15",
    accent: "bg-accent-700 text-white hover:bg-accent-800",
    danger: "bg-red-700 text-white hover:bg-red-800",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-12 items-center justify-center rounded-full font-semibold transition disabled:opacity-35 ${compact ? "px-4 text-sm" : "w-full px-4 text-base"} ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function ToolIcon({ id, colour, active }: { id: ToolId; colour: string; active: boolean }) {
  const stroke = active && (colour === "#ffffff" || id === "select") ? "#14171e" : colour;
  const common = { fill: "none", stroke, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6">
      {id === "select" && <path {...common} d="M5 3l14 8-6 2-2 6z" />}
      {(id === "indoor-unit" || id === "outdoor-unit") && (
        <rect {...common} x={id === "indoor-unit" ? 3 : 5} y={id === "indoor-unit" ? 8 : 5} width={id === "indoor-unit" ? 18 : 14} height={id === "indoor-unit" ? 8 : 14} rx={2} fill={`${colour}55`} />
      )}
      {id === "core-hole" && <circle cx={12} cy={12} r={6} fill={colour} stroke={active ? "#14171e" : "none"} strokeWidth={1.5} />}
      {(id === "pipe" || id === "condensate" || id === "cable") && (
        <path {...common} strokeDasharray={id === "condensate" ? "4 3" : id === "cable" ? "1 4" : undefined} d="M4 19 C 8 19, 8 6, 12 6 S 16 14, 20 5" />
      )}
      {id === "obstacle" && <path {...common} d="M6 6l12 12M18 6 6 18" />}
      {id === "measure" && <path {...common} d="M3 12h18M3 8v8M21 8v8" />}
      {id === "note" && (
        <>
          <circle cx={12} cy={12} r={8} fill={colour} stroke="none" />
          <path d="M9 12h6" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function PromptPanel({
  prompt,
  onChange,
  onCancel,
  onConfirm,
}: {
  prompt: Prompt;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const copy = {
    obstacle: { label: "What's in the way?", placeholder: "e.g. downpipe, gas meter, window", hint: "Leave it blank to just mark an obstacle.", required: false },
    note: { label: "Note", placeholder: "e.g. customer wants it 20 cm higher", hint: "Shows as a numbered pin on the photo.", required: true },
    measure: {
      label: "Length (your estimate)",
      placeholder: "e.g. 3.2",
      hint: "In metres unless you type a unit. Saved as a surveyor estimate (≈), never as a verified measurement.",
      required: true,
    },
  }[prompt.kind];
  const ok = !copy.required || prompt.value.trim().length > 0;
  return (
    <form
      className="space-y-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onConfirm();
      }}
    >
      <label htmlFor={id} className="block text-sm font-semibold">
        {copy.label}
      </label>
      <div className="relative">
        <input
          id={id}
          autoFocus
          value={prompt.value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={prompt.kind === "measure" ? "decimal" : "text"}
          maxLength={prompt.kind === "note" ? 280 : 60}
          placeholder={copy.placeholder}
          aria-describedby={`${id}-hint`}
          className="min-h-12 w-full rounded-full border border-white/25 bg-white px-4 text-base text-ink-900 outline-none placeholder:text-ink-500 focus:ring-2 focus:ring-accent-400"
        />
        {prompt.kind === "measure" && /^\s*\d+([.,]\d+)?\s*$/.test(prompt.value) && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base text-ink-500">m</span>
        )}
      </div>
      <p id={`${id}-hint`} className="text-xs text-white/75">
        {copy.hint}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <PanelButton onClick={onCancel}>Cancel</PanelButton>
        <PanelButton type="submit" tone="accent" disabled={!ok}>
          Add
        </PanelButton>
      </div>
    </form>
  );
}

function SelectionPanel({
  shape,
  onLabel,
  onDelete,
  onDone,
}: {
  shape: Annotation;
  onLabel: (text: string) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const id = useId();
  const current = shape.type === "note" ? shape.text : (shape as { label?: string }).label ?? "";
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [shape.id, current]);
  const label =
    shape.type === "note"
      ? "Note"
      : shape.type === "measure"
        ? "Length (your estimate)"
        : shape.type === "obstacle"
          ? "What's in the way?"
          : "Label (optional)";
  const placeholder =
    shape.type === "indoor-unit" ? "e.g. 2.5 kW, 2.1 m up" : shape.type === "route" ? "e.g. 4.5 m" : shape.type === "core-hole" ? "e.g. 65 mm" : "";
  const commitValue = () => {
    if (value !== current) onLabel(value);
  };
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full ring-1 ring-white/40" style={{ background: annotationColour(shape) }} />
          {shapeName(shape)}
        </p>
        <p className="text-xs text-white/70">Drag it, or its handles, on the photo</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commitValue();
          onDone();
        }}
        className="space-y-2"
      >
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitValue}
          placeholder={placeholder || label}
          aria-label={label}
          inputMode={shape.type === "measure" ? "decimal" : "text"}
          maxLength={shape.type === "note" ? 280 : 60}
          className="min-h-12 w-full rounded-full border border-white/25 bg-white px-4 text-base text-ink-900 outline-none placeholder:text-ink-500 focus:ring-2 focus:ring-accent-400"
        />
        {shape.type === "measure" && <p className="text-xs text-white/75">A surveyor estimate (≈), never a verified measurement.</p>}
        <div className="grid grid-cols-2 gap-2">
          <PanelButton onClick={onDelete} tone="danger">
            Delete
          </PanelButton>
          <PanelButton type="submit" tone="accent">
            Done
          </PanelButton>
        </div>
      </form>
    </div>
  );
}

/** The drawing in screen pixels, with selection handles and drafts in progress. */
function Overlay({
  list,
  box,
  selected,
  routeDraft,
  routeKind,
  measureFrom,
  rectDraft,
  showHandles,
}: {
  list: Annotation[];
  box: Box;
  selected: Annotation | null;
  routeDraft: Point[];
  routeKind: "pipe" | "condensate" | "cable";
  measureFrom: Point | null;
  rectDraft: { type: "indoor-unit" | "outdoor-unit"; a: Point; b: Point } | null;
  showHandles: boolean;
}) {
  const X = (n: number) => n * box.w;
  const Y = (n: number) => n * box.h;
  const pts = (ps: Point[]) => ps.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
  let noteN = 0;
  const chips: { key: string; x: number; y: number; text: string; colour: string; pin?: boolean }[] = [];

  const shapes = list.map((a) => {
    const colour = annotationColour(a);
    const isSel = selected?.id === a.id;
    switch (a.type) {
      case "indoor-unit":
      case "outdoor-unit":
        chips.push({ key: a.id, x: X(a.x), y: Y(a.y) - 4, text: a.label?.trim() || (a.type === "indoor-unit" ? "Indoor unit" : "Outdoor unit"), colour });
        return (
          <g key={a.id}>
            <rect x={X(a.x)} y={Y(a.y)} width={X(a.w)} height={Y(a.h)} fill="none" stroke={UNDER} strokeWidth={isSel ? 7 : 5} />
            <rect x={X(a.x)} y={Y(a.y)} width={X(a.w)} height={Y(a.h)} fill={colour} fillOpacity={0.2} stroke={colour} strokeWidth={isSel ? 3.5 : 2.5} />
          </g>
        );
      case "core-hole":
        if (a.label?.trim()) chips.push({ key: a.id, x: X(a.x) + 14, y: Y(a.y) + 6, text: a.label.trim(), colour });
        return (
          <g key={a.id}>
            <circle cx={X(a.x)} cy={Y(a.y)} r={isSel ? 13 : 11} fill={UNDER} />
            <circle cx={X(a.x)} cy={Y(a.y)} r={8} fill={colour} />
            <circle cx={X(a.x)} cy={Y(a.y)} r={3.5} fill="rgba(20,23,30,0.85)" />
          </g>
        );
      case "route": {
        const dash = a.kind === "condensate" ? "9 6" : a.kind === "cable" ? "2 6" : undefined;
        const mid = a.points[Math.floor(a.points.length / 2)]!;
        if (a.label?.trim()) chips.push({ key: a.id, x: X(mid.x) + 8, y: Y(mid.y) - 8, text: a.label.trim(), colour });
        return (
          <g key={a.id}>
            <polyline points={pts(a.points)} fill="none" stroke={UNDER} strokeWidth={isSel ? 9 : 6} strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={pts(a.points)} fill="none" stroke={colour} strokeWidth={isSel ? 4.5 : 3.5} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      }
      case "obstacle": {
        const d = 9;
        chips.push({ key: a.id, x: X(a.x) + 14, y: Y(a.y) + 6, text: a.label, colour });
        const cross = (stroke: string, w: number) => (
          <path d={`M${X(a.x) - d} ${Y(a.y) - d} L${X(a.x) + d} ${Y(a.y) + d} M${X(a.x) - d} ${Y(a.y) + d} L${X(a.x) + d} ${Y(a.y) - d}`} stroke={stroke} strokeWidth={w} strokeLinecap="round" />
        );
        return (
          <g key={a.id}>
            {cross(UNDER, isSel ? 9 : 7)}
            {cross(colour, 4)}
          </g>
        );
      }
      case "measure": {
        const mx = (X(a.from.x) + X(a.to.x)) / 2;
        const my = (Y(a.from.y) + Y(a.to.y)) / 2;
        chips.push({ key: a.id, x: mx, y: my, text: a.label, colour: "#ffffff" });
        return (
          <g key={a.id}>
            <line x1={X(a.from.x)} y1={Y(a.from.y)} x2={X(a.to.x)} y2={Y(a.to.y)} stroke={UNDER} strokeWidth={isSel ? 7 : 5} strokeLinecap="round" />
            <line x1={X(a.from.x)} y1={Y(a.from.y)} x2={X(a.to.x)} y2={Y(a.to.y)} stroke="#ffffff" strokeWidth={2} strokeDasharray="6 4" />
            <circle cx={X(a.from.x)} cy={Y(a.from.y)} r={4} fill="#ffffff" />
            <circle cx={X(a.to.x)} cy={Y(a.to.y)} r={4} fill="#ffffff" />
          </g>
        );
      }
      case "note": {
        noteN += 1;
        chips.push({ key: a.id, x: X(a.x), y: Y(a.y), text: String(noteN), colour, pin: true });
        return (
          <g key={a.id}>
            <circle cx={X(a.x)} cy={Y(a.y)} r={isSel ? 15 : 13} fill={UNDER} />
            <circle cx={X(a.x)} cy={Y(a.y)} r={11} fill={colour} />
          </g>
        );
      }
    }
  });

  const handles = selected && showHandles ? handlesOf(selected) : [];
  const draftColour = ANNOTATION_STYLE[routeKind]?.colour ?? "#2563eb";

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden>
        {shapes}
        {selected && (
          <g>
            {handles.map((h, i) => (
              <g key={i}>
                <circle cx={X(h.x)} cy={Y(h.y)} r={12} fill="rgba(20,23,30,0.55)" />
                <circle cx={X(h.x)} cy={Y(h.y)} r={8} fill="#ffffff" stroke="#14171e" strokeWidth={2} />
              </g>
            ))}
            {handles.length === 0 && "x" in selected && (
              <circle cx={X(selected.x)} cy={Y(selected.y)} r={20} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="4 3" />
            )}
          </g>
        )}
        {rectDraft && (
          <rect
            x={X(Math.min(rectDraft.a.x, rectDraft.b.x))}
            y={Y(Math.min(rectDraft.a.y, rectDraft.b.y))}
            width={X(Math.abs(rectDraft.a.x - rectDraft.b.x))}
            height={Y(Math.abs(rectDraft.a.y - rectDraft.b.y))}
            fill={`${ANNOTATION_STYLE[rectDraft.type]?.colour ?? "#fff"}33`}
            stroke={ANNOTATION_STYLE[rectDraft.type]?.colour ?? "#fff"}
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        )}
        {routeDraft.length > 0 && (
          <g>
            {routeDraft.length > 1 && (
              <polyline points={pts(routeDraft)} fill="none" stroke={draftColour} strokeWidth={3.5} strokeDasharray="8 5" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {routeDraft.map((p, i) => (
              <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={6} fill={draftColour} stroke="#ffffff" strokeWidth={2} />
            ))}
          </g>
        )}
        {measureFrom && <circle cx={X(measureFrom.x)} cy={Y(measureFrom.y)} r={7} fill="#ffffff" stroke="#14171e" strokeWidth={2} />}
      </svg>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {chips.map((c) => (
          <span
            key={`chip-${c.key}`}
            className={
              c.pin
                ? "absolute -translate-x-1/2 -translate-y-1/2 text-xs font-bold text-white"
                : "absolute max-w-[60%] -translate-y-full truncate whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold shadow"
            }
            style={{
              left: c.x,
              top: c.y,
              ...(c.pin ? {} : { background: c.colour, color: chipTextColour(c.colour) }),
            }}
          >
            {c.text}
          </span>
        ))}
      </div>
    </>
  );
}

export default Annotator;
