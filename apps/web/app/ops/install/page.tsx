import Link from "next/link";
import type { Metadata } from "next";
import {
  demoInstallJobs,
  scoreInstallation,
  type InstallJob,
  type QaStatus,
  type QcScorecard,
} from "@aircon/domain";
import { fmtDay } from "@/lib/format";

export const metadata: Metadata = {
  title: "Installation OS · admin",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Quality control dashboard: every install scored automatically from its
 * evidence. Auto-approved jobs never wait for a human; only exceptions do.
 * Demo jobs until real installs run through the engineer runsheet.
 */

const QA_UI: Record<QaStatus, { chip: string; label: string }> = {
  "in-progress": { chip: "bg-sage-100 text-sage-700", label: "In progress" },
  "auto-approved": { chip: "bg-emerald-50 text-emerald-800", label: "Auto-approved" },
  exceptions: { chip: "bg-amber-50 text-amber-800", label: "Exceptions" },
  "signed-off": { chip: "bg-emerald-50 text-emerald-800", label: "Signed off" },
};

function Tick({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="font-bold text-emerald-600">✓</span>
  ) : (
    <span className="text-ink-300">·</span>
  );
}

export default function InstallOsPage() {
  const jobs = demoInstallJobs(new Date().toISOString());
  const scored = jobs.map((job) => ({ job, score: scoreInstallation(job) }));
  const needsHuman = scored.filter((s) => s.score.qaStatus === "exceptions");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Installation OS</h1>
          <p className="mt-1 text-sm text-ink-500">
            Airline-checklist installs, built on evidence instead of memory.
            Every step demands a photo, a reading or a scan; the software
            scores the job and only exceptions reach a human.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← Console
        </Link>
      </div>

      {/* Review queue: the whole point of evidence-first. */}
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="font-bold text-amber-900">
          Review queue: {needsHuman.length} job{needsHuman.length === 1 ? "" : "s"}
        </h2>
        {needsHuman.length === 0 ? (
          <p className="mt-1 text-sm text-amber-800">
            Nothing needs you. Every completed job auto-approved on its evidence.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {needsHuman.flatMap(({ job, score }) =>
              score.exceptions.map((ex) => (
                <li key={ex.specId} className="rounded-2xl bg-white/70 p-3 text-sm">
                  <span className="font-semibold">
                    {job.customer} ({job.postcode})
                  </span>
                  : {ex.step}
                  {ex.item ? ` · ${ex.item}` : ""} · {ex.label}.{" "}
                  <span className="text-amber-900">{ex.reason}</span>
                </li>
              )),
            )}
          </ul>
        )}
        <p className="mt-3 text-xs text-amber-800">
          That is the entire human workload. Everything green looked after itself.
        </p>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {scored.map(({ job, score }) => (
          <JobCard key={job.id} job={job} score={score} />
        ))}
      </div>

      <p className="mt-8 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-500">
        These are demo jobs so the scoring is explorable. Open one to walk the
        engineer runsheet: capture evidence, watch the score move, try logging
        a vacuum reading of 1200 microns and see it land in the review queue.
        Real jobs generate their runsheet from the{" "}
        <Link href="/ops/design" className="font-semibold text-accent-700 underline">
          design studio
        </Link>{" "}
        blueprint on the day kit ships.
      </p>
    </main>
  );
}

function JobCard({ job, score }: { job: InstallJob; score: QcScorecard }) {
  const qa = QA_UI[score.qaStatus];
  return (
    <Link
      href={`/ops/install/${job.id}`}
      className="group rounded-3xl border border-line bg-white p-6 transition hover:border-accent-400 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold group-hover:text-accent-700">{job.customer}</h3>
          <p className="text-xs text-ink-500">
            {job.postcode} · {fmtDay(job.scheduledOn)} · {job.engineer}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${qa.chip}`}>
          {qa.label}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-3xl font-display">{score.completenessPct}%</p>
          <p className="text-xs text-ink-500">installation completeness</p>
        </div>
        <div className="text-right text-xs text-ink-500">
          <p>
            Photos {score.photos.captured}/{score.photos.required}
          </p>
          <p>
            Readings {score.readings.captured}/{score.readings.required}
          </p>
        </div>
      </div>

      {/* Completeness bar */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full ${score.exceptions.length > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${score.completenessPct}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-5 gap-1 text-center text-xs text-ink-500">
        <div><Tick ok={score.gates.pressureTest} /><p className="mt-0.5">Pressure</p></div>
        <div><Tick ok={score.gates.vacuum} /><p className="mt-0.5">Vacuum</p></div>
        <div><Tick ok={score.gates.commissioning} /><p className="mt-0.5">Commission</p></div>
        <div><Tick ok={score.gates.walkthrough} /><p className="mt-0.5">Walkthrough</p></div>
        <div><Tick ok={score.gates.warranty} /><p className="mt-0.5">Warranty</p></div>
      </div>
    </Link>
  );
}
