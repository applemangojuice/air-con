"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { INSTALL_PHASES, canRecord, isStepFinished, runsheetDays, runsheetProgress, stepView, stepsForDay, type StepView } from "@aircon/domain";
import { QuickActions } from "./quick-actions";
import { StepCard } from "./step-card";
import { HeaderTitle, SyncBadge } from "./sync-badge";
import type { FieldJob } from "./types";
import { useMergedJob, useRefreshOnSync } from "./use-outbox";
import { fmtDay, londonTime } from "./format";
import { useFieldJob } from "./server-answer";

/**
 * The day runsheet: the day's steps, phase by phase, each with its
 * evidence and outcome. All three days load together, so switching days
 * works without signal. The step to do next is open; finishing it opens
 * the one after. It renders from the day layout, so a refresh after a sync
 * updates it in place; the day comes from the URL.
 */

/** The id each step card carries, for "Next for you" and the scroll on opening. */
const stepAnchor = (stepId: string) => `step-${stepId}`;

/** The first unfinished step on the day this person can record (not blocked, not locked to someone else). */
function nextForMe(views: StepView[], staff: FieldJob["me"]["staff"], today: string): StepView | undefined {
  return views.find((v) => !isStepFinished(v) && v.state !== "blocked" && canRecord(v.step, staff, today).ok);
}

