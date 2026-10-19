import type { MediaItem, PhotoTag } from "@aircon/domain";

/**
 * Browser side of project media (server: lib/media-server.ts, routes:
 * app/api/media). One call takes a File from a camera input to a recorded
 * MediaItem:
 *
 *   const item = await uploadMedia(file, { projectId, tag: "indoor-wall", source: "survey", roomId,
 *     onProgress: (p) => setProgress(p) });
 *
 * 1. Photos are re-encoded in the browser: at most 2048 px on the long
 *    side, JPEG at quality 0.82, orientation applied. That keeps uploads
 *    quick on a mobile connection and strips EXIF (including GPS). Anything
 *    the browser can't decode (HEIC outside Safari, PDFs, video) goes up as
 *    it is.
 * 2. POST /api/media for an upload URL and ticket.
 * 3. PUT the bytes, with progress, retried up to 3 times with backoff.
 * 4. POST /api/media/<id> with the ticket to record it (idempotent, retried).
 */

export interface UploadProgress {
  phase: "preparing" | "requesting" | "uploading" | "confirming" | "done";
  /** Bytes sent so far (uploading), else 0 or the total. */
  loaded: number;
  total: number;
  /** 1-based attempt of the current phase. */
  attempt: number;
}

export interface UploadMediaOptions {
  projectId: string;
  tag: PhotoTag;
  source: MediaItem["source"];
  roomId?: string;
  caption?: string;
  customerVisible?: boolean;
  /** Defaults to the File's name. */
  fileName?: string;
  /** Long-side ceiling in px. Default 2048. */
  maxDimension?: number;
  /** JPEG quality. Default 0.82. */
  quality?: number;
  /** Attempts per network step. Default 3. */
  attempts?: number;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

export type UploadedMedia = MediaItem & { url: string | null };

export class MediaUploadError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "MediaUploadError";
    this.status = status;
    this.retryable = retryable;
  }
}

export const MAX_DIMENSION = 2048;
export const JPEG_QUALITY = 0.82;

/** Types the browser can decode and we re-encode; the rest upload untouched. */
const RASTER = /^image\/(jpeg|jpg|png|webp|heic|heif|gif|bmp|avif)$/i;

export interface PreparedFile {
  blob: Blob;
  contentType: string;
  fileName: string;
  width?: number;
  height?: number;
}

/** Long side scaled to `max`, aspect kept, whole pixels, never upscaled. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const withExtension = (name: string, ext: string) => `${name.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "photo"}${ext}`;

/**
 * Downscale and re-encode a photo as JPEG. Falls back to the original when
 * the browser can't decode it (createImageBitmap or canvas unavailable, or
 * an unsupported format).
 */
export async function prepareImage(
  file: Blob,
  opts: { fileName?: string; maxDimension?: number; quality?: number } = {},
): Promise<PreparedFile> {
  const fileName = opts.fileName ?? ((file as File).name || "photo");
  const original: PreparedFile = { blob: file, contentType: file.type || "application/octet-stream", fileName };
  if (!RASTER.test(file.type) || typeof createImageBitmap !== "function" || typeof document === "undefined") return original;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitWithin(bitmap.width, bitmap.height, opts.maxDimension ?? MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    // JPEG has no transparency: paint white first so a PNG's clear areas don't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", opts.quality ?? JPEG_QUALITY));
    if (!blob) return original;
    return { blob, contentType: "image/jpeg", fileName: withExtension(fileName, ".jpg"), ...size };
  } catch {
    return original;
  } finally {
    bitmap?.close();
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new MediaUploadError("Upload cancelled.", null, false));
    const onAbort = () => {
      clearTimeout(t);
      reject(new MediaUploadError("Upload cancelled.", null, false));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** 500 ms, 1.5 s, 4.5 s… with a little jitter so a crew's phones don't retry in step. */
export function backoffMs(attempt: number): number {
  return Math.round(500 * 3 ** Math.max(0, attempt - 1) * (0.85 + Math.random() * 0.3));
}

const retryableStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

async function withRetry<T>(attempts: number, signal: AbortSignal | undefined, run: (attempt: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      return await run(attempt);
    } catch (err) {
      last = err;
      const retryable = err instanceof MediaUploadError ? err.retryable : true;
      if (!retryable || attempt >= attempts || signal?.aborted) break;
      await sleep(backoffMs(attempt), signal);
    }
  }
  throw last instanceof MediaUploadError ? last : new MediaUploadError("The upload didn't go through. Check your signal and try again.", null, true);
}

/** A small request that hasn't answered in this long is a dead connection: give up and retry. */
const REQUEST_TIMEOUT_MS = 30_000;
/** An upload with no progress for this long has stalled (one bar of signal that's gone): abort and retry. */
const STALL_TIMEOUT_MS = 60_000;
/** However slow, no single upload attempt runs longer than this. */
const UPLOAD_CAP_MS = 15 * 60_000;

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  // The caller's signal (a person cancelling) plus our own timeout (a dead connection, retried).
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), REQUEST_TIMEOUT_MS);
  const forward = () => own.abort();
  signal?.addEventListener("abort", forward, { once: true });
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: own.signal,
      credentials: "same-origin",
    });
  } catch {
    cleanup();
    throw new MediaUploadError("No connection. We'll keep trying.", null, !signal?.aborted);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  cleanup();
  if (!res.ok) throw new MediaUploadError(data.error ?? `Request failed (${res.status}).`, res.status, retryableStatus(res.status));
  return data;
}

