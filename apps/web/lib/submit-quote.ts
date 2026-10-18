import type { PhotoKind, Survey, SurveyPhoto } from "@aircon/domain";
import { CONSENT_VERSION } from "@/components/site/claims";
import { getPhotoFile } from "./photo-registry";
import { getAttribution } from "./analytics-client";
import type { QuoteDraft } from "./quote-draft";

export type SubmissionState =
  | { status: "saved"; id: string; emailed: boolean }
  | { status: "demo" }
  | { status: "out-of-area"; outcode: string }
  | { status: "error"; message?: string };

/**
 * Photos go straight to storage through short-lived signed URLs (big files
 * stay off our API routes), then the survey snapshot is saved. Photos are
 * normally uploaded the moment they're picked (uploadPhotoFile); this is the
 * retry for any that didn't make it. The server recomputes the price and
 * ignores photos without an uploaded copy, so a failed upload can't inflate
 * the confidence band.
 */
export async function submitQuote(
  draft: QuoteDraft,
  consents: { marketing: boolean },
): Promise<SubmissionState> {
  try {
    const survey = structuredClone(draft.survey);
    await uploadMissing(survey.rooms.flatMap((r) => r.photos));
    await uploadMissing(survey.outdoor.photos);
    await uploadMissing(survey.electrics.photos);

    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        survey,
        contact: draft.contact,
        draftId: draft.draftId,
        attribution: getAttribution(),
        consents: { operational: true, marketing: consents.marketing, version: CONSENT_VERSION },
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { demo?: boolean; id?: string; emailed?: boolean; error?: string; outcode?: string }
      | null;
    if (res.status === 422 && data?.error === "out-of-area") {
      return { status: "out-of-area", outcode: data.outcode ?? "" };
    }
    if (res.status === 429) return { status: "error", message: "Too many tries in a row. Give it a minute, then try again." };
    if (!res.ok || !data) return { status: "error" };
    return data.demo
      ? { status: "demo" }
      : { status: "saved", id: data.id ?? "", emailed: data.emailed ?? false };
  } catch {
    return { status: "error" };
  }
}

async function uploadMissing(photos: SurveyPhoto[]): Promise<void> {
  for (const photo of photos) {
    if (photo.storagePath) continue; // already uploaded
    const file = getPhotoFile(photo.id);
    if (!file) continue; // metadata restored from a previous session
    const result = await uploadPhotoFile(file, photo.kind);
    if (result.ok) photo.storagePath = result.path;
  }
}

export type UploadResult = { ok: true; path: string } | { ok: false; reason: "unconfigured" | "failed" };

/**
 * One survey photo to storage: shrunk on the phone first (a 6 MB camera
 * photo becomes a few hundred KB, which matters on one bar of signal), then
 * PUT to a signed URL from /api/uploads. "unconfigured" means the deployment
 * has no storage (demo mode): the photo stays on this device only.
 */
export async function uploadPhotoFile(file: File, kind: PhotoKind): Promise<UploadResult> {
  try {
    const body = await shrinkImage(file);
    const signRes = await fetch("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: jpegName(file.name, body !== file), kind }),
    });
    if (!signRes.ok) return { ok: false, reason: "failed" };
    const sign = (await signRes.json()) as { configured: boolean; path?: string; signedUrl?: string };
    if (!sign.configured) return { ok: false, reason: "unconfigured" };
    if (!sign.signedUrl || !sign.path) return { ok: false, reason: "failed" };
    const put = await fetch(sign.signedUrl, {
      method: "PUT",
      headers: { "content-type": body.type || "application/octet-stream" },
      body,
    });
    return put.ok ? { ok: true, path: sign.path } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

function jpegName(name: string, converted: boolean): string {
  const base = (name || "photo").replace(/\.[a-z0-9]+$/i, "") || "photo";
  return converted ? `${base}.jpg` : name || "photo.jpg";
}

/** Longest edge after shrinking: plenty for a surveyor to read a fuse board. */
const MAX_EDGE = 1600;

/**
 * Downscale a camera photo to a JPEG no larger than MAX_EDGE on its longest
 * side. Anything that can't be decoded here (an unusual format, an old
 * browser) goes up as the original file rather than not at all.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== "function" || !file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob && blob.size > 0 && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export type { Survey };
