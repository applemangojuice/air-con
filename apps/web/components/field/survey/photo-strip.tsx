"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PHOTO_TAG_LABEL, type PhotoTag } from "@aircon/domain";
import { AnnotatedImage } from "@/components/annotate/annotated-image";
import { MissingTag, fieldId } from "./controls";
import type { PendingPhoto } from "./photo-queue";
import type { SurveyMediaItem } from "./types";

/**
 * Photos for one place in the survey (a room, an outdoor spot, the fuse
 * board): take one with the camera (or pick from the phone), watch it
 * upload, retry if it fails, tap to mark it up. A photo is only shown as
 * done once the server has it.
 */

function PendingThumb({ photo, onRetry, onRemove }: { photo: PendingPhoto; onRetry: () => void; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo.blob]);
  const failed = photo.status === "failed";
  const waiting = photo.status === "queued";
  return (
    <li className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
        {url && <img src={url} alt="Photo waiting to upload" className={`h-full w-full object-cover ${failed ? "opacity-60" : "opacity-80"}`} />}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-ink-950/75 px-2 py-1.5 text-xs font-semibold text-white">
        {failed ? (
          <span className="block">Not uploaded</span>
        ) : waiting ? (
          <span className="block">Waiting to upload</span>
        ) : (
          <>
            <span className="block">Uploading {photo.progress ?? 0}%</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full bg-white" style={{ width: `${photo.progress ?? 0}%` }} />
            </span>
          </>
        )}
      </div>
      {failed && (
        <div className="absolute inset-x-0 top-0 flex gap-1 p-1">
          <button type="button" onClick={onRetry} className="min-h-11 flex-1 rounded-full bg-white text-sm font-semibold text-ink-900 shadow">
            Retry
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this photo"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white text-ink-900 shadow"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The whole photo with its drawing, letterboxed in a square tile: never
 * cropped, so the drawing stays exactly over what it marks.
 */
export function Thumb({ item }: { item: SurveyMediaItem }) {
  const portrait = item.width && item.height ? item.height > item.width : false;
  const widthPct = portrait && item.width && item.height ? (item.width / item.height) * 100 : 100;
  return (
    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-line bg-ink-950/5">
      <div style={{ width: `${widthPct}%` }}>
        <AnnotatedImage
          src={item.url}
          annotations={item.annotations}
          width={item.width}
          height={item.height}
          labels={false}
          alt={PHOTO_TAG_LABEL[item.tag]}
          className="[&>div]:rounded-none"
        />
      </div>
    </div>
  );
}

export function PhotoStrip({
  legend,
  hint,
  field = "photos",
  mediaIds,
  media,
  pending,
  tags,
  single = false,
  missing,
  onAdd,
  onRemove,
  onRetry,
  onRemovePending,
  onAnnotate,
}: {
  legend: string;
  hint?: string;
  field?: string;
  mediaIds: string[];
  media: Record<string, SurveyMediaItem>;
  pending: PendingPhoto[];
  /** The kinds of photo offered here, the first being the usual one. */
  tags: PhotoTag[];
  /** One photo only (a new one replaces it). */
  single?: boolean;
  missing?: boolean;
  onAdd: (files: File[], tag: PhotoTag) => void;
  onRemove: (mediaId: string) => void;
  onRetry: (localId: string) => void;
  onRemovePending: (localId: string) => void;
  onAnnotate: (mediaId: string) => void;
}) {
  const id = useId();
  const [tag, setTag] = useState<PhotoTag>(tags[0] ?? "other");
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const pick = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || f.type === "");
    if (files.length) onAdd(single ? files.slice(0, 1) : files, tag);
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  };

  const attached = mediaIds.map((m) => media[m]).filter((m): m is SurveyMediaItem => Boolean(m));
  const unknown = mediaIds.length - attached.length;
  const busy = pending.some((p) => p.status !== "failed");

  return (
    <section id={fieldId(field)} tabIndex={-1} aria-labelledby={`${id}-legend`} className="min-w-0 scroll-mt-40 outline-none">
      <h4 id={`${id}-legend`} className="mb-1 text-base font-semibold text-ink-900">
        {legend}
        {missing && attached.length === 0 && pending.length === 0 && <MissingTag />}
      </h4>
      {hint && <p className="mb-2 text-sm text-ink-500">{hint}</p>}

      {tags.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Kind of photo"
          className="-mr-4 mb-2 flex snap-x gap-2 overflow-x-auto pb-1 pr-4 [mask-image:linear-gradient(to_right,black_85%,transparent)]"
        >
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tag === t}
              onClick={() => setTag(t)}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold transition ${tag === t ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-700"}`}
            >
              {PHOTO_TAG_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {(attached.length > 0 || pending.length > 0 || unknown > 0) && (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {attached.map((m) => (
            <li key={m.id} className="relative">
              <button
                type="button"
                onClick={() => onAnnotate(m.id)}
                className="block w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                aria-label={`${PHOTO_TAG_LABEL[m.tag] ?? "Photo"}: ${m.locked ? "view the approved drawing" : "mark it up"}`}
              >
                <Thumb item={m} />
                <span className="mt-1 block truncate px-0.5 text-xs text-ink-700">{PHOTO_TAG_LABEL[m.tag]}</span>
                <span className="block px-0.5 text-sm font-semibold text-accent-700">{m.locked ? "Locked" : m.annotations.length ? "Edit drawing" : "Mark up"}</span>
              </button>
              {!m.locked && (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(m.id)}
                  aria-label="Remove this photo from the survey"
                  className="absolute right-0 top-0 inline-flex h-11 w-11 items-start justify-end p-1.5"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink-950/75 text-white shadow">
                    <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </span>
                </button>
              )}
            </li>
          ))}
          {pending.map((p) => (
            <PendingThumb key={p.localId} photo={p} onRetry={() => onRetry(p.localId)} onRemove={() => onRemovePending(p.localId)} />
          ))}
          {unknown > 0 && (
            <li className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-line p-2 text-center text-xs text-ink-500">
              {unknown} photo{unknown === 1 ? "" : "s"} saved (not shown here)
            </li>
          )}
        </ul>
      )}

      {confirmRemove && (
        <div role="alertdialog" aria-label="Remove photo" className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">Remove this photo from the survey?</p>
          <p className="mt-0.5 text-sm text-amber-900">It stays in the project&apos;s photos; it just won&apos;t count here.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmRemove(null)} className="min-h-12 rounded-full border border-line bg-white font-semibold text-ink-900">
              Keep it
            </button>
            <button
              type="button"
              onClick={() => {
                onRemove(confirmRemove);
                setConfirmRemove(null);
              }}
              className="min-h-12 rounded-full bg-red-700 font-semibold text-white"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label
          htmlFor={`${id}-camera`}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-4 text-base font-semibold text-white shadow-sm hover:bg-ink-950 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-500"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          {single && (attached.length > 0 || pending.length > 0) ? "Retake" : attached.length || pending.length ? "Take another" : "Take photo"}
          <input
            ref={cameraRef}
            id={`${id}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            multiple={!single}
            className="sr-only"
            onChange={(e) => pick(e.target.files)}
          />
        </label>
        <label
          htmlFor={`${id}-library`}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-line bg-white px-4 text-base font-semibold text-ink-900 hover:bg-surface focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-500"
        >
          Choose photo
          <input
            ref={libraryRef}
            id={`${id}-library`}
            type="file"
            accept="image/*"
            multiple={!single}
            className="sr-only"
            onChange={(e) => pick(e.target.files)}
          />
        </label>
      </div>
      {busy && <p className="mt-2 text-sm text-ink-500">Uploading in the background; carry on.</p>}
    </section>
  );
}