/**
 * PUT with progress (XHR: fetch can't report upload progress). A retry that
 * finds the object already there means an earlier attempt landed: success.
 */
export function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  attempt: number,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolveOuter, rejectOuter) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    // No progress for a minute: the connection has stalled. Abort it (retryable), don't hang the queue.
    let stalled = false;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    };
    const done = () => {
      if (stall) clearTimeout(stall);
      signal?.removeEventListener("abort", abort);
    };
    const resolve = () => {
      done();
      resolveOuter();
    };
    const reject = (err: MediaUploadError) => {
      done();
      rejectOuter(err);
    };
    xhr.open("PUT", url);
    xhr.timeout = UPLOAD_CAP_MS;
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      watch();
      onProgress?.(e.loaded, e.lengthComputable ? e.total : blob.size);
    };
    xhr.onload = () => {
      const exists = xhr.status === 409 || (xhr.status === 400 && /already exists|duplicate/i.test(xhr.responseText));
      if ((xhr.status >= 200 && xhr.status < 300) || (attempt > 1 && exists)) {
        onProgress?.(blob.size, blob.size);
        resolve();
      } else {
        reject(new MediaUploadError(`The upload was refused (${xhr.status}).`, xhr.status, retryableStatus(xhr.status)));
      }
    };
    xhr.onerror = () => reject(new MediaUploadError("The connection dropped during the upload.", null, true));
    xhr.ontimeout = () => reject(new MediaUploadError("The upload timed out.", null, true));
    xhr.onabort = () =>
      reject(
        stalled
          ? new MediaUploadError("The upload stalled (no progress for a minute). It'll try again.", null, true)
          : new MediaUploadError("Upload cancelled.", null, false),
      );
    signal?.addEventListener("abort", abort, { once: true });
    watch();
    xhr.send(blob);
  });
}

interface StartedUpload {
  mediaId: string;
  signedUrl: string;
  path: string;
  ticket: string;
}

/** Prepare, request, upload, confirm. Resolves with the recorded item and a read URL. */
export async function uploadMedia(file: Blob, opts: UploadMediaOptions): Promise<UploadedMedia> {
  const attempts = opts.attempts ?? 3;
  const report = (phase: UploadProgress["phase"], loaded: number, total: number, attempt = 1) =>
    opts.onProgress?.({ phase, loaded, total, attempt });

  report("preparing", 0, file.size);
  const prepared = await prepareImage(file, {
    fileName: opts.fileName,
    maxDimension: opts.maxDimension,
    quality: opts.quality,
  });
  const total = prepared.blob.size;

  const started = await withRetry(attempts, opts.signal, (attempt) => {
    report("requesting", 0, total, attempt);
    return postJson<StartedUpload>(
      "/api/media",
      {
        projectId: opts.projectId,
        fileName: prepared.fileName,
        contentType: prepared.contentType,
        tag: opts.tag,
        source: opts.source,
        ...(opts.roomId ? { roomId: opts.roomId } : {}),
        ...(opts.caption ? { caption: opts.caption } : {}),
        ...(opts.customerVisible !== undefined ? { customerVisible: opts.customerVisible } : {}),
        ...(prepared.width ? { width: prepared.width, height: prepared.height } : {}),
      },
      opts.signal,
    );
  });

  await withRetry(attempts, opts.signal, (attempt) =>
    putWithProgress(
      started.signedUrl,
      prepared.blob,
      prepared.contentType,
      attempt,
      (loaded, size) => report("uploading", loaded, size, attempt),
      opts.signal,
    ),
  );

  const confirmed = await withRetry(attempts, opts.signal, (attempt) => {
    report("confirming", total, total, attempt);
    return postJson<{ item: UploadedMedia }>(`/api/media/${started.mediaId}`, { ticket: started.ticket }, opts.signal);
  });

  report("done", total, total);
  return confirmed.item;
}
