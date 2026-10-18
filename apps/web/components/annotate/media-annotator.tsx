"use client";

import type { Annotation, MediaItem } from "@aircon/domain";
import { Annotator, type ToolId } from "./annotator";

/**
 * The annotation editor wired to a stored photo: saves through the media
 * API (PATCH /api/media/<id>) with the version it opened, so a stale save
 * is refused rather than lost. Reusable anywhere a photo can be marked up:
 * the survey, the design screen, the field app.
 */

export type EditableMedia = Pick<MediaItem, "id" | "annotations" | "annotationsVersion" | "locked" | "width" | "height"> & {
  url: string | null;
};

export async function saveAnnotations(
  media: Pick<EditableMedia, "id" | "annotationsVersion">,
  annotations: Annotation[],
): Promise<EditableMedia & Partial<MediaItem>> {
  let res: Response;
  try {
    res = await fetch(`/api/media/${media.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ annotations, expectedVersion: media.annotationsVersion }),
    });
  } catch {
    throw new Error("No connection, so the drawing didn't save.");
  }
  const body = (await res.json().catch(() => ({}))) as { item?: EditableMedia & Partial<MediaItem>; error?: string };
  if (!res.ok || !body.item) throw new Error(body.error ?? `The drawing didn't save (${res.status}).`);
  return body.item;
}

export function MediaAnnotator({
  media,
  title,
  defaultTool,
  onSaved,
  onClose,
}: {
  media: EditableMedia;
  title: string;
  defaultTool?: ToolId;
  onSaved: (item: EditableMedia & Partial<MediaItem>) => void;
  onClose: () => void;
}) {
  return (
    <Annotator
      src={media.url}
      width={media.width}
      height={media.height}
      initial={media.annotations}
      locked={media.locked}
      title={title}
      defaultTool={defaultTool}
      draftKey={`${media.id}:v${media.annotationsVersion}`}
      onSave={async (annotations) => {
        const item = await saveAnnotations(media, annotations);
        onSaved(item);
      }}
      onClose={onClose}
    />
  );
}
