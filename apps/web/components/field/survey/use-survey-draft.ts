"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MeasuredSurvey, SurveyRecord } from "@aircon/domain";
import { decideResume, readLocalDraft, retryDelayMs, sameSurvey, writeLocalDraft, type LocalDraft } from "./draft-store";

/**
 * The survey's autosave: every change goes to the phone at once and to the
 * server about a second later (PUT with the token it was based on). The
 * status is honest: "Saved" only once the server has acknowledged it.
 *
 * Failures never lose work: offline or a server error retries with backoff
 * (and the moment the phone is back online); a 409 whose server copy is
 * exactly what this phone last sent (the response was lost on the way
 * back) is adopted silently; any other 409 is a real conflict and the
 * person chooses which copy to keep.
 */

export type SaveState =
  | { kind: "saved"; at: string }
  | { kind: "saving" }
  | { kind: "pending" }
  | { kind: "offline" }
  | { kind: "error"; message: string; signedOut?: boolean }
  | { kind: "conflict" }
  | { kind: "frozen"; message: string };

export interface ServerDraft {
  record: SurveyRecord;
  updatedAt: string;
}

const DEBOUNCE_MS = 1000;

export function useSurveyDraft(projectId: string, initial: ServerDraft) {
  const recordId = initial.record.id;
  const [resume] = useState(() =>
    typeof window === "undefined"
      ? ({ use: "server" } as const)
      : decideResume(readLocalDraft(projectId), { recordId, token: initial.updatedAt, data: initial.record.data }),
  );
  const [data, setData] = useState<MeasuredSurvey>(() => (resume.use === "server" ? initial.record.data : resume.use === "phone" ? resume.data : resume.phone));
  const [state, setState] = useState<SaveState>(
    resume.use === "server" ? { kind: "saved", at: initial.updatedAt } : resume.use === "phone" ? { kind: "pending" } : { kind: "conflict" },
  );
  const [conflict, setConflict] = useState<ServerDraft | null>(resume.use === "conflict" ? initial : null);
  const [storageOk, setStorageOk] = useState(true);

  // Refs: the save loop reads the latest values without re-subscribing.
  const dataRef = useRef(data);
  const tokenRef = useRef(initial.updatedAt);
  const dirtyRef = useRef(resume.use !== "server");
  const inFlight = useRef<Promise<boolean> | null>(null);
  const lastSent = useRef<MeasuredSurvey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const conflictRef = useRef(resume.use === "conflict");
  const frozenRef = useRef(false);

  const persistLocal = useCallback(
    (next: MeasuredSurvey, dirty: boolean) => {
      const draft: LocalDraft = { recordId, baseToken: tokenRef.current, data: next, dirty, savedAt: new Date().toISOString() };
      setStorageOk(writeLocalDraft(projectId, draft));
    },
    [projectId, recordId],
  );

  const saveRef = useRef<(opts?: { keepalive?: boolean }) => Promise<boolean>>(async () => false);
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), ms);
  }, []);

  /** Push the current data to the server. Resolves true when the server holds it. */
  const saveNow = useCallback(async (opts: { keepalive?: boolean } = {}): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (conflictRef.current || frozenRef.current) return false;
    if (inFlight.current) {
      await inFlight.current;
      return dirtyRef.current ? saveNow(opts) : true;
    }
    if (!dirtyRef.current) return true;
    const sending = dataRef.current;
    lastSent.current = sending;
    setState({ kind: "saving" });
    const run = (async (): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(`/api/field/survey/${projectId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          keepalive: opts.keepalive === true,
          body: JSON.stringify({ data: sending, expectedUpdatedAt: tokenRef.current }),
        });
      } catch {
        attempts.current += 1;
        setState({ kind: "offline" });
        schedule(retryDelayMs(attempts.current));
        return false;
      }
      const body = (await res.json().catch(() => ({}))) as {
        updatedAt?: string;
        error?: string;
        conflict?: boolean;
        current?: ServerDraft;
      };
      if (res.ok && body.updatedAt) {
        attempts.current = 0;
        tokenRef.current = body.updatedAt;
        const changedSince = dataRef.current !== sending;
        dirtyRef.current = changedSince;
        persistLocal(dataRef.current, changedSince);
        setState(changedSince ? { kind: "pending" } : { kind: "saved", at: new Date().toISOString() });
        if (changedSince) schedule(DEBOUNCE_MS);
        return !changedSince;
      }
      if (res.status === 409 && body.conflict && body.current) {
        if (sameSurvey(body.current.record.data, sending) || sameSurvey(body.current.record.data, dataRef.current)) {
          // Our own earlier save landed but its answer was lost: carry on from it.
          tokenRef.current = body.current.updatedAt;
          const changedSince = !sameSurvey(body.current.record.data, dataRef.current);
          dirtyRef.current = changedSince;
          persistLocal(dataRef.current, changedSince);
          if (changedSince) {
            schedule(0);
            setState({ kind: "pending" });
          } else setState({ kind: "saved", at: new Date().toISOString() });
          return !changedSince;
        }
        conflictRef.current = true;
        setConflict(body.current);
        setState({ kind: "conflict" });
        return false;
      }
      if (res.status === 409) {
        frozenRef.current = true;
        setState({ kind: "frozen", message: body.error ?? "This survey can't be changed any more." });
        return false;
      }
      if (res.status === 401) {
        setState({ kind: "error", message: "You've been signed out. Sign in again to save; your changes are kept on this phone.", signedOut: true });
        return false;
      }
      if (res.status >= 500 || res.status === 429 || res.status === 408) {
        attempts.current += 1;
        setState({ kind: "offline" });
        schedule(retryDelayMs(attempts.current));
        return false;
      }
      setState({ kind: "error", message: body.error ?? `The survey couldn't be saved (${res.status}). Your changes are kept on this phone.` });
      return false;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [persistLocal, projectId, schedule]);
  saveRef.current = saveNow;

  /** Change the survey. The phone copy is written now; the server copy a moment later. */
  const update = useCallback(
    (fn: (m: MeasuredSurvey) => MeasuredSurvey) => {
      if (frozenRef.current) return;
      const next = fn(dataRef.current);
      if (next === dataRef.current) return;
      dataRef.current = next;
      dirtyRef.current = true;
      setData(next);
      persistLocal(next, true);
      if (!conflictRef.current) {
        setState((s) => (s.kind === "offline" || s.kind === "error" ? s : { kind: "pending" }));
        schedule(DEBOUNCE_MS);
      }
    },
    [persistLocal, schedule],
  );

  /** Settle a conflict: keep what's on this phone (overwriting), or take the saved copy. */
  const resolveConflict = useCallback(
    (keep: "phone" | "server") => {
      const server = conflict;
      if (!server) return;
      conflictRef.current = false;
      setConflict(null);
      tokenRef.current = server.updatedAt;
      if (keep === "server") {
        dataRef.current = server.record.data;
        dirtyRef.current = false;
        setData(server.record.data);
        persistLocal(server.record.data, false);
        setState({ kind: "saved", at: server.updatedAt });
      } else {
        dirtyRef.current = true;
        persistLocal(dataRef.current, true);
        setState({ kind: "pending" });
        schedule(0);
      }
    },
    [conflict, persistLocal, schedule],
  );

  // Kick off a save for changes carried over from last time.
  useEffect(() => {
    if (dirtyRef.current && !conflictRef.current) schedule(300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  // Back online: try straight away. Leaving the page: flush what's pending.
  useEffect(() => {
    const online = () => {
      if (dirtyRef.current) {
        attempts.current = 0;
        void saveNow();
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) void saveNow({ keepalive: true });
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", hide);
    };
  }, [saveNow]);

  return {
    data,
    update,
    state,
    conflict,
    resolveConflict,
    storageOk,
    /** Save now and wait (before submitting). */
    flush: () => saveNow(),
    /** The token the server copy is at (for submit). */
    token: () => tokenRef.current,
    isDirty: () => dirtyRef.current,
  };
}

export type SurveyDraft = ReturnType<typeof useSurveyDraft>;
