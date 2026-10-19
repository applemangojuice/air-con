import type { Metadata } from "next";
import { EmptyState, LinkButton } from "@/components/kit";
import { JobCard } from "@/components/field/job-card";
import { FieldIdentity } from "@/components/field/field-identity";
import { SyncBadge } from "@/components/field/sync-badge";
import { firstName, fmtDay } from "@/components/field/format";
import { requireStaff } from "@/lib/auth/server";
import { listMyJobs } from "@/lib/field-server";

/**
 * Today: the signed-in person's visits for the day as big cards (install
 * days they're crewing, surveys they're doing), with the next one up when
 * the day is empty. Staff with the board-wide view also see the team.
 */

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function FieldTodayPage() {
  const staff = await requireStaff();
  let jobs: Awaited<ReturnType<typeof listMyJobs>> | null = null;
  let failed = false;
  try {
    jobs = await listMyJobs(staff);
  } catch (err) {
    console.error("[field] today failed:", err);
    failed = true;
  }
  const today = jobs?.today ?? "";
  const count = jobs?.todayJobs.length ?? 0;
  const next = jobs?.upcoming[0];

  return (
    <>
      <SyncBadge />
      <FieldIdentity id={staff.id} name={staff.name} />
      <header className="mb-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink-500">Today{today ? ` · ${fmtDay(today)}` : ""}</p>
        <h1 className="font-display text-4xl leading-tight text-ink-900">Hi {firstName(staff.name)}</h1>
        <p className="mt-1 text-base text-ink-500" aria-live="polite">
          {failed ? "Your jobs couldn't be loaded." : count === 0 ? "Nothing booked for you today." : `${count} visit${count === 1 ? "" : "s"} today.`}
        </p>
      </header>

      {failed && (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
          <p className="font-semibold">We couldn't load your jobs.</p>
          <p className="mt-1 text-sm">Check your signal and pull down to refresh. If it keeps happening, call the office.</p>
        </div>
      )}

      {jobs && count > 0 && (
        <ul className="space-y-5">
          {jobs.todayJobs.map((j) => (
            <li key={`${j.kind}-${j.projectId}`}>
              <JobCard job={j} today={today} />
            </li>
          ))}
        </ul>
      )}

      {jobs && count === 0 && (
        <div className="space-y-5">
          {next ? (
            <section aria-labelledby="next-up">
              <h2 id="next-up" className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
                Next up · {fmtDay(next.date)}
              </h2>
              <JobCard job={next} today={today} />
            </section>
          ) : (
            <EmptyState
              title="No visits booked"
              body="When you're put on an install crew or given a survey, it shows here on the day, with the address, access notes and everything for the job."
              action={<LinkButton href="/field/jobs" variant="secondary" size="lg">See all my jobs</LinkButton>}
            />
          )}
        </div>
      )}

      {jobs && jobs.team.length > 0 && (
        <section aria-labelledby="team-today" className="mt-10">
          <h2 id="team-today" className="mb-3 font-display text-2xl text-ink-900">
            The team today
          </h2>
          <ul className="space-y-4">
            {jobs.team.map((j) => (
              <li key={`team-${j.kind}-${j.projectId}`}>
                <JobCard job={j} today={today} compact />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
