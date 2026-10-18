"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoTag } from "@aircon/domain";
import { MediaUploadError, uploadMedia, type UploadedMedia, type UploadProgress } from "@/lib/media-client";

/**
 * Photos waiting to upload, kept on the phone (IndexedDB) until the server
 * has them, so a photo taken in a loft with no signal, or just before the
 * battery dies, still arrives. One upload at a time, in the order taken;
 * failures wait and retry (straight away when the phone comes back online)
 * and can be retried by hand. Without IndexedDB (some private modes) the
 * queue still works, but only while the page stays open, and says so.
 */

/** Where the photo belongs in the survey once it's uploaded. */
export type PhotoTarget = { kind: "room"; roomId: string } | { kind: "outdoor"; positionId: string } | { kind: "electrics" };

export interface PendingPhoto {
  localId: string;
  projectId: string;
  blob: Blob;
  fileName: string;
  tag: PhotoTag;
  target: PhotoTarget;
  createdAt: string;
  status: "queued" | "uploading" | "failed";
  error?: string;
  progress?: number;
}

const DB_NAME = "dih-survey-photos";
const STORE = "uploads";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "localId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

type Stored = Omit<PendingPhoto, "status" | "progress" | "error"> & { status: "queued" | "failed"; error?: string };

const toStored = (p: PendingPhoto): Stored => ({
  localId: p.localId,
  projectId: p.projectId,
  blob: p.blob,
  fileName: p.fileName,
  tag: p.tag,
  target: p.target,
  createdAt: p.createdAt,
  status: p.status === "failed" ? "failed" : "queued",
  ...(p.error ? { error: p.error } : {}),
});

export interface PhotoQueueOptions {
  projectId: string;
  /** Called once per photo, when the server has recorded it. */
  onUploaded: (target: PhotoTarget, item: UploadedMedia, localId: string) => void;
}

export function usePhotoQueue({ projectId, onUploaded }: PhotoQueueOptions) {
  const [items, setItems] = useState<PendingPhoto[]>([]);
  const [persistent, setPersistent] = useState(true);
  const dbRef = useRef<IDBDatabase | null>(null);
  const itemsRef = useRef<PendingPhoto[]>([]);
  const running = useRef(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const aborts = useRef(new Map<string, AbortController>());

  const commit = useCallback((next: PendingPhoto[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (localId: string, change: Partial<PendingPhoto>) => commit(itemsRef.current.map((p) => (p.localId === localId ? { ...p, ...change } : p))),
    [commit],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((p) => p.status === "queued");
        if (!next) break;
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        patch(next.localId, { status: "uploading", progress: 0, error: undefined });
        const abort = new AbortController();
        aborts.current.set(next.localId, abort);
        try {
          const item = await uploadMedia(next.blob, {
            projectId: next.projectId,
            tag: next.tag,
            source: "survey",
            ...(next.target.kind === "room" ? { roomId: next.target.roomId } : {}),
            fileName: next.fileName,
            signal: abort.signal,
            onProgress: (p: UploadProgress) => {
              if (p.phase === "uploading" && p.total > 0) patch(next.localId, { progress: Math.round((p.loaded / p.total) * 100) });
            },
          });
          failures.current = 0;
          if (dbRef.current) await tx(dbRef.current, "readwrite", (s) => s.delete(next.localId));
          commit(itemsRef.current.filter((p) => p.localId !== next.localId));
          onUploadedRef.current(next.target, item, next.localId);
        } catch (err) {
          if (!itemsRef.current.some((p) => p.localId === next.localId)) continue; // removed while uploading
          const message =
            err instanceof MediaUploadError ? err.message : "The upload didn't go through. Check your signal and try again.";
          const retryable = !(err instanceof MediaUploadError) || err.retryable;
          patch(next.localId, { status: "failed", error: message, progress: undefined });
          const failed = itemsRef.current.find((p) => p.localId === next.localId);
          if (dbRef.current && failed) await tx(dbRef.current, "readwrite", (s) => s.put(toStored(failed)));
          if (retryable) {
            failures.current += 1;
            const wait = Math.min(60_000, 5_000 * 2 ** Math.min(4, failures.current - 1));
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => retryAllRef.current(), wait);
          }
          break;
        } finally {
          aborts.current.delete(next.localId);
        }
      }
    } finally {
      running.current = false;
    }
  }, [commit, patch]);

  const retryAll = useCallback(() => {
    commit(itemsRef.current.map((p) => (p.status === "failed" ? { ...p, status: "queued", error: undefined } : p)));
    void pump();
  }, [commit, pump]);
  const retryAllRef = useRef(retryAll);
  retryAllRef.current = retryAll;

  const retry = useCallback(
    (localId: string) => {
      patch(localId, { status: "queued", error: undefined });
      void pump();
    },
    [patch, pump],
  );

  /** Queue photos for a place in the survey. Kept on the phone first, then uploaded. */
  const add = useCallback(
    async (files: File[], tag: PhotoTag, target: PhotoTarget) => {
      const now = new Date().toISOString();
      const fresh: PendingPhoto[] = files.map((f, i) => ({
        localId: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        blob: f,
        fileName: f.name || "photo.jpg",
        tag,
        target,
        createdAt: now,
        status: "queued",
      }));
      commit([...itemsRef.current, ...fresh]);
      if (dbRef.current) for (const p of fresh) await tx(dbRef.current, "readwrite", (s) => s.put(toStored(p)));
      void pump();
    },
    [commit, projectId, pump],
  );

  /** Drop a photo that hasn't uploaded yet (stops it if it's on its way). */
  const remove = useCallback(
    async (localId: string) => {
      aborts.current.get(localId)?.abort();
      commit(itemsRef.current.filter((p) => p.localId !== localId));
      if (dbRef.current) await tx(dbRef.current, "readwrite", (s) => s.delete(localId));
    },
    [commit],
  );

  // Pick up anything left from last time, for this project.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await openDb();
      if (cancelled) return;
      dbRef.current = db;
      setPersistent(Boolean(db));
      if (!db) return;
      const stored = ((await tx(db, "readonly", (s) => s.getAll())) ?? []) as Stored[];
      const mine = stored.filter((p) => p.projectId === projectId && p.blob instanceof Blob);
      if (mine.length === 0 || cancelled) return;
      const known = new Set(itemsRef.current.map((p) => p.localId));
      commit([...itemsRef.current, ...mine.filter((p) => !known.has(p.localId)).map((p) => ({ ...p, status: "queued" as const }))]);
      void pump();
    })();
    const online = () => retryAll();
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      window.removeEventListener("online", online);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [commit, projectId, pump, retryAll]);

  return { items, add, retry, retryAll, remove, persistent };
}

export type PhotoQueue = ReturnType<typeof usePhotoQueue>;

export const sameTarget = (a: PhotoTarget, b: PhotoTarget) =>
  a.kind === b.kind &&
  (a.kind !== "room" || a.roomId === (b as { roomId: string }).roomId) &&
  (a.kind !== "outdoor" || a.positionId === (b as { positionId: string }).positionId);
