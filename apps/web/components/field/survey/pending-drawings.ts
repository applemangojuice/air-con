import { validateAnnotations, type Annotation } from "@aircon/domain";
import { ANNOTATION_DRAFT_EVENT } from "@/components/annotate/annotator";

/**
 * Drawings made on a photo that hasn't uploaded yet (a loft with no
 * signal): kept in this browser against the photo's local id, then saved
 * onto the real photo the moment its upload lands (survey-app's attach).
 * localStorage, so a reload keeps them like the photo queue keeps the photo.
 */

const key = (localId: string) => `dih-annotate-queued:${localId}`;

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Keep a drawing for a queued photo (null forgets it). */
export function queueDrawing(localId: string, annotations: Annotation[] | null, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    if (annotations === null || annotations.length === 0) store.removeItem(key(localId));
    else store.setItem(key(localId), JSON.stringify({ annotations, at: new Date().toISOString() }));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ANNOTATION_DRAFT_EVENT));
  } catch {
    // storage full or blocked: nothing more we can do on the phone
  }
}

/** The drawing waiting for this photo, if any. */
export function queuedDrawing(localId: string, store: Storage | null = storage()): Annotation[] | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key(localId));
    if (!raw) return null;
    const list = validateAnnotations((JSON.parse(raw) as { annotations?: unknown }).annotations);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/** Take (read and forget) the drawing waiting for this photo. */
export function takeQueuedDrawing(localId: string, store: Storage | null = storage()): Annotation[] | null {
  const list = queuedDrawing(localId, store);
  if (list) queueDrawing(localId, null, store);
  return list;
}
