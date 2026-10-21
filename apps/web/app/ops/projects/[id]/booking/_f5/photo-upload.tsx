"use client";

import { useId, useState } from "react";
import type { PhotoTag } from "@aircon/domain";
import { MediaUploadError, uploadMedia } from "@/lib/media-client";

/**
 * Add photos or PDFs to a form: each file uploads as soon as it's picked
 * (resized on the phone, retried on a weak signal), and only files that
 * really landed become `mediaId` fields, so the form never claims evidence
 * the server doesn't have. Progress and failures are announced.
 */

interface Item {
  key: string;
  name: string;
  state: "uploading" | "done" | "failed";
  progress: number;
  mediaId?: string;
  error?: string;
}

export function PhotoUpload({
  projectId,
  tag,
  label = "Add photos or a PDF",
  hint,
  accept = "image/*,application/pdf",
  caption,
}: {
  projectId: string;
  tag: PhotoTag;
  label?: string;
  hint?: string;
  accept?: string;
  caption?: string;
}) {
  const id = useId();
  const [items, setItems] = useState<Item[]>([]);
  const busy = items.some((i) => i.state === "uploading");

  async function add(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 8)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setItems((list) => [...list, { key, name: file.name, state: "uploading", progress: 0 }]);
      try {
        const item = await uploadMedia(file, {
          projectId,
          tag,
          source: "ops",
          ...(caption ? { caption } : {}),
          customerVisible: false,
          onProgress: (p) =>
            setItems((list) => list.map((i) => (i.key === key ? { ...i, progress: p.total ? Math.round((p.loaded / p.total) * 100) : 0 } : i))),
        });
        setItems((list) => list.map((i) => (i.key === key ? { ...i, state: "done", progress: 100, mediaId: item.id } : i)));
      } catch (err) {
        const message = err instanceof MediaUploadError ? err.message : "The upload didn't go through.";
        setItems((list) => list.map((i) => (i.key === key ? { ...i, state: "failed", error: message } : i)));
      }
    }
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-900">
        {label}
      </label>
      <input
        id={id}
        type="file"
        multiple
        accept={accept}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = "";
        }}
        className="block w-full max-w-full text-sm text-ink-700 file:mr-3 file:min-h-11 file:rounded-full file:border file:border-line file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink-900 hover:file:bg-surface"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      )}
      <ul className="mt-2 space-y-1 text-sm" aria-live="polite">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-2">
            <span className="max-w-[16rem] truncate text-ink-900">{i.name}</span>
            {i.state === "uploading" && <span className="text-ink-500">Uploading {i.progress}%…</span>}
            {i.state === "done" && <span className="font-semibold text-emerald-800">Uploaded</span>}
            {i.state === "failed" && <span className="font-semibold text-red-700">{i.error}</span>}
            {i.mediaId && <input type="hidden" name="mediaId" value={i.mediaId} />}
          </li>
        ))}
      </ul>
      {busy && <p className="mt-1 text-xs font-medium text-amber-800">Wait for the uploads to finish before saving.</p>}
    </div>
  );
}
