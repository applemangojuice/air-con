import Link from "next/link";
import type { Metadata } from "next";
import { OPS_CAPACITY, buildSchedule, type ScheduleDay } from "@aircon/domain";
import { fmtDay } from "@/lib/format";
import { loadScheduledJobs } from "@/lib/ops-server";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Schedule · admin",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Scheduling & logistics: the next six weeks on one board. Installs span
 * their days, site visits and deliveries dot the diary, double-bookings
 * light up, and repeated outcodes surface as street-batching wins.
 */
export default async function SchedulePage() {
  const demo = !getServiceClient();
  const jobs = await loadScheduledJobs();
  const schedule = buildSchedule(jobs, new Date().toISOString(), 6);
  const weeks: ScheduleDay[][] = [];
  for (let i = 0; i < schedule.days.length; i += 7) weeks.push(schedule.days.slice(i, i + 7));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display">Schedule</h1>
          <p className="mt-1 text-sm text-ink-500">
            {demo
              ? "Demo pipeline. With a database connected this reads live projects."
              : "Every live project's dates, laid onto the next six weeks."}{" "}
            Capacity today: {OPS_CAPACITY.installCrews} install crew,{" "}
            {OPS_CAPACITY.siteVisitSlotsPerDay} site-visit slots a day.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← Console
        </Link>
      </div>

      {/* Stats + warnings */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Installs booked" value={String(schedule.stats.installsBooked)} />
        <Stat
          label="Crew utilisation"
          value={`${schedule.stats.utilisationPct}%`}
          hint={`${schedule.stats.installDaysBooked} install days over ${schedule.stats.workingDays} working days`}
        />
        <Stat label="Site visits" value={String(schedule.stats.siteVisitsBooked)} />
        <Stat
          label="Double-booked days"
          value={String(schedule.conflicts.length)}
          hint={schedule.conflicts.length ? "Needs a move or a second crew" : "All clear"}
          alert={schedule.conflicts.length > 0}
        />
      </div>

      {schedule.batches.length > 0 && (
        <div className="mt-4 rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm text-sage-800">
          <p className="font-semibold">Street batching wins</p>
          {schedule.batches.map((b) => (
            <p key={b.outcode} className="mt-1">
              {b.jobs} installs in {b.outcode} ({b.dates.map(fmtDay).join(", ")}). Same crew, same
              area, minimal van miles.
            </p>
          ))}
        </div>
      )}

      {/* The board */}
      <div className="mt-6 space-y-3">
        <div className="hidden grid-cols-7 gap-2 text-center text-xs font-semibold text-ink-300 sm:grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-2 gap-2 sm:grid-cols-7">
            {week.map((day) => (
              <Day key={day.date} day={day} today={today} />
            ))}
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-ink-300">
        Dates come straight from the project timelines the customers booked. Move a date on the
        project (or the customer moves it, change fees apply) and this board updates.
      </p>
    </main>
  );
}

function Day({ day, today }: { day: ScheduleDay; today: string }) {
  const isToday = day.date === today;
  const quiet = day.installs.length === 0 && day.siteVisits.length === 0 && day.deliveries.length === 0;
  return (
    <div
      className={`min-h-24 rounded-xl border p-2 text-xs ${
        day.overbooked
          ? "border-red-300 bg-red-50"
          : isToday
            ? "border-accent-400 bg-accent-50/60"
            : day.weekend
              ? "border-line/60 bg-surface/40"
              : "border-line bg-white"
      } ${quiet && !isToday ? "opacity-70" : ""}`}
    >
      <p className={`font-semibold ${isToday ? "text-accent-700" : "text-ink-500"}`}>
        {fmtDay(day.date)}
        {isToday ? " · today" : ""}
      </p>
      <div className="mt-1.5 space-y-1">
        {day.installs.map((inst) => (
          <p
            key={`${inst.job.projectId}-${inst.dayN}`}
            className="rounded-lg bg-accent-100 px-2 py-1 font-medium text-accent-700"
          >
            🔧 {inst.job.customer.split(" ")[0]} · {inst.job.outcode}
            {inst.ofDays > 1 ? ` · day ${inst.dayN}/${inst.ofDays}` : ""}
          </p>
        ))}
        {day.siteVisits.map((job) => (
          <p key={job.projectId} className="rounded-lg bg-sage-100 px-2 py-1 font-medium text-sage-700">
            👋 Visit · {job.customer.split(" ")[0]} · {job.outcode}
          </p>
        ))}
        {day.deliveries.map((job) => (
          <p key={job.projectId} className="rounded-lg bg-surface px-2 py-1 text-ink-500">
            📦 Kit · {job.customer.split(" ")[0]}
          </p>
        ))}
        {day.overbooked && (
          <p className="font-semibold text-red-600">
            {day.installs.length} installs, {OPS_CAPACITY.installCrews} crew
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${alert ? "border-red-300 bg-red-50" : "border-line"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className={`mt-1 text-2xl font-display ${alert ? "text-red-600" : ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
