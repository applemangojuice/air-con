/**
 * What each storage bucket accepts: a size ceiling per file and the content
 * types it stores. Supabase enforces these on the bucket itself
 * (`storage.buckets.file_size_limit` / `allowed_mime_types`, set by
 * migration 0011_storage_limits.sql, which tests/storage-buckets.test.ts
 * keeps in step with this file); the local backend enforces the same rules
 * in lib/db/local-storage.ts. The routes that mint upload URLs check the
 * type first, so a refusal is a clear answer rather than a failed PUT.
 *
 * Pure (no imports): the local backend and the browser's upload code use it.
 */

export interface BucketRule {
  maxBytes: number;
  contentTypes: readonly string[];
}

const MB = 1024 * 1024;

/** The funnel's survey photos (public, unauthenticated uploads). */
export const SURVEY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
/** The capture app's walkthrough videos. */
export const SURVEY_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
/**
 * Project media: the domain's MEDIA_UPLOAD_CONTENT_TYPES (photos, PDFs, short
 * phone videos), plus SVG, which only the system stores (generated drawings
 * and DEMO photos: media-server storeSystemMedia).
 */
export const PROJECT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "image/svg+xml",
] as const;

export const BUCKET_RULES: Record<string, BucketRule> = {
  "survey-photos": { maxBytes: 25 * MB, contentTypes: SURVEY_PHOTO_TYPES },
  "survey-videos": { maxBytes: 50 * MB, contentTypes: SURVEY_VIDEO_TYPES },
  "project-media": { maxBytes: 25 * MB, contentTypes: PROJECT_MEDIA_TYPES },
};

/** "Image/JPG; charset=x" → "image/jpeg". */
export function baseContentType(value: string | null | undefined): string {
  const base = (value ?? "").split(";")[0]!.trim().toLowerCase();
  return base === "image/jpg" ? "image/jpeg" : base;
}

/** May this bucket store this content type? Buckets without a rule take anything (as Supabase does). */
export function bucketAccepts(bucket: string, contentType: string | null | undefined): boolean {
  const rule = BUCKET_RULES[bucket];
  return !rule || rule.contentTypes.includes(baseContentType(contentType));
}

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "image/svg+xml": "svg",
};

/** The file extension that goes with a content type ("" for one we don't store). */
export function extensionFor(contentType: string): string {
  return EXTENSION[baseContentType(contentType)] ?? "";
}

/**
 * An object name whose extension is the content type's, whatever the
 * uploader called it: "Living room.HTML" as image/jpeg → "Living_room.jpg".
 */
export function storedFileName(fileName: string, contentType: string, fallback = "file"): string {
  const ext = extensionFor(contentType);
  const stem =
    String(fileName ?? "")
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]*$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || fallback;
  return ext ? `${stem}.${ext}` : stem;
}
