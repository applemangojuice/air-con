"use client";

import { useEffect, useId, useRef, useState } from "react";
import { canRecord, canSetOutcome, type StaffMember, type StepOutcome, type StepView } from "@aircon/domain";
import { captureOutcome } from "./capture";
import { DecayPanel } from "./decay-panel";
import { Slot } from "./slot";
import type { MergedJob } from "./use-outbox";

/**
 * One runsheet step: what to do (guidance), who may do it (locked steps
 * say who's needed), its evidence slots, and its outcome: Pass, Fail,
 * Blocked or N/A, with a reason for the last three. Blocked raises an
 * issue for the office; a failed critical step stops the job for the tech
 * lead.
 */

const STATE: Record<StepView["state"], { text: string; tone: string; dot: string }> = {
  todo: { text: "To do", tone: "text-ink-700", dot: "border-2 border-ink-300 bg-white" },
  "in-progress": { text: "Started", tone: "text-sage-700", dot: "bg-sage-500" },
  done: { text: "Done", tone: "text-emerald-800", dot: "bg-emerald-600" },
  na: { text: "N/A", tone: "text-ink-700", dot: "bg-ink-300" },
  blocked: { text: "Blocked", tone: "text-red-800", dot: "bg-red-600" },
  failed: { text: "Failed", tone: "text-red-800", dot: "bg-red-600" },
  exception: { text: "Needs review", tone: "text-red-800", dot: "bg-red-600" },
  recapture: { text: "Capture again", tone: "text-amber-900", dot: "bg-amber-500" },
};

const OUTCOMES: { value: StepOutcome; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "blocked", label: "Blocked" },
  { value: "na", label: "N/A" },
];

