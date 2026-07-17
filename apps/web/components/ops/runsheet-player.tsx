"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EVIDENCE_KIND_LABEL,
  INSTALL_PHASES,
  latestEvidence,
  NUMERIC_KINDS,
  plausibleValue,
  scoreInstallation,
  slotStatus,
  submitEvidence,
  type EvidenceSpec,
  type InstallJob,
  type InstallStep,
  type SlotStatus,
} from "@aircon/domain";
import { fmtDayTime } from "@/lib/format";

/**
 * The engineer runsheet, playable in the browser. Same reducer the mobile
 * capture app will use: evidence in, score out, exceptions surface on their
 * own. Progress persists locally so a walkthrough survives a refresh.
 */

const STORAGE_PREFIX = "dih.install.";

const SLOT_UI: Record<SlotStatus, { dot: string; ring: string }> = {
  missing: { dot: "bg-ink-300", ring: "border-line" },
  pass: { dot: "bg-emerald-500", ring: "border-emerald-200" },
  exception: { dot: "bg-red-500", ring: "border-red-200" },
};

export function RunsheetPlayer({ initialJob }: { initialJob: InstallJob }) {
  const [job, setJob] = useState(initialJob);
  const [openPhase, setOpenPhase] = useState<number>(1);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = `${STORAGE_PREFIX}${initialJob.id}.v1`;

  // Restore a saved walkthrough after mount; server HTML stays deterministic.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as InstallJob;
        if (parsed.id === initialJob.id && Array.isArray(parsed.evidence)) {
          setJob({ ...parsed, runsheet: initialJob.runsheet });
        }
      }
    } catch {
      // Corrupt saved state: start from the seeded job.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(job));
    } catch {
      // Storage full or blocked: the walkthrough still works, it just won't persist.
    }
  }, [job, hydrated, storageKey]);

  const score = useMemo(() => scoreInstallation(job), [job]);

  function capture(spec: EvidenceSpec, value?: number) {
    const payload = NUMERIC_KINDS.has(spec.kind)
      ? { value }
      : {
          ref: `${spec.kind}-${spec.id}-${job.evidence.length + 1}`,
          gps: spec.kind === "gps" ? { lat: 51.4312, lng: -0.1276 } : undefined,
        };
    setJob((j) => submitEvidence(j, spec.id, payload, new Date().toISOString()));
  }

  function reset() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to clean up if storage is blocked.
    }
    setJob(initialJob);
    setOpenPhase(1);
  }

  const stepsByPhase = useMemo(() => {
    const map = new Map<number, InstallStep[]>();
    for (const step of job.runsheet) {
      map.set(step.phase, [...(map.get(step.phase) ?? []), step]);
    }
    return map;
  }, [job.runsheet]);

  return (
    <div>
      {/* Live scorecard */}
      <section className="sticky top-0 z-10 -mx-4 border-b border-line bg-cream/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-3xl sm:border sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <p className="text-3xl font-display">{score.completenessPct}%</p>
            <div className="text-xs text-ink-500">
              <p>
                Evidence {score.slots.captured}/{score.slots.required} · Photos{" "}
                {score.photos.captured}/{score.photos.required}
              </p>
              <p>
                {score.exceptions.length === 0
                  ? "No exceptions. The job is approving itself."
                  : `${score.exceptions.length} exception${score.exceptions.length === 1 ? "" : "s"} waiting on review`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                score.qaStatus === "auto-approved" || score.qaStatus === "signed-off"
                  ? "bg-emerald-50 text-emerald-800"
                  : score.qaStatus === "exceptions"
                    ? "bg-amber-50 text-amber-800"
                    : "bg-sage-100 text-sage-700"
              }`}
            >
              {score.qaStatus === "in-progress"
                ? "In progress"
                : score.qaStatus === "auto-approved"
                  ? "Auto-approved"
                  : score.qaStatus === "signed-off"
                    ? "Signed off"
                    : "Exceptions"}
            </span>
            <button
              onClick={reset}
              className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-500 hover:border-accent-400 hover:text-accent-700"
            >
              Reset demo
            </button>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
          <div
            className={`h-full rounded-full transition-all ${score.exceptions.length > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${score.completenessPct}%` }}
          />
        </div>
      </section>

      {/* Phases */}
      <div className="mt-6 space-y-3">
        {INSTALL_PHASES.map((phase) => {
          const steps = stepsByPhase.get(phase.n) ?? [];
          const specs = steps.flatMap((s) => s.evidence);
          const done = specs.filter(
            (e) => slotStatus(e, latestEvidence(job, e.id)) === "pass",
          ).length;
          const exceptions = specs.filter(
            (e) => slotStatus(e, latestEvidence(job, e.id)) === "exception",
          ).length;
          const open = openPhase === phase.n;
          return (
            <section key={phase.n} className="rounded-3xl border border-line bg-white">
              <button
                onClick={() => setOpenPhase(open ? 0 : phase.n)}
                className="flex w-full items-center justify-between gap-3 p-5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      exceptions > 0
                        ? "bg-red-50 text-red-700"
                        : done === specs.length
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-surface text-ink-500"
                    }`}
                  >
                    {exceptions > 0 ? "!" : done === specs.length ? "✓" : phase.n}
                  </span>
                  <div>
                    <h2 className="font-bold">
                      Phase {phase.n} · {phase.title}
                    </h2>
                    <p className="text-xs text-ink-500">{phase.strap}</p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold text-ink-500">
                  {done}/{specs.length} {open ? "▴" : "▾"}
                </span>
              </button>
              {open && (
                <div className="space-y-4 border-t border-line p-5">
                  {steps.map((step) => (
                    <StepBlock key={step.id} step={step} job={job} onCapture={capture} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Exceptions detail */}
      {score.exceptions.length > 0 && (
        <section className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6">
          <h2 className="font-bold text-red-900">Exceptions on this job</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-red-900">
            {score.exceptions.map((ex) => (
              <li key={ex.specId}>
                {ex.step}
                {ex.item ? ` · ${ex.item}` : ""}: {ex.label}. {ex.reason} Re-capture in range to
                clear it; the log keeps both readings.
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StepBlock({
  step,
  job,
  onCapture,
}: {
  step: InstallStep;
  job: InstallJob;
  onCapture: (spec: EvidenceSpec, value?: number) => void;
}) {
  return (
    <div>
      <p className="text-sm font-bold">
        {step.title}
        {step.item && <span className="ml-1.5 font-normal text-ink-500">· {step.item}</span>}
      </p>
      <div className="mt-2 space-y-2">
        {step.evidence.map((spec) => (
          <SlotRow key={spec.id} spec={spec} job={job} onCapture={onCapture} />
        ))}
      </div>
    </div>
  );
}

function SlotRow({
  spec,
  job,
  onCapture,
}: {
  spec: EvidenceSpec;
  job: InstallJob;
  onCapture: (spec: EvidenceSpec, value?: number) => void;
}) {
  const record = latestEvidence(job, spec.id);
  const status = slotStatus(spec, record);
  const ui = SLOT_UI[status];
  const numeric = NUMERIC_KINDS.has(spec.kind);
  const [draft, setDraft] = useState("");

  const window =
    spec.min !== undefined && spec.max !== undefined
      ? `${spec.min} to ${spec.max} ${spec.unit}`
      : spec.min !== undefined
        ? `min ${spec.min} ${spec.unit}`
        : spec.max !== undefined
          ? `max ${spec.max} ${spec.unit}`
          : undefined;

  return (
    <div className={`rounded-2xl border p-3 ${ui.ring}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ui.dot}`} />
          <div className="min-w-0">
            <p className="text-sm">
              {spec.label}{" "}
              <span className="text-xs text-ink-300">
                · {EVIDENCE_KIND_LABEL[spec.kind]}
                {window ? ` · ${window}` : ""}
              </span>
            </p>
            {record && (
              <p className="text-xs text-ink-500">
                {numeric && record.value !== undefined
                  ? `Logged ${record.value} ${spec.unit ?? ""}`
                  : "Captured"}{" "}
                · {fmtDayTime(record.at)} · {record.by}
                {status === "exception" && (
                  <span className="ml-1 font-semibold text-red-700">out of range</span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {numeric ? (
            <>
              <input
                type="number"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={String(plausibleValue(spec) ?? "")}
                className="w-24 rounded-xl border border-line px-2.5 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
                aria-label={`${spec.label} reading`}
              />
              <button
                onClick={() => {
                  const v = draft.trim() === "" ? plausibleValue(spec) : Number(draft);
                  if (v !== undefined && !Number.isNaN(v)) {
                    onCapture(spec, v);
                    setDraft("");
                  }
                }}
                className="rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-700"
              >
                Log
              </button>
            </>
          ) : (
            <button
              onClick={() => onCapture(spec)}
              className="rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-700"
            >
              {record ? "Re-capture" : "Capture"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
