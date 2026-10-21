"use client";

import Link from "next/link";
import { useState } from "react";
import { SURVEY_SECTIONS, type SelfSurveyDiffRow, type SurveyCompleteness, type SurveySectionId } from "@aircon/domain";
import { Callout, FieldCard, TextField } from "./controls";
import { useSurvey } from "./context";
import { NextButton } from "./sections";
import { SelfSurveyDiff } from "./self-survey-diff";
import { recordedOn } from "./visit";
import type { VisitProject } from "./types";

/**
 * The end of the visit: the documents-by-email consent (asked in person,
 * never a signature), the check-and-submit screen with jump links to
 * anything missing, and what happens next once it's in.
 */

/* ------------------------------------------------------------------ */
/* Documents by email                                                  */
/* ------------------------------------------------------------------ */

/** The same rule the server applies (lib/auth/access isPlausibleEmail), kept client-side. */
const isPlausibleEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function ConsentSection({
  consent,
  onRecorded,
}: {
  consent: VisitProject["documentsConsent"];
  onRecorded: (c: { at: string; channel: string }, email?: string) => void;
}) {
  const { projectId, project } = useSurvey();
  const [asked, setAsked] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsEmail = !project.customer.email;

  if (project.proposalAccepted) {
    return (
      <div className="space-y-4">
        <Callout tone="info">The contract is already in place, so there&apos;s nothing to record here.</Callout>
        <NextButton from="consent" />
      </div>
    );
  }

  const record = async () => {
    if (needsEmail && !isPlausibleEmail(email.trim().toLowerCase())) {
      setError("Add the customer's email address first: the proposal can only go by email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/field/survey/${projectId}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(needsEmail ? { email: email.trim() } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as { consent?: { at: string; channel: string }; email?: string; error?: string };
      if (!res.ok || !body.consent) throw new Error(body.error ?? `Couldn't record it (${res.status}).`);
      onRecorded(body.consent, body.email);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No signal, so it wasn't recorded. Try again before you leave.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {consent ? (
        <FieldCard tone="plain">
          <p className="flex items-center gap-2 text-lg font-semibold text-emerald-800">
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Recorded
          </p>
          <p className="text-base text-ink-900">
            {project.customer.name || "The customer"} agreed to get their proposal and contract documents by email
            {project.customer.email ? ` at ${project.customer.email}` : ""}.
          </p>
          <p className="text-sm text-ink-500">
            {recordedOn(consent.at)} · {consent.channel === "in-person" ? "in person, at the survey" : consent.channel === "portal" ? "on their portal" : "by email"}
          </p>
        </FieldCard>
      ) : (
        <FieldCard>
          <p className="text-base text-ink-900">Ask the customer, in your own words:</p>
          <blockquote className="rounded-2xl border-l-4 border-accent-500 bg-cream px-4 py-3 text-lg leading-snug text-ink-900">
            &ldquo;Are you happy to receive your proposal and contract documents by email?&rdquo;
          </blockquote>
          <p className="text-sm text-ink-500">
            Only record it if they say yes. This isn&apos;t signing anything: the proposal arrives later by email and they accept it online, in their own time. The pilot can&apos;t send documents on paper, so without it no proposal can go: if they&apos;d rather not, tell them the office will get in touch to talk it through.
          </p>
          {needsEmail && (
            <TextField
              field="consentEmail"
              label="Their email address"
              hint="There's no email on file. The proposal goes here."
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              maxLength={254}
            />
          )}
          <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3">
            <input type="checkbox" checked={asked} onChange={(e) => setAsked(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-accent-600" />
            <span className="text-base text-ink-900">I asked, and they said yes</span>
          </label>
          {error && (
            <p role="alert" className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-medium text-red-800">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={record}
            disabled={!asked || busy}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-accent-700 px-6 text-base font-semibold text-white shadow-sm hover:bg-accent-800 disabled:opacity-40"
          >
            {busy ? "Recording…" : "Record their agreement"}
          </button>
        </FieldCard>
      )}
      <NextButton from="consent" quiet={!consent} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Check and submit                                                    */
/* ------------------------------------------------------------------ */

export function MissingList({ missing, limit, headings = true }: { missing: SurveyCompleteness["missing"]; limit?: number; headings?: boolean }) {
  const { go } = useSurvey();
  const groups = SURVEY_SECTIONS.map((s) => ({ ...s, items: missing.filter((m) => m.sectionId === s.id) })).filter((g) => g.items.length > 0);
  let shown = 0;
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        if (limit !== undefined && shown >= limit) return null;
        const items = limit !== undefined ? g.items.slice(0, Math.max(0, limit - shown)) : g.items;
        shown += items.length;
        return (
          <div key={g.id}>
            {headings && <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">{g.label}</p>}
            <ul className="space-y-1.5">
              {items.map((m, i) => (
                <li key={`${m.item}-${i}`}>
                  <button
                    type="button"
                    onClick={() =>
                      go({
                        s: g.id as SurveySectionId,
                        ...(m.roomId ? { r: m.roomId } : {}),
                        ...(m.positionId ? { o: m.positionId } : {}),
                        ...(m.field ? { f: m.field } : {}),
                      })
                    }
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-left text-base text-amber-950 hover:bg-amber-100"
                  >
                    <span className="min-w-0">{m.item}</span>
                    <span aria-hidden className="shrink-0 font-semibold">
                      Go ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function SubmitSection({
  pendingPhotos,
  keptDrawings = [],
  onSaveDrawings,
  onOpenDrawing,
  consent,
  onSubmit,
  submitting,
  submitError,
}: {
  pendingPhotos: number;
  /** Drawings kept on this phone, still to be saved onto their photos: the survey waits for them like photos. */
  keptDrawings?: { id: string; title: string }[];
  onSaveDrawings?: () => Promise<number>;
  onOpenDrawing?: (id: string, title: string) => void;
  consent: VisitProject["documentsConsent"];
  onSubmit: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const { completeness, go, data, project } = useSurvey();
  const [confirm, setConfirm] = useState(false);
  const [savingDrawings, setSavingDrawings] = useState(false);
  const [drawingNote, setDrawingNote] = useState<string | null>(null);
  const ready = completeness.missing.length === 0;
  const drawings = keptDrawings.length;
  const waiting = pendingPhotos > 0 || drawings > 0;
  const rooms = data.rooms.filter((r) => r.include).length;
  const chosen = data.outdoor.positions.filter((p) => p.chosen).length;
  return (
    <div className="space-y-4">
      {!ready ? (
        <FieldCard title={`${completeness.missing.length} thing${completeness.missing.length === 1 ? "" : "s"} to finish`}>
          <p className="-mt-3 text-sm text-ink-500">The survey can be submitted once everything below is done. Tap one to go straight to it.</p>
          <MissingList missing={completeness.missing} />
        </FieldCard>
      ) : (
        <FieldCard>
          <p className="flex items-center gap-2 text-lg font-semibold text-emerald-800">
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            Everything&apos;s in
          </p>
          <p className="text-base text-ink-900">
            {rooms} room{rooms === 1 ? "" : "s"}, {chosen} outdoor position{chosen === 1 ? "" : "s"}, electrics, planning checks and risks.
          </p>
        </FieldCard>
      )}

      {pendingPhotos > 0 && (
        <Callout tone="warn" title={`${pendingPhotos} photo${pendingPhotos === 1 ? "" : "s"} still uploading`}>
          Wait for them to finish (or remove them) before you submit, so nothing is left behind on this phone.
        </Callout>
      )}
      {drawings > 0 && (
        <Callout tone="warn" title={`${drawings} drawing${drawings === 1 ? "" : "s"} not saved yet`}>
          <p>
            {drawings === 1 ? "It's" : "They're"} only on this phone. Save {drawings === 1 ? "it" : "them"} before you submit, so the technical lead designs from your unit
            position and pipe route.
          </p>
          <ul className="mt-2 space-y-1">
            {keptDrawings.map((d) => (
              <li key={d.id}>
                {onOpenDrawing ? (
                  <button type="button" className="font-semibold underline" onClick={() => onOpenDrawing(d.id, d.title)}>
                    {d.title}
                  </button>
                ) : (
                  d.title
                )}
              </li>
            ))}
          </ul>
          {onSaveDrawings && (
            <button
              type="button"
              disabled={savingDrawings}
              onClick={async () => {
                setSavingDrawings(true);
                setDrawingNote(null);
                const left = await onSaveDrawings().catch(() => drawings);
                setSavingDrawings(false);
                setDrawingNote(left > 0 ? "Still not saved: no signal, or the server refused it. Try again when you have signal, or open the photo to save or discard it." : null);
              }}
              className="mt-3 inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-5 font-semibold text-ink-900 disabled:opacity-50"
            >
              {savingDrawings ? "Saving…" : drawings === 1 ? "Save it now" : "Save them now"}
            </button>
          )}
          {drawingNote && <p className="mt-2 text-sm">{drawingNote}</p>}
        </Callout>
      )}
      {!consent && !project.proposalAccepted && (
        <Callout tone="info">
          Documents by email isn&apos;t recorded yet.{" "}
          <button type="button" className="font-semibold underline" onClick={() => go({ s: "consent" })}>
            Ask before you leave
          </button>
          : without it no proposal can go (the pilot can&apos;t send documents on paper).
        </Callout>
      )}

      {submitError && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-base font-medium text-red-800">
          {submitError}
        </p>
      )}

      {confirm && ready && !waiting ? (
        <FieldCard tone="warn">
          <p className="text-base font-semibold text-ink-900">Submit the survey?</p>
          <p className="text-sm text-ink-700">It goes to the technical lead for the design, and {project.customer.name || "the customer"} is told the survey&apos;s done. You can&apos;t edit it afterwards.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirm(false)} className="min-h-12 rounded-full border border-line bg-white font-semibold text-ink-900">
              Not yet
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="min-h-12 rounded-full bg-accent-700 font-semibold text-white hover:bg-accent-800 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </FieldCard>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={!ready || waiting || submitting}
          className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-accent-700 px-6 text-lg font-semibold text-white shadow-sm hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ready ? "Submit survey" : `Submit survey (${completeness.missing.length} to do)`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Done                                                                */
/* ------------------------------------------------------------------ */

export function SubmittedScreen({
  project,
  submittedAt,
  minutes,
  diff,
  canOpenOps,
}: {
  project: VisitProject;
  submittedAt?: string;
  minutes?: number | null;
  diff: SelfSurveyDiffRow[] | null;
  canOpenOps: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-white p-5 text-center">
        <span aria-hidden className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h1 className="font-display text-3xl text-ink-900">Survey submitted</h1>
        <p className="mt-1 text-base text-ink-500">
          {project.customer.name || "Customer"}
          {submittedAt ? ` · ${recordedOn(submittedAt)}` : ""}
          {minutes ? ` · ${minutes} minutes` : ""}
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-xl text-ink-900">What happens next</h2>
        <ol className="mt-3 space-y-3 text-base text-ink-900">
          <li className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-white">1</span>
            <span>The technical lead designs the system from your measurements and photos, and signs it off.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-white">2</span>
            <span>The customer is told the survey&apos;s done, by email if we have their address, with when to expect the proposal.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-white">3</span>
            <span>The proposal goes out by email for them to accept online. Nothing is signed at the house.</span>
          </li>
        </ol>
      </section>

      {diff && <SelfSurveyDiff rows={diff} />}

      <div className="flex flex-col gap-2">
        <Link href="/field/survey" className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ink-900 px-6 text-base font-semibold text-white">
          Back to surveys
        </Link>
        {canOpenOps && (
          <Link href={`/ops/projects/${project.id}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-6 text-base font-semibold text-ink-900">
            Open the project
          </Link>
        )}
      </div>
    </div>
  );
}