export function StepCard({
  projectId,
  view,
  merged,
  me,
  today,
  mediaUrls,
  refusal,
  expanded,
  onToggle,
}: {
  projectId: string;
  view: StepView;
  merged: MergedJob;
  me: StaffMember;
  today: string;
  mediaUrls: Record<string, string>;
  /** Why nothing can be recorded on the job right now (day 1 not started, commissioned). */
  refusal: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { step } = view;
  const id = useId();
  const [picking, setPicking] = useState<StepOutcome | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Why a tap on Pass didn't pass it; gone once the evidence changes.
  const [passNote, setPassNote] = useState<string | null>(null);
  useEffect(() => setPassNote(null), [view.missing, view.state]);
  const lock = canRecord(step, me, today);
  const disabledReason = refusal ?? (lock.ok ? undefined : `${lock.reason}: this step is locked for you.`);
  const s = STATE[view.state];
  const required = view.slots.filter((x) => !x.spec.optional);
  const doneSlots = required.filter((x) => x.state === "pass" || x.state === "accepted").length;
  const current: StepOutcome = view.latest?.outcome ?? "pass";
  const waitingOutcome = view.latest?.id ? merged.waiting.has(view.latest.id) : false;

  /**
   * Pass comes from the evidence, so a tap on Pass with slots still to
   * capture can't pass the step: say what's missing and take them to it,
   * never a silent tap.
   */
  function explainPass() {
    const left = required.filter((x) => x.state === "missing" || x.state === "recapture");
    const out = required.filter((x) => x.state === "exception");
    if (view.test?.result === "fail") {
      setPassNote("The test failed on its readings: find and fix the cause, then take every reading again. Pass comes from a retest that passes.");
      return;
    }
    if (view.test && !left.length && view.test.result === "incomplete") {
      setPassNote(view.test.invalid[0] ?? "A reading above still needs taking for the test to be judged.");
      return;
    }
    if (left.length) {
      setPassNote(`Capture ${left.length === 1 ? "the slot" : `the ${left.length} slots`} above first: Pass comes from the evidence.`);
      // Show them which one: brought into view (only as far as needed) and ringed for a moment.
      const first = bodyRef.current?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(left[0]!.spec.id)}"]`);
      if (first) {
        first.scrollIntoView({ behavior: "smooth", block: "nearest" });
        first.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
        first.dataset.flash = "1";
        window.setTimeout(() => delete first.dataset.flash, 2400);
      }
    } else if (out.length) {
      setPassNote("A reading above is outside its window: the tech lead reviews it before this step can pass.");
    }
  }

  async function save(outcome: StepOutcome) {
    const check = canSetOutcome(step, outcome, me, today, reason);
    if (!check.ok) {
      setError(check.reason ?? "You can't record that.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await captureOutcome(
        projectId,
        step.id,
        outcome,
        outcome === "pass" ? undefined : reason,
        `${OUTCOMES.find((o) => o.value === outcome)!.label}: ${step.title}${step.item ? `, ${step.item}` : ""}`,
        outcome === "blocked" || (outcome === "fail" && Boolean(step.critical)),
      );
      setPicking(null);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save on the phone.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li id={`step-${step.id}`} className={`scroll-mt-20 overflow-hidden rounded-2xl border bg-white ${view.state === "blocked" || view.state === "failed" || view.state === "exception" ? "border-red-300" : "border-line"}`}>
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${id}-body`}
          onClick={onToggle}
          className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span aria-hidden className={`h-4 w-4 shrink-0 rounded-full ${s.dot}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-semibold leading-snug text-ink-900">{step.title}</span>
            {step.item && <span className="block text-base text-ink-700">{step.item}</span>}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm">
              <span className={`font-semibold ${s.tone}`}>{s.text}</span>
              {required.length > 0 && view.state !== "na" && <span className="text-ink-500">{doneSlots} of {required.length}</span>}
              {step.requires && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${lock.ok ? "bg-sage-50 text-sage-800" : "bg-surface text-ink-700"}`}>
                  {step.requires === "fgas" ? "F-gas" : step.requires === "electrical" ? "Electrician" : "Tech lead"}
                  {lock.ok ? "" : " · locked"}
                </span>
              )}
              {step.critical && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Critical</span>}
            </span>
          </span>
          <svg aria-hidden viewBox="0 0 24 24" className={`h-6 w-6 shrink-0 text-ink-500 transition ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>

      {expanded && (
        <div id={`${id}-body`} ref={bodyRef} className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          {!lock.ok && (
            <p className="rounded-xl bg-ink-900 px-3 py-2 text-base font-semibold text-white">
              {lock.reason}. You can still mark it Blocked if it can't be done.
            </p>
          )}
          {step.guidance && <p className="text-base leading-relaxed text-ink-700">{step.guidance}</p>}
          {view.test && <DecayPanel test={view.test} compact={view.test.result === "incomplete" && view.test.fails.length === 0 && view.test.invalid.length === 0} />}
          {view.latest && view.latest.outcome !== "pass" && (
            <p className={`rounded-xl px-3 py-2 text-sm font-medium ${view.latest.outcome === "na" ? "bg-surface text-ink-900" : "bg-red-50 text-red-900"}`}>
              {OUTCOMES.find((o) => o.value === view.latest!.outcome)!.label} · {view.latest.reason}
              {waitingOutcome ? " · waiting to sync" : ""}
              {view.latest.outcome === "blocked" && !waitingOutcome ? " · the office has an issue for it" : ""}
            </p>
          )}

          <ul className="space-y-3">
            {view.slots.map((slot) => {
              const rec = slot.record;
              const refused = merged.refused.get(slot.spec.id);
              const imageUrl = (rec?.mediaId ? mediaUrls[rec.mediaId] : undefined) ?? merged.previews.get(slot.spec.id);
              return (
                <li key={slot.spec.id} data-slot={slot.spec.id} className="scroll-mt-24 rounded-2xl transition-shadow data-[flash]:ring-4 data-[flash]:ring-amber-400">
                  <Slot
                    projectId={projectId}
                    step={step}
                    slot={slot}
                    waiting={Boolean(rec?.id && merged.waiting.has(rec.id))}
                    {...(refused ? { refused } : {})}
                    {...(imageUrl ? { imageUrl } : {})}
                    {...(disabledReason ? { disabledReason } : {})}
                    meId={me.id}
                  />
                </li>
              );
            })}
          </ul>

          <fieldset className="pt-1" disabled={busy || Boolean(refusal)}>
            <legend className="mb-2 text-sm font-semibold text-ink-900">Outcome</legend>
            <div className="grid grid-cols-4 gap-1 rounded-full bg-surface p-1">
              {OUTCOMES.map((o) => {
                // Pass shows as chosen only once it's real: recorded, or the evidence is all in.
                const shown = view.latest ? current : view.state === "done" ? "pass" : null;
                const selected = picking ? picking === o.value : shown === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setError(null);
                      setPassNote(null);
                      if (o.value === "pass") {
                        setPicking(null);
                        if (current !== "pass") void save("pass");
                        else if (view.state !== "done") explainPass();
                        return;
                      }
                      setPicking(o.value);
                    }}
                    className={`min-h-12 rounded-full text-sm font-semibold transition ${
                      selected
                        ? o.value === "pass"
                          ? "bg-white text-emerald-800 shadow-sm"
                          : o.value === "na"
                            ? "bg-white text-ink-900 shadow-sm"
                            : "bg-red-700 text-white shadow-sm"
                        : "text-ink-700 hover:bg-white/70"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {current === "pass" && !picking && (
              <p className="mt-2 text-sm text-ink-500">
                {view.state === "done"
                  ? view.test
                    ? "Every reading is in and the test passes: this step is done."
                    : "Every required slot is in: this step is done."
                  : view.test
                    ? "The readings decide this test: it passes once they're all in and within the job's limits. Fail, Blocked or N/A need a reason."
                    : "Pass once every slot above is captured. Fail, Blocked or N/A need a reason."}
              </p>
            )}
            {current !== "pass" && !picking && <p className="mt-2 text-sm text-ink-500">Tap Pass to clear it once it's sorted: the evidence decides from there.</p>}
            {picking && (
              <div className="mt-3 space-y-2">
                <label htmlFor={`${id}-reason`} className="block text-sm font-semibold text-ink-900">
                  {picking === "blocked" ? "What's stopping it? (the office gets an issue)" : picking === "fail" ? "What failed?" : "Why doesn't this apply?"}
                </label>
                <textarea
                  id={`${id}-reason`}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
                />
                {picking === "fail" && step.critical && <p className="text-sm font-medium text-red-800">A critical step failed: stop here. The tech lead reviews it before anything moves on.</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPicking(null)} className="min-h-12 flex-1 rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void save(picking)}
                    className="min-h-12 flex-1 rounded-full bg-ink-900 px-4 font-semibold text-white disabled:opacity-40"
                  >
                    {busy ? "Saving…" : `Mark ${OUTCOMES.find((o) => o.value === picking)!.label}`}
                  </button>
                </div>
              </div>
            )}
            {passNote && (
              <p role="alert" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-base font-semibold text-amber-900">
                {passNote}
              </p>
            )}
            {(error ?? merged.refused.get(`step:${step.id}`)) && (
              <p role="alert" className="mt-2 text-sm font-medium text-red-700">
                {error ?? `Not saved: ${merged.refused.get(`step:${step.id}`)}`}
              </p>
            )}
          </fieldset>
        </div>
      )}
    </li>
  );
}