function dayFromPath(pathname: string | null): number {
  const n = Number.parseInt(/\/day\/(\d+)/.exec(pathname ?? "")?.[1] ?? "1", 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function Runsheet({ data: page }: { data: FieldJob }) {
  useRefreshOnSync();
  // The header as the newest of the page and this phone's answered steps: starting the day opens
  // the runsheet from the server's answer, not from a refresh landing (server-answer.ts).
  const data = useFieldJob(page);
  const { header, me } = data;
  const merged = useMergedJob(data.job, me);
  const days = merged ? runsheetDays(merged.job.runsheet) : [1, 2, 3];
  const pathname = usePathname();
  const [day, setDay] = useState(() => Math.min(dayFromPath(pathname), days.length));

  // A link to another day (the job pack, Today) moves the tabs too.
  useEffect(() => {
    const d = Math.min(dayFromPath(pathname), days.length);
    if (d !== day) switchDay(d, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const views: StepView[] = useMemo(() => (merged ? stepsForDay(merged.job.runsheet, day).map((s) => stepView(merged.job, s)) : []), [merged, day]);
  const progress = useMemo(() => (merged ? runsheetProgress(merged.job) : null), [merged]);
  const firstOpen = views.find((v) => !isStepFinished(v))?.step.id;
  // The first step still to do that this person can record (the electrician's circuit at the bottom of day 2).
  const mine = nextForMe(views, me.staff, header.today);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([firstOpen, mine?.step.id].filter((x): x is string => Boolean(x))));
  const mineIndex = mine ? views.findIndex((v) => v.step.id === mine.step.id) : -1;

  // Opening the runsheet (or another day) takes them to their next step when finished work sits above it.
  const scrollPending = useRef(true);
  useEffect(() => {
    if (!scrollPending.current || !merged) return;
    scrollPending.current = false;
    if (!mine || mineIndex <= 0) return;
    document.getElementById(stepAnchor(mine.step.id))?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, merged, mine?.step.id]);
  const finishedBefore = useRef<Set<string>>(new Set(views.filter(isStepFinished).map((v) => v.step.id)));

  // A step that's just been finished folds away and the next one opens.
  useEffect(() => {
    const now = new Set(views.filter(isStepFinished).map((v) => v.step.id));
    const newly = [...now].filter((id) => !finishedBefore.current.has(id));
    finishedBefore.current = now;
    if (!newly.length) return;
    setExpanded((prev) => {
      const next = new Set([...prev].filter((id) => !newly.includes(id)));
      const after = views.find((v) => !isStepFinished(v));
      if (after) next.add(after.step.id);
      return next;
    });
  }, [views]);

  function switchDay(d: number, updateUrl = true) {
    setDay(d);
    const dayViews = merged ? stepsForDay(merged.job.runsheet, d).map((s) => stepView(merged.job, s)) : [];
    const first = dayViews.find((v) => !isStepFinished(v))?.step.id;
    const forMe = nextForMe(dayViews, me.staff, header.today)?.step.id;
    setExpanded(new Set([first, forMe].filter((x): x is string => Boolean(x))));
    if (updateUrl) window.history.replaceState(null, "", `/field/jobs/${header.projectId}/day/${d}`);
    window.scrollTo({ top: 0 });
    scrollPending.current = true;
  }

  const refusal =
    header.installStatus === "not-started"
      ? "Day 1 hasn't started. Tap Actions, then Arrived, to start it."
      : header.handoverStatus === "handed-over"
        ? "This job is handed over, so the runsheet is closed."
        : null;
  const installClosed = header.handoverStatus !== "pending";
  const thisDay = header.days.find((d) => d.n === day);
  const dayStats = progress?.byDay.find((d) => d.day === day);
  const pct = dayStats && dayStats.total ? Math.round((dayStats.done / dayStats.total) * 100) : 0;
  const phases = INSTALL_PHASES.filter((p) => views.some((v) => v.step.phase === p.n));

  return (
    <>
      <SyncBadge />
      <HeaderTitle>{header.customerName}</HeaderTitle>

      <nav aria-label="This job" className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-2">
          <li>
            <Link href={`/field/jobs/${header.projectId}`} className="flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-base font-semibold text-ink-900">
              Job pack
            </Link>
          </li>
          {days.map((d) => (
            <li key={d}>
              <button
                type="button"
                aria-current={d === day ? "page" : undefined}
                onClick={() => switchDay(d)}
                className={`min-h-11 rounded-full border px-4 text-base font-semibold ${d === day ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-900"}`}
              >
                Day {d}
              </button>
            </li>
          ))}
          <li>
            <Link href={`/field/jobs/${header.projectId}/commissioning`} className="flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-base font-semibold text-ink-900">
              Commission
            </Link>
          </li>
          <li>
            <Link href={`/field/jobs/${header.projectId}/handover`} className="flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-base font-semibold text-ink-900">
              Handover
            </Link>
          </li>
        </ul>
      </nav>

      <header className="mb-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">
          Day {day} of {header.totalDays}
          {thisDay?.date ? ` · ${fmtDay(thisDay.date)}` : header.dates[day - 1] ? ` · planned ${fmtDay(header.dates[day - 1]!)}` : ""}
        </p>
        <h1 className="font-display text-3xl leading-tight text-ink-900">{day === 1 ? "Prep and building work" : day === 2 ? "Mechanical and electrical" : day === 3 ? "Test, commission, hand over" : `Day ${day}`}</h1>
        <p className="mt-1 text-base text-ink-700">
          {thisDay?.status === "in-progress"
            ? `Under way since ${londonTime(thisDay.startedAt)}`
            : thisDay?.status === "done"
              ? `Ended ${londonTime(thisDay.endedAt)}`
              : "Not started"}
          <span className="text-ink-500"> · {header.address}</span>
        </p>
        {dayStats && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-ink-900">
                {dayStats.done} of {dayStats.total} steps done
              </span>
              {progress && (progress.openExceptions > 0 || progress.blocked > 0) && (
                <span className="font-semibold text-red-800">
                  {[progress.openExceptions ? `${progress.openExceptions} to review` : "", progress.blocked ? `${progress.blocked} blocked` : ""].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Day ${day} progress`}>
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {mine && mineIndex > 0 && (
          <a
            href={`#${stepAnchor(mine.step.id)}`}
            onClick={(e) => {
              e.preventDefault();
              setExpanded((prev) => new Set([...prev, mine.step.id]));
              document.getElementById(stepAnchor(mine.step.id))?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="mt-3 flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-2 text-base"
          >
            <span className="min-w-0">
              <span className="font-semibold text-ink-900">Next for you: </span>
              <span className="text-ink-700">
                {mine.step.title}
                {mine.step.item ? ` · ${mine.step.item}` : ""}
              </span>
            </span>
            <span aria-hidden className="shrink-0 font-semibold text-accent-700">
              ↓
            </span>
          </a>
        )}
      </header>

      {!merged && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900">
          <p className="font-semibold">There&apos;s no runsheet for this job yet.</p>
          <p className="mt-1 text-base">{data.jobProblem ?? "Ask the office to check the design and booking."}</p>
        </div>
      )}

      {merged && refusal && (
        <p role="status" className="mb-4 rounded-2xl bg-ink-900 px-4 py-3 text-base font-semibold text-white">
          {refusal}
        </p>
      )}
      {merged && !refusal && installClosed && (
        <p role="status" className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-800">
          Commissioning is signed: the install steps are closed. The walkthrough is done at handover.
        </p>
      )}

      {merged && (
        <div className="space-y-7">
          {phases.map((p) => (
            <section key={p.n} aria-labelledby={`phase-${p.n}`}>
              <h2 id={`phase-${p.n}`} className="font-display text-xl text-ink-900">
                <span className="text-ink-500">{p.n} · </span>
                {p.title}
              </h2>
              <p className="mb-3 text-sm text-ink-500">{p.strap}</p>
              <ul className="space-y-3">
                {views
                  .filter((v) => v.step.phase === p.n)
                  .map((v) => (
                    <StepCard
                      key={v.step.id}
                      projectId={header.projectId}
                      view={v}
                      merged={merged}
                      me={me.staff}
                      today={header.today}
                      mediaUrls={data.mediaUrls}
                      refusal={
                        refusal && !(header.installStatus === "not-started" && v.step.evidence.some((e) => e.role === "rams"))
                          ? refusal
                          : installClosed && v.step.stage !== "handover"
                            ? "Closed: commissioning is signed."
                            : null
                      }
                      expanded={expanded.has(v.step.id)}
                      onToggle={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(v.step.id)) next.delete(v.step.id);
                          else next.add(v.step.id);
                          return next;
                        })
                      }
                    />
                  ))}
              </ul>
            </section>
          ))}
          {views.length === 0 && <p className="rounded-2xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-ink-500">Nothing on this day.</p>}

          <div className="rounded-2xl border border-line bg-white p-4">
            {day < days.length ? (
              <button type="button" onClick={() => switchDay(day + 1)} className="min-h-12 w-full rounded-full border border-line bg-white px-5 font-semibold text-ink-900">
                Day {day + 1}: {day + 1 === 2 ? "mechanical and electrical" : "test, commission, hand over"} →
              </button>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href={`/field/jobs/${header.projectId}/commissioning`} className="flex min-h-12 items-center justify-center rounded-full bg-accent-700 px-5 font-semibold text-white">
                  Commissioning sign-off
                </Link>
                <Link href={`/field/jobs/${header.projectId}/handover`} className="flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-5 font-semibold text-ink-900">
                  Handover with the customer
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {header.bookingStatus === "booked" && (
        <>
          {/* Room under the floating Actions button, so the last step is never hidden behind it. */}
          <div aria-hidden className="h-16" />
          <QuickActions data={data} merged={merged} day={day} />
        </>
      )}
    </>
  );
}
