"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  PHOTO_TAG_LABEL,
  SURVEY_SECTIONS,
  diffSelfSurvey,
  sectionProgress,
  surveyCompleteness,
  type MeasuredSurvey,
  type PhotoTag,
  type SurveySectionId,
} from "@aircon/domain";
import { MediaAnnotator, mediaDraftKey, saveAnnotations } from "@/components/annotate/media-annotator";
import { ANNOTATION_DRAFT_EVENT, Annotator, drawingWaitingToSave, markAnnotationToSave, readAnnotationDraft, writeAnnotationDraft, type ToolId } from "@/components/annotate/annotator";
import type { UploadedMedia } from "@/lib/media-client";
import { SurveyContext, type SurveyCtx } from "./context";
import { clearLocalDraft } from "./draft-store";
import { ConsentSection, MissingList, SubmitSection, SubmittedScreen } from "./finish";
import { SCREEN_LABEL, londonClock, useSurveyNav, type Nav, type ScreenId } from "./nav";
import { OutdoorSection, PositionEditor } from "./outdoor";
import { queueDrawing, queuedDrawing, takeQueuedDrawing } from "./pending-drawings";
import { canStartOnPhone, pendingStart, replayPendingStart, setPendingStart } from "./pending-start";
import { usePhotoQueue, type PendingPhoto, type PhotoTarget } from "./photo-queue";
import { RoomEditor, RoomsSection } from "./rooms";
import { AssumptionsSection, ElectricsSection, HouseSection, PermissionsSection, RisksSection, SiteSection, WishesSection } from "./sections";
import type { OnMyWayState, SurveyIssueTopic, SurveyMediaItem, VisitProps } from "./types";
import { useSurveyDraft, type SaveState, type ServerDraft } from "./use-survey-draft";
import { OnMyWaySheet, VisitCard, mapsLinks, telHref } from "./visit";

/**
 * The surveyor's visit, start to finish, on a phone: the visit card and
 * "on my way" before, the sectioned survey during (autosaved, photos
 * uploading in the background, a completeness meter that names what's
 * left), and what happens next after. The server page hands over plain
 * JSON; everything that changes goes through /api/field/survey.
 */

function HeaderTitle({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("field-header-title")), []);
  return slot ? createPortal(children, slot) : null;
}

function saveChip(state: SaveState, storageOk: boolean): { tone: "ok" | "busy" | "warn" | "bad"; text: string } {
  switch (state.kind) {
    case "saved":
      return storageOk ? { tone: "ok", text: "Saved" } : { tone: "warn", text: "Saved (not kept on this phone)" };
    case "saving":
    case "pending":
      return { tone: "busy", text: "Saving…" };
    case "offline":
      return storageOk ? { tone: "warn", text: "Offline, saved on this phone" } : { tone: "bad", text: "Offline, not saved" };
    case "conflict":
      return { tone: "bad", text: "Needs a decision" };
    case "frozen":
      return { tone: "ok", text: "Submitted" };
    case "error":
      return { tone: "bad", text: "Not saved" };
  }
}

