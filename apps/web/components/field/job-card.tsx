import Link from "next/link";
import type { JobCard as JobCardData, RiskFlag } from "./types";
import { crewLabel, fmtDay, londonTime, slotTime, telHref } from "./format";

/**
 * One visit on Today: where, which day, who, what to watch for, and the
 * one thing to do next (open the job). Big targets: call, maps, open.
 */

const RISK_TONE: Record<RiskFlag["tone"], string> = {
  danger: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  neutral: "border-line bg-surface text-ink-700",
};

const KIT_TONE = {
  success: "text-emerald-800",
  warn: "text-amber-800",
  info: "text-sage-700",
  neutral: "text-ink-700",
} as const;

export function RiskChips({ risks }: { risks: RiskFlag[] }) {
  if (!risks.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Risks">
      {risks.map((r) => (
        <li key={r.key} className={`rounded-full border px-3 py-1 text-sm font-semibold ${RISK_TONE[r.tone]}`}>
          {r.tone === "danger" ? "⚠ " : ""}
          {r.label}
        </li>
      ))}
    </ul>
  );
}

function statusLine(job: JobCardData, today: string): { text: string; tone: string } {
  if (job.kind === "survey") {
    if (job.surveyStatus === "in-progress") return { text: "Survey under way", tone: "bg-sage-50 text-sage-800" };
    if (job.surveyStatus === "submitted") return { text: "Survey submitted", tone: "bg-emerald-50 text-emerald-800" };
    return { text: "Booked", tone: "bg-surface text-ink-700" };
  }
  if (job.wrapUp) {
    const { handover, endDay } = job.wrapUp;
    const text = handover && endDay ? "Commissioned · hand over and end the day" : handover ? "Commissioned · hand over" : "Handed over · end the day";
    return { text, tone: "bg-sage-50 text-sage-800" };
  }
  if (job.handoverStatus === "handed-over") return { text: "Handed over", tone: "bg-emerald-50 text-emerald-800" };
  if (job.installStatus === "complete") return { text: "Install complete", tone: "bg-emerald-50 text-emerald-800" };
  if (job.dayStatus === "in-progress") return { text: `On site since ${londonTime(job.startedAt)}`, tone: "bg-sage-50 text-sage-800" };
  if (job.dayStatus === "done") return { text: "Day done", tone: "bg-emerald-50 text-emerald-800" };
  return { text: job.date === today ? "Not started" : "Booked", tone: "bg-surface text-ink-700" };
}

export function JobCard({ job, today, compact = false }: { job: JobCardData; today: string; compact?: boolean }) {
  const status = statusLine(job, today);
  const eyebrow =
    job.kind === "survey"
      ? `Home survey · ${job.scheduledFor ? `${job.date === today ? "" : `${fmtDay(job.date)}, `}${slotTime(job.scheduledFor)}` : "time not set"}`
      : `Install · ${job.dayN ? `Day ${job.dayN} of ${job.totalDays ?? 3}` : "Booked"}${job.date !== today ? ` · ${fmtDay(job.date)}` : ""}`;
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">{eyebrow}</p>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.tone}`}>{status.text}</span>
        </div>
        <h2 className="mt-2 font-display text-2xl leading-tight text-ink-900">{job.customerName}</h2>
        <p className="mt-1 text-base text-ink-700">
          {job.address}
          {job.postcode ? `, ${job.postcode}` : ""}
        </p>
        {job.pilotLabel && <p className="mt-1 text-sm text-ink-500">{job.pilotLabel}</p>}

        {!compact && (
          <>
            {(job.parkingNotes || job.accessNotes) && (
              <dl className="mt-4 space-y-2 rounded-2xl bg-surface px-4 py-3 text-base">
                {job.parkingNotes && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Parking</dt>
                    <dd className="text-ink-900">{job.parkingNotes}</dd>
                  </div>
                )}
                {job.accessNotes && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Access</dt>
                    <dd className="text-ink-900">{job.accessNotes}</dd>
                  </div>
                )}
              </dl>
            )}
            <dl className="mt-4 grid grid-cols-1 gap-3 text-base sm:grid-cols-2">
              {job.crew.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{job.kind === "survey" ? "Surveyor" : "Crew"}</dt>
                  <dd className="text-ink-900">{job.crew.map(crewLabel).join(", ")}</dd>
                </div>
              )}
              {job.kitLabel && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Kit</dt>
                  <dd className={`font-semibold ${KIT_TONE[job.kitTone ?? "neutral"]}`}>{job.kitLabel}</dd>
                </div>
              )}
            </dl>
            {job.risks.length > 0 && (
              <div className="mt-4">
                <RiskChips risks={job.risks} />
              </div>
            )}
            {job.progressPct !== undefined && (
              <div className="mt-4">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-ink-700">Runsheet</span>
                  <span className="tabular-nums text-ink-700">{job.progressPct}%</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={job.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Runsheet progress">
                  <div className="h-full rounded-full bg-sage-500" style={{ width: `${job.progressPct}%` }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-line bg-cream/60 p-3">
        {job.customerPhone ? (
          <a href={telHref(job.customerPhone)} className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line bg-white px-4 font-semibold text-ink-900" aria-label={`Call ${job.customerName}`}>
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
            </svg>
            Call
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center rounded-full px-3 text-sm text-ink-500">No phone</span>
        )}
        <a href={job.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          Maps
        </a>
        <Link href={job.href} className="order-first col-span-2 flex min-h-12 items-center justify-center gap-1 whitespace-nowrap rounded-full bg-accent-700 px-4 font-semibold text-white shadow-sm hover:bg-accent-800">
          {job.kind === "survey" ? "Open survey" : "Open job"}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
