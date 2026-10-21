import { backoffMs, prepareImage } from "@/lib/media-client";

/**
 * A customer's photo, from their phone to a recorded media item, through
 * the portal's own routes (app/api/portal/<id>/uploads). The same shape as
 * lib/media-client.ts's staff upload: shrink and re-encode in the browser
 * (which also strips the location data), ask for an upload URL, PUT the
 * bytes, confirm. Each step retries on a patchy signal; nothing is shown
 * as attached until the server has recorded it.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class StepError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function retry<T>(attempts: number, run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await run();
    } catch (err) {
      last = err;
      if (err instanceof StepError && !err.retryable) break;
      if (i < attempts) await sleep(backoffMs(i));
    }
  }
  throw last instanceof Error ? last : new Error("That photo didn't upload. Check your signal and try again.");
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  } catch {
    throw new StepError("No connection. Trying again…", true);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new StepError(data.error ?? `That didn't work (${res.status}).`, res.status >= 500 || res.status === 429);
  return data;
}

/** PUT with progress. On a retry, "already there" means an earlier attempt landed: that's success. */
function put(url: string, blob: Blob, contentType: string, attempt: number, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => onProgress?.(e.lengthComputable ? e.loaded / e.total : 0);
    xhr.onload = () => {
      const exists = xhr.status === 409 || (xhr.status === 400 && /already exists|duplicate/i.test(xhr.responseText));
      if ((xhr.status >= 200 && xhr.status < 300) || (attempt > 1 && exists)) resolve();
      else reject(new StepError(`The upload was refused (${xhr.status}).`, xhr.status >= 500));
    };
    xhr.onerror = () => reject(new StepError("The connection dropped during the upload.", true));
    xhr.send(blob);
  });
}

export async function uploadPortalPhoto(
  projectId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; url: string | null }> {
  const prepared = await prepareImage(file, { fileName: file.name || "photo.jpg" });
  const base = `/api/portal/${projectId}/uploads`;
  const started = await retry(3, () =>
    post<{ mediaId: string; signedUrl: string; ticket: string }>(base, {
      fileName: prepared.fileName,
      contentType: prepared.contentType,
      ...(prepared.width ? { width: prepared.width, height: prepared.height } : {}),
    }),
  );
  let attempt = 0;
  await retry(3, () => put(started.signedUrl, prepared.blob, prepared.contentType, ++attempt, onProgress));
  const confirmed = await retry(3, () => post<{ item: { id: string; url: string | null } }>(`${base}/${started.mediaId}`, { ticket: started.ticket }));
  onProgress?.(1);
  return confirmed.item;
}