function SaveChip({ state, storageOk }: { state: SaveState; storageOk: boolean }) {
  const chip = saveChip(state, storageOk);
  const tones = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
    busy: "border-sage-200 bg-sage-50 text-sage-700",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-800",
  };
  const dots = { ok: "bg-emerald-600", busy: "bg-sage-500 animate-pulse", warn: "bg-amber-500", bad: "bg-red-600" };
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[chip.tone]}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dots[chip.tone]}`} />
      {chip.text}
    </span>
  );
}

/** The sticky bar: back, where you are, the save state and the meter. */
function SurveyBar({
  title,
  back,
  pct,
  left,
  state,
  storageOk,
  uploading,
}: {
  title: string;
  back: { label: string; onClick?: () => void; href?: string };
  pct: number;
  left: number;
  state: SaveState;
  storageOk: boolean;
  uploading: number;
}) {
  const backEl = (
    <>
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      <span className="sr-only">{back.label}</span>
    </>
  );
  const backCls = "-ml-2 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-ink-900 hover:bg-surface";
  return (
    <div className="sticky top-14 z-30 -mx-4 mb-4 border-b border-line bg-cream/95 px-4 pb-2.5 pt-1.5 backdrop-blur">
      <div className="flex items-center gap-1">
        {back.href ? (
          <Link href={back.href} className={backCls}>
            {backEl}
          </Link>
        ) : (
          <button type="button" onClick={back.onClick} className={backCls}>
            {backEl}
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate font-display text-xl text-ink-900">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label="Survey completeness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface"
        >
          <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-600" : "bg-accent-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-700">{pct === 100 ? "All done" : `${pct}% · ${left} to do`}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SaveChip state={state} storageOk={storageOk} />
        {uploading > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sage-200 bg-sage-50 px-2.5 py-1 text-xs font-semibold text-sage-700">
            <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 13V3M4 7l4-4 4 4" />
            </svg>
            {uploading} photo{uploading === 1 ? "" : "s"} uploading
          </span>
        )}
      </div>
    </div>
  );
}

const SECTION_BLURB: Record<SurveySectionId, string> = {
  site: "Who decides, ownership, access and parking",
  wishes: "Priorities, heating use, timing",
  house: "Type, age, walls, loft, asbestos",
  rooms: "Measure each room, photos, pipe runs",
  outdoor: "Where the outdoor unit goes",
  electrics: "Fuse board, spare ways, cable route",
  permissions: "Permitted development checklist",
  risks: "Height, structure, hidden services",
};

function Overview({
  progress,
  data,
  consent,
  go,
  issues,
}: {
  progress: Record<SurveySectionId, { done: number; total: number }>;
  data: MeasuredSurvey;
  consent: boolean;
  go: (n: Nav) => void;
  issues: number;
}) {
  const item = (s: ScreenId, title: string, blurb: string, badge: ReactNode) => (
    <li key={s}>
      <button type="button" onClick={() => go({ s })} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-left hover:border-ink-300">
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold text-ink-900">{title}</span>
          <span className="block text-sm text-ink-500">{blurb}</span>
        </span>
        {badge}
        <span aria-hidden className="text-xl text-ink-500">
          ›
        </span>
      </button>
    </li>
  );
  const done = <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Done</span>;
  const todo = (n: number) => <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">{n} to do</span>;
  return (
    <div className="space-y-4">
      {issues > 0 && (
        <p role="status" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {issues} stop-work issue{issues === 1 ? "" : "s"} raised. The technical lead has it; carry on with the rest.
        </p>
      )}
      <ul className="space-y-2">
        {SURVEY_SECTIONS.map((s) => {
          const p = progress[s.id];
          const left = p.total - p.done;
          const blurb = s.id === "rooms" ? `${data.rooms.filter((r) => r.include).length} to survey · ${SECTION_BLURB.rooms.toLowerCase()}` : SECTION_BLURB[s.id];
          return item(s.id, s.label, blurb, left === 0 ? done : todo(left));
        })}
        {item(
          "assumptions",
          "Assumptions & unknowns",
          "What the design relies on, what's still open",
          <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-700">
            {data.assumptions.length + data.unknowns.length || "Optional"}
          </span>,
        )}
        {item(
          "consent",
          "Documents by email",
          "Ask before you leave",
          consent ? done : <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-700">Ask</span>,
        )}
      </ul>
      <button
        type="button"
        onClick={() => go({ s: "submit" })}
        className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-accent-700 px-6 text-lg font-semibold text-white shadow-sm hover:bg-accent-800"
      >
        Check and submit
      </button>
    </div>
  );
}

/** One section's still-to-do list, as jump links, under its title. */
function SectionTodo({ section, missing, roomId, positionId }: { section: SurveySectionId; missing: ReturnType<typeof surveyCompleteness>["missing"]; roomId?: string; positionId?: string }) {
  const mine = missing.filter((m) => m.sectionId === section && (roomId ? m.roomId === roomId : positionId ? m.positionId === positionId : true));
  if (mine.length === 0) {
    return <p className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Nothing left to do here.</p>;
  }
  return (
    <details className="group mb-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-950" open={mine.length <= 3}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {mine.length} thing{mine.length === 1 ? "" : "s"} to do here
        <span aria-hidden className="text-base transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="px-3 pb-3">
        <MissingList missing={mine} headings={false} />
      </div>
    </details>
  );
}

export function SurveyApp(props: VisitProps) {
  const { project: initialProject, self, smsMode, canOpenOps } = props;
  const projectId = initialProject.id;
  const [project, setProject] = useState(initialProject);
  // A draft the server prepared before the visit (no start yet) isn't started: "Start survey" starts it.
  const [draft, setDraft] = useState<ServerDraft | null>(props.draft && props.draft.record.status === "draft" && props.draft.record.startedAt ? props.draft : null);
  const [prepared, setPrepared] = useState<ServerDraft | null>(canStartOnPhone(props.draft) ? props.draft : null);
  // Started on this phone with no signal: the server hears as soon as there's signal.
  const [startPending, setStartPending] = useState(false);
  const [onMyWay, setOnMyWay] = useState<OnMyWayState | null>(props.onMyWay);
  const [sheet, setSheet] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ at?: string; minutes?: number | null; diff: VisitProps["diff"] } | null>(
    initialProject.survey.status === "submitted"
      ? { at: initialProject.survey.submittedAt, minutes: props.draft?.record.minutes ?? null, diff: props.diff }
      : null,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** Begin on the phone from the prepared draft; the server is told when there's signal. */
  const startOnPhone = useCallback(
    (ready: ServerDraft, at: string) => {
      setPendingStart(projectId, at);
      setStartPending(true);
      setDraft({ record: { ...ready.record, startedAt: at }, updatedAt: ready.updatedAt });
      setProject((p) => ({ ...p, survey: { ...p.survey, status: "in-progress", startedAt: p.survey.startedAt ?? at } }));
    },
    [projectId],
  );

  // Back on a page that was started on this phone (and not yet told): carry on from the prepared draft.
  useEffect(() => {
    const at = pendingStart(projectId);
    if (!at) return;
    if (prepared && !draft) startOnPhone(prepared, at);
    else if (draft) setStartPending(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the server about a start made with no signal: now, when signal returns, and every so often.
  useEffect(() => {
    if (!startPending) return;
    let stopped = false;
    const replay = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const r = await replayPendingStart(projectId);
      if (!stopped && r !== "kept") setStartPending(false);
    };
    void replay();
    window.addEventListener("online", replay);
    const t = window.setInterval(replay, 30_000);
    return () => {
      stopped = true;
      window.removeEventListener("online", replay);
      window.clearInterval(t);
    };
  }, [startPending, projectId]);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/field/survey/${projectId}/start`, { method: "POST", credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as { record?: ServerDraft["record"]; updatedAt?: string; error?: string };
      if (!res.ok || !body.record || !body.updatedAt) throw new Error(body.error ?? `Couldn't start (${res.status}).`);
      setDraft({ record: body.record, updatedAt: body.updatedAt });
      setProject((p) => ({ ...p, survey: { ...p.survey, status: "in-progress", startedAt: p.survey.startedAt ?? body.record!.startedAt } }));
    } catch (err) {
      const offline = !(err instanceof Error) || err.message === "Failed to fetch" || err.name === "TypeError";
      if (offline && prepared) {
        // No signal at the door: the draft is already on this phone, so start here.
        startOnPhone(prepared, new Date().toISOString());
      } else {
        setStartError(err instanceof Error && !offline ? err.message : "No signal, so the survey didn't start. Try again in a moment.");
      }
    } finally {
      setStarting(false);
    }
  };

  if (submitted) {
    return (
      <>
        <HeaderTitle>{project.customer.name || "Survey"}</HeaderTitle>
        <SubmittedScreen project={project} submittedAt={submitted.at} minutes={submitted.minutes} diff={submitted.diff} canOpenOps={canOpenOps} />
      </>
    );
  }

  if (project.survey.status === "not-booked") {
    return (
      <>
        <HeaderTitle>{project.customer.name || "Survey"}</HeaderTitle>
        <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
          <p className="font-semibold text-ink-900">This survey isn&apos;t booked yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">Once the office books a time, it shows here with everything you need for the visit.</p>
          <Link href="/field/survey" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-ink-900 px-6 font-semibold text-white">
            Back to surveys
          </Link>
        </div>
      </>
    );
  }

  if (!draft) {
    return (
      <>
        <HeaderTitle>{project.customer.name || "Survey"}</HeaderTitle>
        <VisitCard
          project={project}
          self={self}
          onMyWay={onMyWay}
          smsMode={smsMode}
          starting={starting}
          startError={startError}
          onStart={start}
          onOpenOnMyWay={() => setSheet(true)}
          resume={project.survey.status === "in-progress"}
        />
        {sheet && (
          <OnMyWaySheet
            projectId={projectId}
            phone={project.customer.phone}
            smsMode={smsMode}
            onClose={() => setSheet(false)}
            onSent={(state, ready) => {
              setOnMyWay(state);
              if (canStartOnPhone(ready)) setPrepared(ready!);
            }}
          />
        )}
      </>
    );
  }

  // The flow reads this phone's saved copy as it starts, so it only ever renders in the browser.
  if (!mounted) {
    return (
      <div aria-busy className="space-y-3">
        <HeaderTitle>{project.customer.name || "Survey"}</HeaderTitle>
        <div className="h-24 animate-pulse rounded-2xl bg-surface" />
        <div className="h-16 animate-pulse rounded-2xl bg-surface" />
        <div className="h-16 animate-pulse rounded-2xl bg-surface" />
        <p className="sr-only">Opening the survey…</p>
      </div>
    );
  }

  return (
    <>
      {startPending && (
        <p role="status" className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Started on this phone with no signal. Carry on: the office and the customer hear it&apos;s under way as soon as there&apos;s signal.
        </p>
      )}
      <SurveyFlow
        key={draft.record.id}
        {...props}
        project={project}
        setProject={setProject}
        draft={draft}
        onSubmitted={(s) => setSubmitted(s)}
      />
    </>
  );
}

