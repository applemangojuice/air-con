"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EvidenceRecord, InstallJobV2, StepStatusRecord } from "@aircon/domain";
import { getFieldOutbox, LOCAL_MEDIA_PREFIX, type OutboxState, type QueueItem, type SyncOp } from "@/lib/field-outbox";
import { useFieldIdentity } from "./field-identity";

/**
 * React glue for the outbox: the live queue state, and the runsheet as the
 * phone sees it right now (the server's records, plus what's been
 * acknowledged since the page loaded, plus what's still waiting). Waiting
 * captures are marked so the screen can say "waiting to sync", never
 * "saved".
 */

const EMPTY: OutboxState = { items: [], online: true, syncing: false, durable: true, signedIn: null, acked: [] };

export function useOutboxState(): OutboxState {
  const [state, setState] = useState<OutboxState>(EMPTY);
  useEffect(() => getFieldOutbox().subscribe(setState), []);
  return state;
}

/** Re-read the page's server data shortly after the outbox lands something, so "saved" is the server's word. */
export function useRefreshOnSync(): void {
  const router = useRouter();
  const state = useOutboxState();
  const seen = useRef(0);
  useEffect(() => {
    if (state.acked.length <= seen.current) return;
    seen.current = state.acked.length;
    const t = window.setTimeout(() => router.refresh(), 600);
    return () => window.clearTimeout(t);
  }, [state.acked.length, router]);
}

/** Object URLs for photos still on the phone, by local id; made once, revoked when the page goes. */
const previews = new Map<string, string>();

export function rememberPreview(localId: string, blob: Blob): string {
  const existing = previews.get(localId);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  previews.set(localId, url);
  return url;
}

export function previewFor(mediaId: string | undefined, items: QueueItem[]): string | undefined {
  if (!mediaId?.startsWith(LOCAL_MEDIA_PREFIX)) return undefined;
  const local = mediaId.slice(LOCAL_MEDIA_PREFIX.length);
  const cached = previews.get(local);
  if (cached) return cached;
  const item = items.find((i) => i.id === local && i.media);
  return item?.media ? rememberPreview(local, item.media.blob) : undefined;
}

export interface MergedJob {
  job: InstallJobV2;
  /** Evidence ids still waiting on the phone. */
  waiting: Set<string>;
  /** What the server refused for good, with the reason: by spec id for captures, by `step:<id>` for outcomes. */
  refused: Map<string, string>;
  /** Spec id → the latest local photo preview URL (waiting or just landed). */
  previews: Map<string, string>;
}

function recordFromOp(op: Extract<SyncOp, { type: "evidence" }>, by: { id: string; name: string }): EvidenceRecord {
  return {
    id: op.id,
    specId: op.specId,
    at: op.at,
    by: by.name,
    byStaffId: by.id,
    ...(op.value !== undefined ? { value: op.value } : {}),
    ...(op.ref ? { ref: op.ref } : {}),
    ...(op.note ? { note: op.note } : {}),
    ...(op.mediaId ? { mediaId: op.mediaId } : {}),
    ...(op.gps ? { gps: op.gps } : {}),
  };
}

function statusFromOp(op: Extract<SyncOp, { type: "step-status" }>, by: { id: string; name: string }): StepStatusRecord {
  return {
    id: op.id,
    stepId: op.stepId,
    outcome: op.outcome,
    ...(op.reason ? { reason: op.reason } : {}),
    at: op.at,
    by: by.name,
    byStaffId: by.id,
  };
}

/** The server's job with this phone's acknowledged and waiting captures laid over it. */
export function useMergedJob(job: InstallJobV2 | null, me: { id: string; name: string }): MergedJob | null {
  const state = useOutboxState();
  // Every screen with a job on it says who's signed in, so captures are stamped with them (field-identity).
  useFieldIdentity(me);
  return useMemo(() => {
    if (!job) return null;
    const have = new Set(job.evidence.map((e) => e.id));
    const haveStatus = new Set(job.stepStatuses.map((s) => s.id).filter(Boolean));
    const evidence = [...job.evidence];
    const statuses = [...job.stepStatuses];
    const waiting = new Set<string>();
    const refused = new Map<string, string>();
    const previewsBySpec = new Map<string, string>();
    const add = (op: SyncOp, pending: boolean, item?: QueueItem) => {
      if (op.projectId !== job.projectId) return;
      if (op.type === "evidence" && !have.has(op.id)) {
        if (item?.state === "failed") {
          refused.set(op.specId, item.lastError ?? "Not saved.");
          return;
        }
        evidence.push(recordFromOp(op, op.by ?? me));
        have.add(op.id);
        if (pending) waiting.add(op.id);
        const url = previewFor(op.mediaId, state.items);
        if (url) previewsBySpec.set(op.specId, url);
      }
      if (op.type === "step-status" && !haveStatus.has(op.id)) {
        if (item?.state === "failed") {
          refused.set(`step:${op.stepId}`, item.lastError ?? "Not saved.");
          return;
        }
        statuses.push(statusFromOp(op, op.by ?? me));
        haveStatus.add(op.id);
        if (pending) waiting.add(op.id);
      }
    };
    for (const op of state.acked) add(op, false);
    for (const item of state.items) if (item.op) add(item.op, true, item);
    evidence.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { job: { ...job, evidence, stepStatuses: statuses }, waiting, refused, previews: previewsBySpec };
  }, [job, me, state.acked, state.items]);
}

/** Is everything waiting really on this phone? False: some of it is only in this page's memory (keep it open). */
export function useOutboxDurable(): boolean {
  const [durable, setDurable] = useState(true);
  useEffect(() => getFieldOutbox().subscribe((s) => setDurable(s.durable)), []);
  return durable;
}
