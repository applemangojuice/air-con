"use client";

import { useId, useRef, useState } from "react";
import { EVIDENCE_KIND_LABEL, NUMERIC_KINDS, windowText, type InstallStep, type SlotView } from "@aircon/domain";
import { canScanBarcodes, capturePhoto, captureValue, locate, parseReading, readBarcode, VIDEO_OK } from "./capture";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { Sheet } from "./sheet";
import { londonTime, personName } from "./format";

/**
 * One evidence slot: the capture control for its kind (camera, reading,
 * scan, reference, tick, location, signature) and its honest state:
 * waiting to sync, saved, outside the window (the tech lead will review),
 * accepted, or asked for again.
 */

export interface SlotProps {
  projectId: string;
  step: InstallStep;
  slot: SlotView;
  /** The capture is on the phone, not yet on the server. */
  waiting: boolean;
  /** The server refused the latest capture for good. */
  refused?: string;
  /** Server URL for the captured photo, or a local preview while it uploads. */
  imageUrl?: string;
  /** Why this person can't capture here (locked step, day not started). */
  disabledReason?: string;
  /** The person, for "by you". */
  meId: string;
}

const STATE_CHIP: Record<string, { text: string; tone: string }> = {
  pass: { text: "Saved", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  accepted: { text: "Accepted by the tech lead", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  exception: { text: "Outside the window", tone: "bg-red-50 text-red-800 border-red-200" },
  recapture: { text: "Capture again", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  missing: { text: "To do", tone: "bg-surface text-ink-700 border-line" },
};

function Chip({ state, waiting }: { state: SlotView["state"]; waiting: boolean }) {
  if (waiting) {
    return <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Waiting to sync</span>;
  }
  const c = STATE_CHIP[state]!;
  return <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.tone}`}>{c.text}</span>;
}

const BIG = "min-h-12 rounded-full px-5 font-semibold";
const PRIMARY = `${BIG} bg-accent-600 text-white shadow-sm hover:bg-accent-700 disabled:opacity-40`;
const SECONDARY = `${BIG} border border-line bg-white text-ink-900 hover:bg-surface disabled:opacity-40`;

export function Slot({ projectId, step, slot, waiting, refused, imageUrl, disabledReason, meId }: SlotProps) {
  const { spec, state, record, review } = slot;
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const scanFile = useRef<HTMLInputElement>(null);
  const pad = useRef<SignaturePadHandle>(null);
  const label = `${spec.label}${step.item ? `, ${step.item}` : ""}`;
  const disabled = Boolean(disabledReason) || busy;
  const numeric = NUMERIC_KINDS.has(spec.kind);
  const captured = state !== "missing";
  const needsCapture = !captured || state === "recapture";
  const win = windowText(spec);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save on the phone. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (spec.kind === "video" && f.type.startsWith("video/") && !VIDEO_OK(f)) {
      setError("This phone saved the video in a format we can't store (only MP4). Take a photo instead, or switch the camera to \"Most compatible\".");
      return;
    }
    await run(async () => {
      const { previewUrl } = await capturePhoto({ projectId, spec, file: f, label, ...(step.roomId ? { roomId: step.roomId } : {}), ...(step.stage === "handover" ? { source: "handover" as const } : {}) });
      if (f.type.startsWith("image/")) setLocalUrl(previewUrl);
    });
  }

  function saveText() {
    if (numeric) {
      const v = parseReading(text);
      if (v === null) return setError(`Type the reading as a number${spec.unit ? ` in ${spec.unit}` : ""}.`);
      void run(() => captureValue(projectId, spec, label, { value: v }));
      return;
    }
    if (!text.trim()) return setError("Type it in first.");
    void run(() => captureValue(projectId, spec, label, { ref: text.trim().slice(0, 200) }));
  }

  const shownImage = imageUrl ?? localUrl ?? undefined;
  const byLine = record ? `${record.byStaffId === meId ? "You" : personName(record.by)}, ${londonTime(record.at)}` : null;

  // A tick is one row: the whole row confirms it, then says who and when.
  if (spec.kind === "check") {
    const done = captured && state !== "recapture";
    return (
      <div className={`flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-2 ${done ? "border-emerald-200 bg-emerald-50/50" : "border-line bg-white"}`}>
        <button
          type="button"
          disabled={done || disabled}
          aria-pressed={done}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-state`}
          onClick={() => void run(() => captureValue(projectId, spec, label, {}))}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl font-bold ${
            done ? "border-emerald-600 bg-emerald-600 text-white" : disabled ? "border-line bg-surface text-ink-300" : "border-accent-600 bg-white text-accent-700 hover:bg-accent-50"
          }`}
        >
          {done ? "✓" : ""}
          <span className="sr-only">{done ? "Confirmed" : "Confirm"}</span>
        </button>
        <div className="min-w-0 flex-1">
          <p id={`${id}-label`} className="font-semibold leading-snug text-ink-900">
            {spec.label}
          </p>
          <p id={`${id}-state`} className="text-sm text-ink-500">
            {waiting ? "Confirmed: waiting to sync" : done ? `Confirmed · ${byLine}` : disabledReason ? "Not yet" : busy ? "Saving…" : "Tap to confirm"}
          </p>
          {refused && (
            <p role="alert" className="text-sm font-medium text-red-800">
              Not saved: {refused}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-3 ${state === "exception" && !waiting ? "border-red-300 bg-red-50/60" : state === "recapture" ? "border-amber-300 bg-amber-50/60" : "border-line bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={`${id}-label`} className="font-semibold leading-snug text-ink-900">
            {spec.label}
            {spec.optional && <span className="ml-1 text-sm font-normal text-ink-500">(optional)</span>}
          </p>
          <p className="text-sm text-ink-500">
            {EVIDENCE_KIND_LABEL[spec.kind]}
            {numeric && spec.unit ? ` · ${spec.unit}` : ""}
            {numeric ? ` · ${win ? `window ${win}${spec.window?.basis === "candidate" ? " (candidate, tech lead confirms)" : spec.window?.basis === "tech-lead" ? " (set by the tech lead)" : ""}` : "record the reading"}` : ""}
          </p>
        </div>
        <Chip state={state} waiting={waiting} />
      </div>

      {captured && (
        <div className="mt-2">
          {(spec.kind === "photo" || spec.kind === "signature" || spec.kind === "video") &&
            (shownImage && spec.kind !== "video" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownImage} alt={spec.label} className="h-36 w-full rounded-xl bg-surface object-cover" />
            ) : (
              <p className="rounded-xl bg-surface px-3 py-2 text-sm text-ink-700">{spec.kind === "video" ? "Video" : "Photo"} captured{waiting ? ", uploading when there's signal" : ""}.</p>
            ))}
          {numeric && record?.value !== undefined && (
            <p className={`text-2xl font-semibold tabular-nums ${state === "exception" ? "text-red-800" : "text-ink-900"}`}>
              {record.value} <span className="text-base font-normal text-ink-500">{spec.unit}</span>
            </p>
          )}
          {(spec.kind === "barcode-scan" || spec.kind === "qr-scan" || spec.kind === "reference") && record?.ref && (
            <p className="break-all font-mono text-lg font-semibold text-ink-900">{record.ref}</p>
          )}
          {spec.kind === "gps" && record?.gps && (
            <p className="text-base text-ink-900">
              {record.gps.lat.toFixed(4)}, {record.gps.lng.toFixed(4)}
            </p>
          )}
          {byLine && <p className="mt-1 text-xs text-ink-500">{byLine}</p>}
          {state === "exception" && !waiting && (
            <p className="mt-2 text-sm font-medium text-red-800">Saved, and flagged: the tech lead will review this reading. Re-check and capture again if it was a slip.</p>
          )}
          {state === "accepted" && review && <p className="mt-2 text-sm text-emerald-800">Accepted by {personName(review.by)}: {review.reason}</p>}
          {state === "recapture" && review && <p className="mt-2 text-sm font-medium text-amber-900">{personName(review.by)} asked for this again: {review.reason}</p>}
        </div>
      )}

      {refused && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          Not saved: {refused}
        </p>
      )}


      {!disabledReason && (
        <div className="mt-3">
          {(spec.kind === "photo" || spec.kind === "video") && (
            <>
              <input
                ref={file}
                type="file"
                accept={spec.kind === "video" ? "video/mp4,video/*,image/*" : "image/*"}
                capture="environment"
                className="sr-only"
                aria-labelledby={`${id}-label`}
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button type="button" disabled={disabled} onClick={() => file.current?.click()} className={needsCapture ? `${PRIMARY} w-full` : `${SECONDARY} w-full`}>
                {busy ? "Saving on the phone…" : needsCapture ? (spec.kind === "video" ? "Film it" : "Take photo") : spec.kind === "video" ? "Film again" : "Retake"}
              </button>
            </>
          )}

          {spec.kind === "signature" && (
            <button type="button" disabled={disabled} onClick={() => setSigning(true)} className={needsCapture ? `${PRIMARY} w-full` : `${SECONDARY} w-full`}>
              {needsCapture ? "Sign" : "Sign again"}
            </button>
          )}


          {spec.kind === "gps" && (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const fix = await locate();
                  if (!fix) throw new Error("No location: allow location for this site, or skip it (it's optional).");
                  await captureValue(projectId, spec, label, { gps: { lat: fix.lat, lng: fix.lng } });
                })
              }
              className={needsCapture ? `${PRIMARY} w-full` : `${SECONDARY} w-full`}
            >
              {busy ? "Finding you…" : needsCapture ? "Record location" : "Record again"}
            </button>
          )}

          {(numeric || spec.kind === "barcode-scan" || spec.kind === "qr-scan" || spec.kind === "reference") && (
            <div className="space-y-2">
              <label htmlFor={`${id}-input`} className="sr-only">
                {spec.label}
              </label>
              <div className="flex gap-2">
                <input
                  id={`${id}-input`}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveText();
                  }}
                  inputMode={numeric ? "decimal" : "text"}
                  autoComplete="off"
                  autoCapitalize={numeric ? "off" : "characters"}
                  placeholder={numeric ? (captured ? "New reading" : "Reading") : captured ? "Change it" : spec.kind === "reference" ? "Type the reference" : "Type the serial"}
                  disabled={disabled}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  className="min-h-12 w-full min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-lg text-ink-900 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
                />
                {numeric && spec.unit && <span className="flex items-center text-base text-ink-500">{spec.unit}</span>}
                <button type="button" disabled={disabled || !text.trim()} onClick={saveText} className={PRIMARY}>
                  Save
                </button>
              </div>
              {(spec.kind === "barcode-scan" || spec.kind === "qr-scan") && canScanBarcodes() && (
                <>
                  <input
                    ref={scanFile}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    aria-label={`Scan ${spec.label}`}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      const code = await readBarcode(f);
                      if (code) setText(code);
                      else setError("No barcode found in that photo. Try closer, or type it.");
                    }}
                  />
                  <button type="button" disabled={disabled} onClick={() => scanFile.current?.click()} className={`${SECONDARY} w-full`}>
                    Scan the barcode
                  </button>
                </>
              )}
              {spec.role === "scheme-ref" && !captured && (
                <button type="button" disabled={disabled} onClick={() => void run(() => captureValue(projectId, spec, label, { ref: "pending from scheme" }))} className={`${SECONDARY} w-full`}>
                  Pending from scheme
                </button>
              )}
            </div>
          )}

          {error && (
            <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      )}

      {spec.kind === "signature" && (
        <Sheet
          open={signing}
          onClose={() => setSigning(false)}
          title={spec.label}
          footer={
            <button
              type="button"
              className={`${PRIMARY} w-full`}
              onClick={async () => {
                const blob = await pad.current?.toBlob();
                if (!blob) return setError("Sign in the box first.");
                setSigning(false);
                await onFile(new File([blob], "signature.png", { type: "image/png" }));
              }}
            >
              Save signature
            </button>
          }
        >
          <SignaturePad ref={pad} label={spec.label} />
        </Sheet>
      )}
    </div>
  );
}
