"use client";

import { useRef } from "react";
import type { PhotoKind, SurveyPhoto } from "@aircon/domain";
import { getPhotoPreview, registerPhotoFile, releasePhoto } from "@/lib/photo-registry";

/**
 * Mobile-first photo capture. Opens the camera directly on phones
 * (capture="environment") and the file picker on desktop.
 */
export function PhotoInput({
  kind,
  label,
  photos,
  onChange,
}: {
  kind: PhotoKind;
  label: string;
  photos: SurveyPhoto[];
  onChange: (photos: SurveyPhoto[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mine = photos.filter((p) => p.kind === kind);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const added: SurveyPhoto[] = Array.from(list).map((file) => {
      const { id } = registerPhotoFile(file);
      return { id, kind, fileName: file.name };
    });
    onChange([...photos, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(id: string) {
    releasePhoto(id);
    onChange(photos.filter((p) => p.id !== id));
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-ink-900">{label}</span>
      <div className="flex flex-wrap gap-2">
        {mine.map((p) => {
          const preview = getPhotoPreview(p.id);
          return (
            <div
              key={p.id}
              className="relative h-20 w-20 overflow-hidden rounded-2xl border border-line bg-surface"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-ink-300">
                  saved
                </span>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => remove(p.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900/70 text-xs text-white"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-ink-300 transition hover:border-accent-400 hover:text-accent-600"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 8a2 2 0 0 1 2-2h1.2l1.1-1.7A2 2 0 0 1 10 3.5h4a2 2 0 0 1 1.7.8L16.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="text-[11px] font-medium">Add photo</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />
    </div>
  );
}
