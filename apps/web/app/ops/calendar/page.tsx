import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_LABEL, bankHolidayName } from "@aircon/domain";
import { Badge, EmptyState, PageHeader } from "@/components/kit";
import { requireStaff } from "@/lib/auth/server";
import { demoModeAllowed } from "@/lib/auth/demo-guard";
import { fmtDay } from "@/lib/format";
import { loadOpsProjects, loadPurchaseOrdersByProject } from "@/lib/ops-server";
import { londonToday } from "@/lib/project-service";
import * as staffRepo from "@/lib/repo/staff";
import { getServiceClient } from "@/lib/supabase-server";
import {
  calendarRange,
  crewConflicts,
  crewDay,
  eventsForProject,
  inRange,
  monthGrid,
  sortEvents,
  stepDate,
  weekDates,
  type CalEvent,
  type CalEventKind,
  type CalView,
} from "./calendar-model";

export const metadata: Metadata = { title: "Calendar · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND: Record<CalEventKind, { label: string; chip: string; dot: string }> = {
  survey: { label: "Survey", chip: "border-sage-200 bg-sage-50 text-sage-800", dot: "bg-sage-500" },
  install: { label: "Install", chip: "border-accent-100 bg-accent-50 text-accent-700", dot: "bg-accent-500" },
  delivery: { label: "Delivery", chip: "border-line bg-surface text-ink-700", dot: "bg-ink-500" },
  handover: { label: "Commissioning / handover", chip: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
};

const STATE_NOTE: Record<CalEvent["state"], string> = {
  confirmed: "",
  tentative: "not confirmed",
  expected: "",
  done: "done",
  planned: "planned",
};

/**
 * The ops calendar (projects.view-all): surveys, three-day install blocks,
 * deliveries (supplier ETAs and recorded arrivals) and commissioning and
 * handover, by month or week, plus the crew's day: who is where. Crew
 * double-bookings are flagged. Every entry links to its project.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff("projects.view-all");
  const sp = await searchParams;
  const today = londonToday();
  const range = calendarRange({ view: typeof sp.view === "string" ? sp.view : undefined, date: typeof sp.date === "string" ? sp.date : undefined }, today);
  const hasDb = Boolean(getServiceClient());

  const [projects, posByProject, team] = hasDb
    ? await Promise.all([
        loadOpsProjects({ includeClosed: true }),
        loadPurchaseOrdersByProject(),
        staffRepo.list({ activeOnly: true, ...((await demoModeAllowed()) ? {} : { includeDemo: false }) }),
      ])
    : [[], new Map(), []];
  const all = projects.flatMap(({ id, project }) => eventsForProject(project, posByProject.get(id) ?? []));
  const events = sortEvents(inRange(all, range.from, range.to));
  const conflicts = crewConflicts(events);
  const conflictKeys = new Set(conflicts.flatMap((c) => c.events.map((e) => `${e.id}|${c.staffId}`)));
  const clashing = (e: CalEvent) => e.crew.some((c) => conflictKeys.has(`${e.id}|${c.staffId}`));

  const href = (view: CalView, date: string) => `/ops/calendar?view=${view}&date=${date}`;
  const title =
    range.view === "month"
      ? `${MONTHS[Number(range.date.slice(5, 7)) - 1]} ${range.date.slice(0, 4)}`
      : range.view === "week"
        ? `Week of ${fmtDay(range.from)}`
        : fmtDay(range.date);

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Calendar"
        subtitle="Surveys, install blocks, deliveries and handovers across every job."
        actions={
          <nav aria-label="Calendar view" className="flex rounded-full border border-line bg-white p-1">
            {(["month", "week", "day"] as const).map((v) => (
              <Link
                key={v}
                href={href(v, range.date)}
                aria-current={range.view === v ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ${range.view === v ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-surface"}`}
              >
                {v === "month" ? "Month" : v === "week" ? "Week" : "Crew day"}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href(range.view, stepDate(range.view, range.date, -1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-white font-semibold text-ink-900 hover:bg-surface" aria-label="Previous">
            ←
          </Link>
          <h2 className="min-w-0 font-display text-2xl text-ink-900" aria-live="polite">
            {title}
          </h2>
          <Link href={href(range.view, stepDate(range.view, range.date, 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-white font-semibold text-ink-900 hover:bg-surface" aria-label="Next">
            →
          </Link>
          <Link href={href(range.view, today)} className="ml-1 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-accent-700 hover:bg-surface">
            Today
          </Link>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700" aria-label="Key">
          {(Object.keys(KIND) as CalEventKind[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${KIND[k].dot}`} />
              {KIND[k].label}
            </li>
          ))}
        </ul>
      </div>

      {!hasDb && <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No database is connected, so there are no jobs to show.</p>}

      {conflicts.length > 0 && (
        <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">Double-booked</p>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map((c) => (
              <li key={`${c.date}-${c.staffId}`}>
                <Link className="underline" href={href("day", c.date)}>
                  {fmtDay(c.date)}
                </Link>
                : {c.name} is down for {c.events.map((e) => `${e.customer} (${e.title.toLowerCase()})`).join(" and ")}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {range.view === "month" && <MonthView month={range.date.slice(0, 7)} today={today} events={events} clashing={clashing} dayHref={(d) => href("day", d)} />}
      {range.view === "week" && <WeekView date={range.date} today={today} events={events} clashing={clashing} dayHref={(d) => href("day", d)} />}
      {range.view === "day" && <DayView date={range.date} events={events} team={team} />}
    </main>
  );
}

/** The one-line label in a month cell. */
function shortTitle(e: CalEvent): string {
  const note = STATE_NOTE[e.state];
  switch (e.kind) {
    case "install":
      return `Day ${e.dayN ?? "?"}${e.ofDays ? `/${e.ofDays}` : ""}${note ? `, ${note}` : ""}`;
    case "survey":
      return e.state === "done" ? "Survey, done" : "Survey";
    case "delivery":
      return e.state === "done" ? "Kit delivered" : "Kit due";
    case "handover":
      return e.state === "planned" ? "Handover (planned)" : e.title;
  }
}

function EventChip({ e, clash, compact = false }: { e: CalEvent; clash: boolean; compact?: boolean }) {
  const note = STATE_NOTE[e.state];
  return (
    <Link
      href={e.href}
      className={`block rounded-xl border px-2 py-1 text-xs leading-snug transition hover:brightness-95 ${KIND[e.kind].chip} ${clash ? "ring-2 ring-red-500" : ""} ${e.state === "tentative" || e.state === "planned" ? "border-dashed" : ""}`}
    >
      <span className="block truncate font-semibold">
        {e.time ? `${e.time} ` : ""}
        {e.customer}
      </span>
      {!compact && (
        <span className="block truncate">
          {e.title}
          {note ? ` (${note})` : ""}
        </span>
      )}
      {compact && <span className="block truncate">{shortTitle(e)}</span>}
      {clash && <span className="block font-semibold text-red-700">Crew clash</span>}
    </Link>
  );
}

function Agenda({ days, events, today, clashing, dayHref }: { days: string[]; events: CalEvent[]; today: string; clashing: (e: CalEvent) => boolean; dayHref: (d: string) => string }) {
  const withEvents = days.filter((d) => events.some((e) => e.date === d));
  if (withEvents.length === 0) return <EmptyState title="Nothing in the diary" body="No surveys, installs, deliveries or handovers in this range." />;
  return (
    <ol className="space-y-4">
      {withEvents.map((d) => (
        <li key={d}>
          <Link href={dayHref(d)} className={`mb-2 inline-flex min-h-10 items-center text-sm font-semibold ${d === today ? "text-accent-700" : "text-ink-900"}`}>
            {fmtDay(d)}
            {d === today ? " · today" : ""}
          </Link>
          <ul className="space-y-1.5">
            {events
              .filter((e) => e.date === d)
              .map((e) => (
                <li key={e.id}>
                  <EventChip e={e} clash={clashing(e)} />
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function MonthView({ month, today, events, clashing, dayHref }: { month: string; today: string; events: CalEvent[]; clashing: (e: CalEvent) => boolean; dayHref: (d: string) => string }) {
  const weeks = monthGrid(month);
  const inMonthDays = weeks.flat().filter((d) => d.startsWith(month));
  return (
    <>
      <div className="md:hidden">
        <Agenda days={inMonthDays} events={events} today={today} clashing={clashing} dayHref={dayHref} />
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-white md:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface/60 text-center text-xs font-semibold uppercase tracking-wide text-ink-500">
          {DOW.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-line last:border-b-0">
            {week.map((d, i) => {
              const dayEvents = events.filter((e) => e.date === d);
              const outside = !d.startsWith(month);
              const holiday = bankHolidayName(d);
              return (
                <div key={d} className={`min-h-28 min-w-0 border-line p-1.5 ${i < 6 ? "border-r" : ""} ${outside ? "bg-surface/40" : ""} ${i >= 5 || holiday ? "bg-surface/30" : ""}`}>
                  <Link
                    href={dayHref(d)}
                    className={`mb-1 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${d === today ? "bg-accent-700 text-white" : outside ? "text-ink-500" : "text-ink-900 hover:bg-surface"}`}
                    aria-label={`${fmtDay(d)}: ${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}`}
                  >
                    {Number(d.slice(8))}
                  </Link>
                  {holiday && <p className="mb-1 truncate text-xs text-ink-500" title={`${holiday}: not a working day`}>{holiday}</p>}
                  <ul className="space-y-1">
                    {dayEvents.slice(0, 3).map((e) => (
                      <li key={e.id}>
                        <EventChip e={e} clash={clashing(e)} compact />
                      </li>
                    ))}
                  </ul>
                  {dayEvents.length > 3 && (
                    <Link href={dayHref(d)} className="mt-1 block text-xs font-semibold text-accent-700">
                      +{dayEvents.length - 3} more
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function WeekView({ date, today, events, clashing, dayHref }: { date: string; today: string; events: CalEvent[]; clashing: (e: CalEvent) => boolean; dayHref: (d: string) => string }) {
  const days = weekDates(date);
  return (
    <>
      <div className="md:hidden">
        <Agenda days={days} events={events} today={today} clashing={clashing} dayHref={dayHref} />
      </div>
      <div className="hidden grid-cols-7 gap-2 md:grid">
        {days.map((d) => (
          <section key={d} aria-label={fmtDay(d)} className={`min-h-64 min-w-0 rounded-2xl border bg-white p-2 ${d === today ? "border-accent-400" : "border-line"}`}>
            <Link href={dayHref(d)} className={`mb-2 block text-sm font-semibold ${d === today ? "text-accent-700" : "text-ink-900"}`}>
              {fmtDay(d)}
            </Link>
            {bankHolidayName(d) && <p className="-mt-1 mb-2 text-xs text-ink-500">{bankHolidayName(d)}: not a working day</p>}
            <ul className="space-y-1.5">
              {events
                .filter((e) => e.date === d)
                .map((e) => (
                  <li key={e.id}>
                    <EventChip e={e} clash={clashing(e)} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function DayView({ date, events, team }: { date: string; events: CalEvent[]; team: { id: string; name: string; roles: ("admin" | "surveyor" | "tech-lead" | "installer" | "electrician")[] }[] }) {
  const rows = crewDay(events, date, team);
  const busy = rows.filter((r) => r.jobs.length > 0);
  const free = rows.filter((r) => r.jobs.length === 0);
  const deliveries = events.filter((e) => e.date === date && e.kind === "delivery");
  return (
    <div className="space-y-6">
      <section aria-labelledby="crew-heading">
        <h3 id="crew-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
          Who is where
        </h3>
        {busy.length === 0 ? (
          <EmptyState title="Nobody's booked on a job this day" body="Surveys and install days with a crew assigned show up here." />
        ) : (
          <ul className="space-y-3">
            {busy.map((r) => (
              <li key={r.staffId} className={`rounded-2xl border bg-white p-4 ${r.clash ? "border-red-300" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-900">{r.name}</p>
                  {r.role && <Badge tone="neutral">{ROLE_LABEL[r.role]}</Badge>}
                  {r.clash && <Badge tone="danger">Two jobs at once</Badge>}
                </div>
                <ul className="mt-2 space-y-2">
                  {r.jobs.map((j) => (
                    <li key={j.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                      <span className="text-sm font-semibold text-ink-900 sm:w-48 sm:shrink-0">
                        {j.time ? `${j.time} · ` : ""}
                        {j.title}
                      </span>
                      <Link href={j.href} className="min-w-0 text-sm text-accent-700 underline">
                        {j.customer}, {j.address}
                        {j.postcode ? `, ${j.postcode}` : ""}
                      </Link>
                      {j.address && (
                        <a
                          className="text-xs font-semibold text-ink-500 underline"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${j.address} ${j.postcode}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Map
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {deliveries.length > 0 && (
        <section aria-labelledby="del-heading">
          <h3 id="del-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Deliveries
          </h3>
          <ul className="space-y-1.5">
            {deliveries.map((e) => (
              <li key={e.id}>
                <EventChip e={e} clash={false} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {free.length > 0 && (
        <p className="text-sm text-ink-500">
          <span className="font-semibold text-ink-700">Free: </span>
          {free.map((r) => r.name).join(", ")}
        </p>
      )}
    </div>
  );
}
