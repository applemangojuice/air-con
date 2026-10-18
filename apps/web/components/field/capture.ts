"use client";

import type { EvidenceSpec, MediaItem, PhotoTag, StepOutcome } from "@aircon/domain";
import { getFieldOutbox, newOpId, type SyncOp } from "@/lib/field-outbox";
import { prepareImage } from "@/lib/media-client";
import { rememberPreview } from "./use-outbox";

/**
 * Capture on the phone: every capture goes into the outbox first (so it
 * survives no signal and a closed page), and the outbox sends it. These
 * helpers build the ops; nothing here talks to the server directly.
 */

export const nowIso = () => new Date().toISOString();

/** Photos: shrink on the phone first (quick to upload, no GPS in the file), then queue the file and the capture that uses it. */
export async function capturePhoto(input: {
  projectId: string;
  spec: EvidenceSpec;
  file: File | Blob;
  label: string;
  roomId?: string;
  source?: MediaItem["source"];
  tag?: PhotoTag;
}): Promise<{ previewUrl: string; opId: string }> {
  const outbox = getFieldOutbox();
  const isImage = (input.file.type || "").startsWith("image/");
  const prepared = isImage ? await prepareImage(input.file, { fileName: (input.file as File).name || "photo.jpg" }) : null;
  const blob = prepared?.blob ?? input.file;
  const fileName = prepared?.fileName ?? ((input.file as File).name || (input.spec.kind === "video" ? "video.mp4" : "file"));
  const tag = input.tag ?? input.spec.tag ?? (input.spec.kind === "signature" ? "signature" : "progress");
  const placeholder = await outbox.enqueueMedia(
    {
      projectId: input.projectId,
      blob,
      fileName,
      tag,
      source: input.source ?? "install",
      ...(input.roomId ? { roomId: input.roomId } : {}),
      caption: input.label.slice(0, 280),
    },
    input.label,
  );
  const previewUrl = rememberPreview(placeholder.slice("local:".length), blob);
  const opId = newOpId();
  await outbox.enqueue({ type: "evidence", id: opId, projectId: input.projectId, specId: input.spec.id, mediaId: placeholder, at: nowIso() }, input.label);
  return { previewUrl, opId };
}

/** A reading, a serial, a reference, a tick or a location. */
export async function captureValue(
  projectId: string,
  spec: EvidenceSpec,
  label: string,
  payload: { value?: number; ref?: string; note?: string; gps?: { lat: number; lng: number } },
): Promise<string> {
  const id = newOpId();
  const op: SyncOp = { type: "evidence", id, projectId, specId: spec.id, at: nowIso(), ...payload };
  await getFieldOutbox().enqueue(op, label);
  return id;
}

/** A step outcome; Blocked (and a failed critical step) carry an issue id so the issue is made once, however often it's retried. */
export async function captureOutcome(projectId: string, stepId: string, outcome: StepOutcome, reason: string | undefined, label: string, withIssue: boolean) {
  const op: SyncOp = {
    type: "step-status",
    id: newOpId(),
    projectId,
    stepId,
    outcome,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
    ...(withIssue ? { issueId: newOpId() } : {}),
    at: nowIso(),
  };
  await getFieldOutbox().enqueue(op, label);
}

/** "12,5" or " 12.5 " → 12.5; anything else → null. */
export function parseReading(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** One location fix, or null (no permission, no fix in time). Never throws. */
export function locate(timeoutMs = 5000): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { lat: number; lng: number; accuracyM?: number } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const t = window.setTimeout(() => finish(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(t);
        finish({ lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5, accuracyM: Math.round(pos.coords.accuracy) });
      },
      () => {
        window.clearTimeout(t);
        finish(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

/** Can this browser read barcodes from a photo? (Chrome on Android, yes; Safari, not yet.) */
export function canScanBarcodes(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** Read the first barcode or QR code in a photo, or null. */
export async function readBarcode(file: Blob): Promise<string | null> {
  if (!canScanBarcodes()) return null;
  try {
    const Detector = (window as unknown as { BarcodeDetector: new () => BarcodeDetectorLike }).BarcodeDetector;
    const bitmap = await createImageBitmap(file);
    try {
      const codes = await new Detector().detect(bitmap);
      return codes.find((c) => c.rawValue.trim())?.rawValue.trim() ?? null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Videos the server takes: MP4 only (an iPhone's .mov is refused, so we say so before queueing it). */
export const VIDEO_OK = (f: File) => /^video\/mp4$/i.test(f.type) || /\.mp4$/i.test(f.name);
