"use client";

import { createContext, useContext } from "react";
import type { MeasuredSurvey, PhotoTag, Survey, SurveyCompleteness, SurveySectionId } from "@aircon/domain";
import type { ToolId } from "@/components/annotate/annotator";
import type { Nav } from "./nav";
import type { PhotoQueue, PhotoTarget } from "./photo-queue";
import type { SurveyIssueTopic, SurveyMediaItem, VisitProject } from "./types";

/** What every survey screen needs, handed down once by SurveyApp. */
export interface SurveyCtx {
  projectId: string;
  project: VisitProject;
  self: Survey | null;
  data: MeasuredSurvey;
  update: (fn: (m: MeasuredSurvey) => MeasuredSurvey) => void;
  completeness: SurveyCompleteness;
  /** Is this field still to do (in this room or outdoor position)? */
  isMissing: (section: SurveySectionId, field: string, at?: { roomId?: string; positionId?: string }) => boolean;
  media: Record<string, SurveyMediaItem>;
  queue: PhotoQueue;
  addPhotos: (files: File[], tag: PhotoTag, target: PhotoTarget) => void;
  /** Detach a photo from its place in the survey (the media row stays). */
  detachPhoto: (mediaId: string, target: PhotoTarget) => void;
  annotate: (mediaId: string, title: string, tool?: ToolId) => void;
  nav: Nav;
  go: (nav: Nav) => void;
  issues: Partial<Record<SurveyIssueTopic, { id: string; number: number }>>;
  raiseIssue: (topic: SurveyIssueTopic, note: string) => Promise<{ ok: true; number: number } | { ok: false; error: string }>;
}

export const SurveyContext = createContext<SurveyCtx | null>(null);

export function useSurvey(): SurveyCtx {
  const ctx = useContext(SurveyContext);
  if (!ctx) throw new Error("useSurvey outside SurveyApp");
  return ctx;
}

/** Replace one room by id. */
export const withRoom = (m: MeasuredSurvey, id: string, fn: (r: MeasuredSurvey["rooms"][number]) => MeasuredSurvey["rooms"][number]): MeasuredSurvey => ({
  ...m,
  rooms: m.rooms.map((r) => (r.id === id ? fn(r) : r)),
});

/** Replace one outdoor position by id. */
export const withPosition = (
  m: MeasuredSurvey,
  id: string,
  fn: (p: MeasuredSurvey["outdoor"]["positions"][number]) => MeasuredSurvey["outdoor"]["positions"][number],
): MeasuredSurvey => ({
  ...m,
  outdoor: { ...m.outdoor, positions: m.outdoor.positions.map((p) => (p.id === id ? fn(p) : p)) },
});

/** Set or clear an optional key (an empty string or undefined clears it). */
export function setOpt<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined | ""): T {
  const next = { ...obj };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value as T[K];
  return next;
}
