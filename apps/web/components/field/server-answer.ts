"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Blocker } from "@aircon/domain";
import { withHeaderState } from "./answers";
import type { FieldHeaderState, FieldJob } from "./types";

/**
 * Field screens and the server's answer.
 *
 * A step that changes something (publish the pack, the family's sign-off,
 * commissioning, a target, an exception) shows its result from the server's
 * own answer to that request, at once, and only then re-reads the page in
 * the background. Nothing waits for the re-read: on Next 15.5 an in-place
 * refresh (router.refresh) can stall for good when its RSC payload arrives
 * in pieces, so the old screen stays up (the pack published, the sign-off
 * still greyed out) with nothing to say why. Seen at handover on the
 * Supabase-shaped stack, and reproduced with the gateway slowed down
 * (supabase/tests/compat/run-handover-loop.sh); the proposal builder hit
 * the same thing (components/ops/proposal/reload.ts).
 *
 * So every field route that changes the job answers with the job's header
 * as it now stands (`header`, versioned by the project's event count), the
 * screen records it here (answerHeader), and every field screen reads its
 * header through useFieldJob: the newer of the page's data and the answer.
 * A refresh that set off before the step and lands after it can't take
 * the screen backwards; one that lands later takes over again. The catch-up
 * refreshes then run one at a time (CatchUpRunner), since overlapping
 * in-place refreshes are what stalls.
 */

export type Answer<T> = { ok: true; data: T } | { ok: false; error: string; blockers?: Blocker[]; status?: number; offline?: true };

/** How long a field request may take before the phone says it got no reply (the outbox's limit too). */
export const REPLY_TIMEOUT_MS = 30_000;

/**
 * POST JSON and read the answer. Never throws and never hangs: no signal,
 * or no reply within REPLY_TIMEOUT_MS, comes back as `offline` with
 * `offlineText`, and the caller says the step may not have happened (every
 * step here is safe to send again).
 */
export async function postAnswer<T = Record<string, unknown>>(url: string, body: unknown, offlineText: string): Promise<Answer<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: controller.signal });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; blockers?: Blocker[] };
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `That didn't work (${res.status}).`, ...(data.blockers ? { blockers: data.blockers } : {}) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: offlineText, offline: true };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Answered headers                                                    */
/* ------------------------------------------------------------------ */

const answered = new Map<string, FieldHeaderState>();
const headerListeners = new Set<() => void>();

/** A field route's answer: this job's header as the server now has it. Older answers are ignored. */
export function answerHeader(projectId: string, state: FieldHeaderState | null | undefined): void {
  if (!state || typeof state.version !== "number") return;
  const had = answered.get(projectId);
  if (had && had.version >= state.version) return;
  answered.set(projectId, state);
  headerListeners.forEach((l) => l());
}

function subscribeHeaders(listener: () => void): () => void {
  headerListeners.add(listener);
  return () => headerListeners.delete(listener);
}

/** The page's field data with the newest answered header for its job laid over it. */
export function useFieldJob<T extends FieldJob>(data: T): T {
  const projectId = data.header.projectId;
  const state = useSyncExternalStore(
    subscribeHeaders,
    () => answered.get(projectId),
    () => undefined,
  );
  return useMemo(() => {
    const header = withHeaderState(data.header, state);
    return header === data.header ? data : { ...data, header };
  }, [data, state]);
}

/* ------------------------------------------------------------------ */
/* Catch-up refreshes, one at a time                                   */
/* ------------------------------------------------------------------ */

/** A refresh still not on screen after this long has stalled: the next catch-up doesn't wait for it. */
const STALLED_MS = 15_000;
let wanted = false;
const catchUpListeners = new Set<() => void>();

/**
 * Re-read the page's server data in the background, for whatever else on
 * the screen follows from a change (or a sync). The screen must already
 * show the change from the answer: this is a catch-up, never the thing it
 * waits on. Asked for again while one is running, it runs once more after.
 */
export function requestCatchUp(): void {
  wanted = true;
  catchUpListeners.forEach((l) => l());
}

export function useCatchUp(): () => void {
  return requestCatchUp;
}

/**
 * Mounted once in the field shell: runs the catch-up refreshes one at a
 * time, inside a transition so it knows when each is on screen.
 */
export function CatchUpRunner(): null {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);
  const startedAt = useRef(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    catchUpListeners.add(listener);
    if (wanted) listener();
    return () => {
      catchUpListeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!wanted) return;
    const waited = Date.now() - startedAt.current;
    if (pending && waited < STALLED_MS) {
      // Ask again once the running one has had its time (pending going false re-runs this sooner).
      const t = window.setTimeout(() => setTick((n) => n + 1), STALLED_MS - waited + 50);
      return () => window.clearTimeout(t);
    }
    wanted = false;
    startedAt.current = Date.now();
    startTransition(() => router.refresh());
  }, [tick, pending, router]);
  // While a catch-up is on its way (the handover loop, scripts/e2e-handover-loop.mjs, reads it).
  useEffect(() => {
    document.documentElement.toggleAttribute("data-catching-up", pending);
  }, [pending]);
  return null;
}