function SurveyFlow({
  project,
  setProject,
  draft: initialDraft,
  self,
  media: initialMedia,
  issues: initialIssues,
  onSubmitted,
}: VisitProps & {
  draft: ServerDraft;
  setProject: (fn: (p: VisitProps["project"]) => VisitProps["project"]) => void;
  onSubmitted: (s: { at?: string; minutes?: number | null; diff: VisitProps["diff"] }) => void;
}) {
  const projectId = project.id;
  const draft = useSurveyDraft(projectId, initialDraft);
  const { nav, go } = useSurveyNav(`dih-survey-nav:${projectId}`);
  const [media, setMedia] = useState<Record<string, SurveyMediaItem>>(() => Object.fromEntries(initialMedia.map((m) => [m.id, m])));
  const [annotating, setAnnotating] = useState<{ id: string; title: string; tool?: ToolId; pending?: PendingPhoto } | null>(null);
  const [issues, setIssues] = useState(initialIssues);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const completeness = useMemo(() => surveyCompleteness(draft.data), [draft.data]);
  const progress = useMemo(() => sectionProgress(draft.data), [draft.data]);
  const update = draft.update;

  /* ---------------- photos ---------------- */

  // A drawing saved onto a stored photo: the media list takes the server's copy.
  const applySaved = useCallback((item: Pick<SurveyMediaItem, "id" | "annotations" | "annotationsVersion" | "locked"> & { url?: string | null }) => {
    setMedia((m) =>
      m[item.id]
        ? { ...m, [item.id]: { ...m[item.id]!, annotations: item.annotations, annotationsVersion: item.annotationsVersion, locked: item.locked, url: item.url ?? m[item.id]!.url } }
        : m,
    );
  }, []);

  /**
   * Save a drawing kept on the phone onto its photo. With no signal it stays
   * kept (the tile says "Drawing not saved yet") and goes when signal returns.
   */
  const pushDrawing = useCallback(
    async (item: Pick<SurveyMediaItem, "id" | "annotationsVersion">, annotations: SurveyMediaItem["annotations"]) => {
      const key = mediaDraftKey(item);
      try {
        const saved = await saveAnnotations(item, annotations);
        writeAnnotationDraft(key, null);
        applySaved(saved);
        return true;
      } catch {
        // Kept, and still to be saved: the tile says so, and the next time there's signal it goes.
        writeAnnotationDraft(key, annotations);
        markAnnotationToSave(key);
        return false;
      }
    },
    [applySaved],
  );

  /** Queued photo (local id) → its media id once uploaded, for a drawing saved after the upload landed. */
  const uploaded = useRef(new Map<string, string>());
  const mediaRef = useRef(media);
  mediaRef.current = media;

  const attach = useCallback(
    (target: PhotoTarget, item: UploadedMedia, localId?: string) => {
      setMedia((m) => ({ ...m, [item.id]: { ...item, source: item.source } as SurveyMediaItem }));
      if (localId) {
        uploaded.current.set(localId, item.id);
        // Drawn on while it waited to upload: it goes onto the photo now.
        const drawing = takeQueuedDrawing(localId);
        if (drawing) void pushDrawing(item, drawing);
      }
      update((m) => {
        if (target.kind === "room") {
          if (!m.rooms.some((r) => r.id === target.roomId)) return m;
          return { ...m, rooms: m.rooms.map((r) => (r.id === target.roomId ? { ...r, mediaIds: [...new Set([...r.mediaIds, item.id])] } : r)) };
        }
        if (target.kind === "outdoor") {
          if (!m.outdoor.positions.some((p) => p.id === target.positionId)) return m;
          return { ...m, outdoor: { ...m.outdoor, positions: m.outdoor.positions.map((p) => (p.id === target.positionId ? { ...p, mediaId: item.id } : p)) } };
        }
        return { ...m, electrics: { ...m.electrics, mediaIds: [...new Set([...m.electrics.mediaIds, item.id])] } };
      });
    },
    [update, pushDrawing],
  );
  const queue = usePhotoQueue({ projectId, onUploaded: attach });

  // Drawings kept on this phone to be saved (Save with no signal, or kept and closed): saved once
  // there's signal. "Online" alone isn't enough (one bar, weak Wi-Fi or a server error never fire
  // it), so they're also tried every 30 seconds while any wait, when the page comes back into
  // view, and before a submit; and the submit waits for them, like photos still uploading.
  const annotatingId = annotating?.id;
  const annotatingRef = useRef(annotatingId);
  annotatingRef.current = annotatingId;
  const [keptIds, setKeptIds] = useState<string[]>([]);
  const recountKept = useCallback(() => {
    const ids = Object.values(mediaRef.current)
      .filter((m) => !m.locked && drawingWaitingToSave(mediaDraftKey(m)) && readAnnotationDraft(mediaDraftKey(m)) !== null)
      .map((m) => m.id);
    setKeptIds((prev) => (prev.join("|") === ids.join("|") ? prev : ids));
    return ids;
  }, []);
  const pushing = useRef(new Set<string>());
  /** Try every kept drawing once (never two saves of one at a time); resolves to how many still wait. */
  const saveKeptDrawings = useCallback(async (): Promise<number> => {
    const tries: Promise<unknown>[] = [];
    for (const m of Object.values(mediaRef.current)) {
      const key = mediaDraftKey(m);
      if (m.locked || m.id === annotatingRef.current || pushing.current.has(key) || !drawingWaitingToSave(key)) continue;
      const kept = readAnnotationDraft(key);
      if (!kept) continue;
      pushing.current.add(key);
      tries.push(pushDrawing(m, kept).finally(() => pushing.current.delete(key)));
    }
    await Promise.all(tries);
    return recountKept().length;
  }, [pushDrawing, recountKept]);
  useEffect(() => {
    const resync = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      void saveKeptDrawings();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    resync();
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [saveKeptDrawings, annotatingId]);
  useEffect(() => {
    if (keptIds.length === 0) return;
    const t = window.setInterval(() => {
      if (typeof navigator === "undefined" || navigator.onLine !== false) void saveKeptDrawings();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [keptIds.length, saveKeptDrawings]);
  useEffect(() => {
    recountKept();
    window.addEventListener(ANNOTATION_DRAFT_EVENT, recountKept);
    window.addEventListener("storage", recountKept);
    return () => {
      window.removeEventListener(ANNOTATION_DRAFT_EVENT, recountKept);
      window.removeEventListener("storage", recountKept);
    };
  }, [recountKept, media, annotatingId]);
  const uploading = queue.items.filter((p) => p.status !== "failed").length;

  const detachPhoto = useCallback(
    (mediaId: string, target: PhotoTarget) =>
      update((m) => {
        if (target.kind === "room") return { ...m, rooms: m.rooms.map((r) => (r.id === target.roomId ? { ...r, mediaIds: r.mediaIds.filter((x) => x !== mediaId) } : r)) };
        if (target.kind === "outdoor")
          return {
            ...m,
            outdoor: {
              positions: m.outdoor.positions.map((p) => {
                if (p.id !== target.positionId || p.mediaId !== mediaId) return p;
                const { mediaId: _drop, ...rest } = p;
                return rest;
              }),
            },
          };
        return { ...m, electrics: { ...m.electrics, mediaIds: m.electrics.mediaIds.filter((x) => x !== mediaId) } };
      }),
    [update],
  );

  // Read URLs for photos taken this session last an hour: refresh them well before then.
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await fetch(`/api/media?projectId=${projectId}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { items?: SurveyMediaItem[] };
        setMedia((m) => {
          const next = { ...m };
          for (const item of body.items ?? []) if (item.contentType?.startsWith("image/")) next[item.id] = { ...next[item.id], ...item };
          return next;
        });
      } catch {
        // offline: the next refresh will do
      }
    };
    const t = window.setInterval(refresh, 25 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [projectId]);

  /* ---------------- issues ---------------- */

  const raiseIssue = useCallback(
    async (topic: SurveyIssueTopic, note: string) => {
      try {
        const res = await fetch(`/api/field/survey/${projectId}/issue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ topic, note }),
        });
        const body = (await res.json().catch(() => ({}))) as { issue?: { id: string; number: number }; error?: string };
        if (!res.ok || !body.issue) return { ok: false as const, error: body.error ?? `Couldn't raise it (${res.status}). Call the office.` };
        setIssues((i) => ({ ...i, [topic]: { id: body.issue!.id, number: body.issue!.number } }));
        return { ok: true as const, number: body.issue.number };
      } catch {
        return { ok: false as const, error: "No signal, so it wasn't raised. Don't carry on in that area; call the office." };
      }
    },
    [projectId],
  );

  /* ---------------- submit ---------------- */

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // A start made with no signal goes first, so the visit is under way (and timed) before it's submitted.
      if ((await replayPendingStart(projectId)) === "kept") throw new Error("Failed to fetch");
      // Drawings kept on this phone go before the survey does: after a submit nothing here sends them.
      const unsaved = await saveKeptDrawings();
      if (unsaved > 0) {
        throw new Error(
          `${unsaved} drawing${unsaved === 1 ? " isn't" : "s aren't"} saved yet, so the survey wasn't submitted. Try again when you have signal, or open the photo to save or discard it.`,
        );
      }
      const saved = await draft.flush();
      if (!saved && draft.state.kind === "conflict") throw new Error("Decide which copy to keep first (see the top of the screen).");
      const res = await fetch(`/api/field/survey/${projectId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ data: draft.data, expectedUpdatedAt: draft.token() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        submittedAt?: string;
        minutes?: number | null;
        error?: string;
        blockers?: { message: string; severity: string }[];
      };
      if (!res.ok) {
        const blocker = body.blockers?.find((b) => b.severity === "block");
        throw new Error(blocker ? `${body.error ?? "Not ready"}: ${blocker.message}` : (body.error ?? `Couldn't submit (${res.status}).`));
      }
      clearLocalDraft(projectId);
      setProject((p) => ({ ...p, survey: { ...p.survey, status: "submitted", submittedAt: body.submittedAt ?? new Date().toISOString() } }));
      onSubmitted({ at: body.submittedAt, minutes: body.minutes, diff: self ? diffSelfSurvey(self, draft.data) : null });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "No signal, so it didn't submit. Everything is saved on this phone: try again when you have signal.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- context ---------------- */

  const ctx: SurveyCtx = {
    projectId,
    project,
    self,
    data: draft.data,
    update,
    completeness,
    isMissing: (section, field, at) =>
      completeness.missing.some(
        (m) => m.sectionId === section && m.field === field && (at?.roomId ? m.roomId === at.roomId : true) && (at?.positionId ? m.positionId === at.positionId : true),
      ),
    media,
    queue,
    addPhotos: (files: File[], tag: PhotoTag, target: PhotoTarget) => void queue.add(files, tag, target),
    detachPhoto,
    // A queued photo (local id) can be drawn on too: the drawing waits for its upload.
    annotate: (id, title, tool) => {
      const pending = media[id] ? undefined : queue.items.find((p) => p.localId === id);
      setAnnotating({ id, title, tool, ...(pending ? { pending } : {}) });
    },
    nav,
    go,
    issues,
    raiseIssue,
  };

  /* ---------------- screens ---------------- */

  const room = nav.s === "rooms" && nav.r ? draft.data.rooms.find((r) => r.id === nav.r) : undefined;
  const position = nav.s === "outdoor" && nav.o ? draft.data.outdoor.positions.find((p) => p.id === nav.o) : undefined;
  const title = room ? room.name : position ? position.label || "Outdoor position" : nav.s === "overview" ? "Home survey" : SCREEN_LABEL[nav.s];
  const back =
    nav.s === "overview"
      ? { label: "Back to surveys", href: "/field/survey" }
      : room || (nav.s === "rooms" && nav.r)
        ? { label: "All rooms", onClick: () => go({ s: "rooms" }) }
        : position || (nav.s === "outdoor" && nav.o)
          ? { label: "All outdoor positions", onClick: () => go({ s: "outdoor" }) }
          : { label: "All sections", onClick: () => go({ s: "overview" }) };

  let screen: ReactNode;
  switch (nav.s) {
    case "overview":
      screen = (
        <Overview progress={progress} data={draft.data} consent={Boolean(project.documentsConsent)} go={go} issues={Object.keys(issues).length} />
      );
      break;
    case "site":
      screen = <SiteSection />;
      break;
    case "wishes":
      screen = <WishesSection />;
      break;
    case "house":
      screen = <HouseSection />;
      break;
    case "rooms":
      screen = nav.r ? <RoomEditor roomId={nav.r} /> : <RoomsSection />;
      break;
    case "outdoor":
      screen = nav.o ? <PositionEditor positionId={nav.o} /> : <OutdoorSection />;
      break;
    case "electrics":
      screen = <ElectricsSection />;
      break;
    case "permissions":
      screen = <PermissionsSection />;
      break;
    case "risks":
      screen = <RisksSection />;
      break;
    case "assumptions":
      screen = <AssumptionsSection />;
      break;
    case "consent":
      screen = (
        <ConsentSection
          consent={project.documentsConsent}
          onRecorded={(c, email) => setProject((p) => ({ ...p, documentsConsent: c, customer: { ...p.customer, ...(email ? { email } : {}) } }))}
        />
      );
      break;
    case "submit":
      screen = (
        <SubmitSection
          pendingPhotos={queue.items.length}
          keptDrawings={keptIds.filter((id) => media[id]).map((id) => ({ id, title: keptTitle(media[id]!, draft.data) }))}
          onSaveDrawings={saveKeptDrawings}
          onOpenDrawing={(id, title) => setAnnotating({ id, title })}
          consent={project.documentsConsent}
          onSubmit={submit}
          submitting={submitting}
          submitError={submitError}
        />
      );
      break;
  }

  const sectionId = (SURVEY_SECTIONS.map((s) => s.id) as string[]).includes(nav.s) ? (nav.s as SurveySectionId) : null;
  const c = project.customer;
  const maps = mapsLinks(c.addressLine, c.postcode);

  return (
    <SurveyContext.Provider value={ctx}>
      <HeaderTitle>{c.name || "Survey"}</HeaderTitle>
      <SurveyBar title={title} back={back} pct={completeness.pct} left={completeness.missing.length} state={draft.state} storageOk={draft.storageOk} uploading={uploading} />

      {draft.state.kind === "conflict" && draft.conflict && (
        <div role="alert" className="mb-4 space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-base font-semibold text-red-900">This survey was also changed somewhere else</p>
          <p className="text-sm text-red-900">
            Since this phone last saved, a different copy was saved (another phone or tab). Which do you want to keep? The other is replaced.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => draft.resolveConflict("phone")} className="min-h-12 rounded-full bg-ink-900 px-4 font-semibold text-white">
              Keep this phone&apos;s copy
            </button>
            <button type="button" onClick={() => draft.resolveConflict("server")} className="min-h-12 rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
              Use the saved copy
            </button>
          </div>
        </div>
      )}
      {draft.state.kind === "error" && (
        <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {draft.state.message}{" "}
          {draft.state.signedOut && (
            <a className="font-semibold underline" href={`/login?next=${encodeURIComponent(`/field/survey/${projectId}`)}`}>
              Sign in
            </a>
          )}
        </div>
      )}
      {draft.state.kind === "frozen" && (
        <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {draft.state.message}{" "}
          <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
      {!queue.persistent && uploading > 0 && (
        <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          This browser can&apos;t keep photos if the page closes. Keep it open until they&apos;ve uploaded.
        </p>
      )}

      {nav.s === "overview" && (
        <div className="mb-4 rounded-2xl border border-line bg-white p-4">
          <p className="text-base text-ink-900">
            {c.addressLine}, {c.postcode}
          </p>
          <p className="text-sm text-ink-500">Started {londonClock(initialDraft.record.startedAt ?? project.survey.startedAt)}{project.survey.surveyor ? ` · ${project.survey.surveyor.name}` : ""}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {c.phone ? (
              <a href={telHref(c.phone)} className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-white text-base font-semibold text-ink-900">
                Call {c.name.split(" ")[0] || "customer"}
              </a>
            ) : (
              <span className="inline-flex min-h-12 items-center justify-center rounded-full border border-dashed border-line text-sm text-ink-500">No phone on file</span>
            )}
            <a href={maps.google} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-white text-base font-semibold text-ink-900">
              Map
            </a>
          </div>
        </div>
      )}

      {sectionId && !room && !position && (nav.s !== "rooms" || !nav.r) && (nav.s !== "outdoor" || !nav.o) && (
        <SectionTodo section={sectionId} missing={completeness.missing} />
      )}
      {room && <SectionTodo section="rooms" missing={completeness.missing} roomId={room.id} />}
      {position && position.chosen && <SectionTodo section="outdoor" missing={completeness.missing} positionId={position.id} />}

      {screen}

      {annotating && media[annotating.id] && (
        <MediaAnnotator
          media={media[annotating.id]!}
          title={annotating.title}
          defaultTool={annotating.tool}
          onClose={() => setAnnotating(null)}
          onSaved={applySaved}
        />
      )}
      {annotating?.pending && (
        <PendingAnnotator
          photo={annotating.pending}
          title={annotating.title}
          tool={annotating.tool}
          onClose={() => setAnnotating(null)}
          onSave={async (list) => {
            const localId = annotating.pending!.localId;
            const mediaId = uploaded.current.get(localId);
            const item = mediaId ? mediaRef.current[mediaId] : undefined;
            // Uploaded while they drew: straight onto the photo (kept on the phone if that fails).
            if (item) await pushDrawing(item, list);
            else queueDrawing(localId, list);
          }}
        />
      )}
    </SurveyContext.Provider>
  );
}

/** What a kept drawing's photo is, for the submit screen: its room, else where it was taken. */
function keptTitle(m: SurveyMediaItem, data: MeasuredSurvey): string {
  const room = m.roomId ? data.rooms.find((r) => r.id === m.roomId)?.name : undefined;
  if (room) return `${room} photo`;
  return m.caption?.trim() || `${PHOTO_TAG_LABEL[m.tag] ?? "Photo"} photo`;
}

/**
 * The editor on a photo that hasn't uploaded yet: the phone's own copy, and
 * "Save" keeps the drawing on the phone until the photo lands (then it's
 * saved onto it). Saving never needs signal, so there's no separate kept
 * draft. The blob is the queue's, so it survives the upload.
 */
function PendingAnnotator({
  photo,
  title,
  tool,
  onSave,
  onClose,
}: {
  photo: PendingPhoto;
  title: string;
  tool?: ToolId;
  onSave: (annotations: SurveyMediaItem["annotations"]) => Promise<void>;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [initial] = useState(() => queuedDrawing(photo.localId) ?? []);
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [photo.blob]);
  if (!src) return null;
  return (
    <Annotator
      src={src}
      initial={initial}
      title={`${title} (uploading)`}
      defaultTool={tool}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
