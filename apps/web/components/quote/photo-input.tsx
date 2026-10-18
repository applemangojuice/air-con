"use client";

import { useId, useRef, useState } from "react";
import type { PhotoKind, SurveyPhoto } from "@aircon/domain";
import { getPhotoFile, getPhotoPreview, registerPhotoFile, releasePhoto } from "@/lib/photo-registry";
import { uploadPhotoFile } from "@/lib/submit-quote";

type UploadState = "uploading" | "failed" | "local";

/**
 * Mobile-first photo capture: the camera on phones (capture="environment"),
 * the file picker on desktop. Each photo uploads the moment it's picked, so
 * a refresh or a dropped tab doesn't lose it, and shows its real state:
 * uploading, saved, or "didn't upload" with a retry. Nothing says saved
 * until storage has it.
 */
export function PhotoInput({
  kind,
  label,
  hint,
  photos,
  onChange,
  onUploaded,
}: {
  kind: PhotoKind;
  label: string;
  hint?: string;
  photos: SurveyPhoto[];
  onChange: (photos: SurveyPhoto[]) => void;
  /** Called once storage has the photo; the parent records the path on it. */
  onUploaded: (photoId: string, storagePath: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [state, setState] = useState<Record<string, UploadState>>({});
  const [announce, setAnnounce] = useState("");
  const mine = photos.filter((p) => p.kind === kind);

  async function upload(photoId: string) {
    const file = getPhotoFile(photoId);
    if (!file) return;
    setState((s) => ({ ...s, [photoId]: "uploading" }));
    setAnnounce("Uploading photo…");
    const result = await uploadPhotoFile(file, kind);
    if (result.ok) {
      onUploaded(photoId, result.path);
      setState((s) => {
        const next = { ...s };
        delete next[photoId];
        return next;
      });
      setAnnounce("Photo saved.");
    } else if (result.reason === "unconfigured") {
      setState((s) => ({ ...s, [photoId]: "local" }));
      setAnnounce("Photo added.");
    } else {
      setState((s) => ({ ...s, [photoId]: "failed" }));
      setAnnounce("That photo didn't upload. Check your signal and tap retry.");
    }
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const added: SurveyPhoto[] = Array.from(list)
      .filter((file) => file.type === "" || file.type.startsWith("image/"))
      .slice(0, 6)
      .map((file) => {
        const { id: photoId } = registerPhotoFile(file);
        return { id: photoId, kind, fileName: file.name };
      });
    if (inputRef.current) inputRef.current.value = "";
    if (added.length === 0) return;
    onChange([...photos, ...added]);
    for (const p of added) void upload(p.id);
  }

  function remove(photoId: string) {
    releasePhoto(photoId);
    setState((s) => {
      const next = { ...s };
      delete next[photoId];
      return next;
    });
    onChange(photos.filter((p) => p.id !== photoId));
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}>
      <span id={`${id}-label`} className="mb-1.5 block text-sm font-semibold text-ink-900">
        {label}
      </span>
      {hint && (
        <p id={`${id}-hint`} className="-mt-0.5 mb-2 text-xs leading-relaxed text-ink-500">
          {hint}
        </p>
      )}
      <ul className="flex flex-wrap gap-2">
        {mine.map((p, i) => {
          const preview = getPhotoPreview(p.id);
          const s: UploadState | "saved" = p.storagePath ? "saved" : (state[p.id] ?? (getPhotoFile(p.id) ? "uploading" : "failed"));
          return (
            <li key={p.id} className="relative h-24 w-24 overflow-hidden rounded-2xl border border-line bg-surface">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={`${label}, photo ${i + 1}`} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-ink-500">
                  Photo {i + 1}
                </span>
              )}
              <span
                className={`absolute inset-x-1 bottom-1 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${
                  s === "saved"
                    ? "bg-sage-700 text-white"
                    : s === "failed"
                      ? "bg-red-700 text-white"
                      : "bg-ink-900/80 text-white"
                }`}
              >
                {s === "saved" ? "Saved" : s === "failed" ? "Not sent" : s === "local" ? "Added" : "Uploading…"}
              </span>
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => remove(p.id)}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-ink-900/75 text-sm text-white transition hover:bg-ink-900"
              >
                <span aria-hidden>×</span>
              </button>
              {s === "failed" && getPhotoFile(p.id) && (
                <button
                  type="button"
                  onClick={() => void upload(p.id)}
                  className="absolute left-1 top-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-accent-700 shadow-sm"
                >
                  Retry
                </button>
              )}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-ink-300 bg-white text-ink-700 transition hover:border-accent-500 hover:text-accent-700"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 8a2 2 0 0 1 2-2h1.2l1.1-1.7A2 2 0 0 1 10 3.5h4a2 2 0 0 1 1.7.8L16.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <span className="text-xs font-semibold">{mine.length ? "Add another" : "Add photo"}</span>
          </button>
        </li>
      </ul>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => addFiles(e.target.files)}
      />
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
