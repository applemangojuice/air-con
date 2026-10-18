"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SURVEY_LABELS, roomSizeLabel, type Survey } from "@aircon/domain";
import { ModalPortal } from "@/components/annotate/modal-portal";
import { fmtDate, fmtDayTime } from "@/lib/format";
import { londonClock } from "./nav";
import type { OnMyWayState, TextStatus, VisitProject } from "./types";

/**
 * Before the survey: the visit card (who, where, when, how to get in, what
 * the customer already told us) and the "On my way" text with an ETA the
 * surveyor picks and a preview of exactly what the customer will get.
 */

const ETAS = [10, 20, 30, 45, 60];

export function mapsLinks(addressLine: string, postcode: string) {
  const q = encodeURIComponent([addressLine, postcode].filter(Boolean).join(", "));
  return { google: `https://www.google.com/maps/search/?api=1&query=${q}`, apple: `https://maps.apple.com/?q=${q}` };
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export function textStatusWords(t: TextStatus, _smsMode: "live" | "demo"): { tone: "ok" | "warn" | "bad"; text: string } {
  switch (t.state) {
    case "sent":
      return { tone: "ok", text: `Text sent to ${t.to} at ${londonClock(t.at)}.` };
    case "demo":
      return { tone: "warn", text: `Recorded at ${londonClock(t.at)}, not sent: demo mode (no SMS provider set up).` };
    case "queued":
      return { tone: "warn", text: `Queued to send to ${t.to}.` };
    case "failed":
      return { tone: "bad", text: `The text didn't send${t.error ? ` (${t.error})` : ""}. Call the customer instead.` };
    case "not-sent":
      return { tone: "warn", text: t.reason };
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-3 first:border-t-0">
      <dt className="text-sm font-semibold text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-base text-ink-900">{children}</dd>
    </div>
  );
}

/** What the customer told us in the funnel, in one glance. */
export function CustomerSaid({ self }: { self: Survey | null }) {
  if (!self) return <p className="text-base text-ink-500">No self-survey on file. Start from scratch.</p>;
  return (
    <ul className="space-y-1 text-base">
      <li>
        {SURVEY_LABELS.propertyType[self.property.type]}, built {SURVEY_LABELS.era[self.property.era].toLowerCase()}, {self.property.bedrooms} bedroom
        {self.property.bedrooms === 1 ? "" : "s"}
      </li>
      {self.rooms.map((r) => (
        <li key={r.id} className="text-ink-700">
          {r.name}: {r.areaM2 ? `${r.areaM2} m²` : roomSizeLabel(r.size).toLowerCase()}, {SURVEY_LABELS.floor[r.floor].toLowerCase()}
        </li>
      ))}
      <li className="text-ink-700">Outdoor unit: {SURVEY_LABELS.outdoorLocation[self.outdoor.location].toLowerCase()}</li>
      <li className="text-ink-700">Fuse board: {SURVEY_LABELS.electricsCondition[self.electrics.condition].toLowerCase()}</li>
    </ul>
  );
}

export function VisitCard({
  project,
  self,
  onMyWay,
  smsMode,
  starting,
  startError,
  onStart,
  onOpenOnMyWay,
  resume,
}: {
  project: VisitProject;
  self: Survey | null;
  onMyWay: OnMyWayState | null;
  smsMode: "live" | "demo";
  starting: boolean;
  startError: string | null;
  onStart: () => void;
  onOpenOnMyWay: () => void;
  /** In progress already: the button resumes rather than starts. */
  resume: boolean;
}) {
  const c = project.customer;
  const maps = mapsLinks(c.addressLine, c.postcode);
  const at = project.survey.scheduledFor;
  const status = onMyWay ? textStatusWords(onMyWay.text, smsMode) : null;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-white p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Home survey{project.pilotLabel ? ` · ${project.pilotLabel}` : ""}
        </p>
        <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900">{c.name || "Customer"}</h1>
        <p className="mt-1 text-lg text-ink-900">
          {at ? fmtDayTime(at) : "No time booked"}
          {project.survey.durationMinutes ? <span className="text-ink-500"> · about {project.survey.durationMinutes} min</span> : null}
        </p>
        {project.survey.surveyor && <p className="text-sm text-ink-500">Surveyor: {project.survey.surveyor.name}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {c.phone ? (
            <a href={telHref(c.phone)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-base font-semibold text-ink-900 hover:bg-surface">
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
              </svg>
              Call
            </a>
          ) : (
            <span className="inline-flex min-h-12 items-center justify-center rounded-full border border-dashed border-line px-3 text-center text-sm text-ink-500">No phone on file</span>
          )}
          <a href={maps.google} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 text-base font-semibold text-ink-900 hover:bg-surface">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </svg>
            Directions
          </a>
        </div>

        {!resume && (
          <div className="mt-3">
            <button
              type="button"
              onClick={onOpenOnMyWay}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-5 text-base font-semibold text-ink-900 hover:bg-surface"
            >
              {onMyWay ? "Send a new ETA" : "On my way"}
            </button>
            {status && onMyWay && (
              <p
                role="status"
                className={`mt-2 rounded-2xl px-4 py-2 text-sm ${status.tone === "ok" ? "bg-emerald-50 text-emerald-900" : status.tone === "bad" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-950"}`}
              >
                ETA {onMyWay.etaMinutes} min. {status.text}
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-full bg-accent-600 px-6 text-lg font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
        >
          {starting ? "Starting…" : resume ? "Carry on with the survey" : "Start survey"}
        </button>
        {startError && (
          <p role="alert" className="mt-2 rounded-2xl bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
            {startError}
          </p>
        )}
        {!resume && <p className="mt-2 text-center text-sm text-ink-500">Starting tells the customer you&apos;ve begun and starts your survey clock.</p>}
      </section>

      <section className="rounded-2xl border border-line bg-white px-5 py-2">
        <dl>
          <Row label="Address">
            {c.addressLine}, {c.postcode}{" "}
            <a href={maps.apple} target="_blank" rel="noreferrer" className="ml-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent-700 underline underline-offset-2">
              Apple Maps
            </a>
          </Row>
          <Row label="Access">{c.accessNotes?.trim() || <span className="text-ink-500">Nothing noted yet. Ask on arrival.</span>}</Row>
          <Row label="Parking">{c.parkingNotes?.trim() || <span className="text-ink-500">Nothing noted yet.</span>}</Row>
          <Row label="What they told us">
            <CustomerSaid self={self} />
          </Row>
          <Row label="Bring">Laser measure, compass app, ladder for the loft hatch, torch for the fuse board.</Row>
        </dl>
      </section>
    </div>
  );
}

/** The ETA sheet: pick, preview the exact text, send. Honest about what happened. */
interface OnMyWayProps {
  projectId: string;
  phone?: string;
  smsMode: "live" | "demo";
  onClose: () => void;
  onSent: (state: OnMyWayState) => void;
}

export function OnMyWaySheet(props: OnMyWayProps) {
  return (
    <ModalPortal>
      <OnMyWayDialog {...props} />
    </ModalPortal>
  );
}

function OnMyWayDialog({ projectId, phone, smsMode, onClose, onSent }: OnMyWayProps) {
  const id = useId();
  const [eta, setEta] = useState<number>(20);
  const [custom, setCustom] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<OnMyWayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!(eta >= 1 && eta <= 240)) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/field/survey/${projectId}/on-my-way?eta=${eta}`, { signal: ctrl.signal, credentials: "same-origin" });
        const body = (await res.json().catch(() => ({}))) as { preview?: string; error?: string };
        if (!res.ok || !body.preview) throw new Error(body.error ?? "No preview");
        setPreview(body.preview);
        setPreviewError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setPreviewError("Couldn't load the preview (no signal?). The text uses the same template.");
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [eta, projectId]);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/field/survey/${projectId}/on-my-way`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ etaMinutes: eta }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<OnMyWayState> & { error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? `Couldn't send (${res.status}).`);
      const state = { etaMinutes: body.etaMinutes ?? eta, at: body.at ?? new Date().toISOString(), text: body.text };
      setResult(state);
      onSent(state);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No signal, so nothing was sent. Try again, or call the customer.");
    } finally {
      setSending(false);
    }
  };

  const words = result ? textStatusWords(result.text, smsMode) : null;

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-ink-950/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} className="font-display text-2xl text-ink-900">
            On my way
          </h2>
          <button ref={firstRef} type="button" onClick={onClose} aria-label="Close" className="inline-flex h-12 w-12 items-center justify-center rounded-full text-ink-700 hover:bg-surface">
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {result && words ? (
          <div className="mt-3 space-y-4">
            <p
              role="status"
              className={`rounded-2xl px-4 py-3 text-base ${words.tone === "ok" ? "bg-emerald-50 text-emerald-900" : words.tone === "bad" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-950"}`}
            >
              {words.text}
            </p>
            <button type="button" onClick={onClose} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ink-900 text-base font-semibold text-white">
              Done
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            <fieldset>
              <legend className="mb-2 text-base font-semibold text-ink-900">How long until you arrive?</legend>
              <div className="grid grid-cols-3 gap-2">
                {ETAS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={eta === m && !custom}
                    onClick={() => {
                      setCustom("");
                      setEta(m);
                    }}
                    className={`min-h-12 rounded-full border text-base font-semibold transition ${eta === m && !custom ? "border-accent-600 bg-accent-50 text-accent-700 ring-1 ring-accent-600" : "border-line bg-white text-ink-900"}`}
                  >
                    {m} min
                  </button>
                ))}
                <label className="relative col-span-1">
                  <span className="sr-only">Other ETA in minutes</span>
                  <input
                    inputMode="numeric"
                    value={custom}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
                      setCustom(v);
                      const n = Number(v);
                      if (n >= 1 && n <= 240) setEta(n);
                    }}
                    placeholder="Other"
                    className={`min-h-12 w-full rounded-full border px-4 text-center text-base font-semibold outline-none focus:ring-2 focus:ring-accent-100 ${custom ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-900 placeholder:text-ink-500"}`}
                  />
                </label>
              </div>
            </fieldset>

            <div>
              <p className="mb-1 text-sm font-semibold text-ink-500">{phone ? `The text to ${phone}` : "The message"}</p>
              <div aria-live="polite" className="rounded-2xl bg-sage-50 px-4 py-3 text-base leading-relaxed text-ink-900">
                {preview ?? <span className="text-ink-500">Loading the preview…</span>}
              </div>
              {previewError && <p className="mt-1 text-sm text-amber-800">{previewError}</p>}
              {!phone && <p className="mt-2 text-sm text-amber-800">There&apos;s no mobile number on file, so no text will go. It still shows on the customer&apos;s page.</p>}
              {phone && smsMode === "demo" && <p className="mt-2 text-sm text-amber-800">Demo mode: the text is recorded but not actually sent.</p>}
            </div>

            {error && (
              <p role="alert" className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={send}
              disabled={sending || !(eta >= 1 && eta <= 240)}
              className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-accent-600 px-6 text-lg font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-50"
            >
              {sending ? "Sending…" : phone ? `Send: about ${eta} min` : `Record: about ${eta} min`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Recorded on 18 Oct 2026 at 10:42". */
export const recordedOn = (iso: string) => `${fmtDate(iso)} at ${londonClock(iso)}`;
