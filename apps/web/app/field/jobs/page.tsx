import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/kit";
import { JobCard } from "@/components/field/job-card";
import { FieldIdentity } from "@/components/field/field-identity";
import { SyncBadge } from "@/components/field/sync-badge";
import { requireStaff } from "@/lib/auth/server";
import { listMyJobs } from "@/lib/field-server";

/** My jobs: today, the next three weeks, and the last three weeks. */

export const metadata: Metadata = { title: "My jobs" };
export const dynamic = "force-dynamic";

export default async function FieldJobsPage() {
  const staff = await requireStaff();
  let jobs: Awaited<ReturnType<typeof listMyJobs>> | null = null;
  try {
    jobs = await listMyJobs(staff);
  } catch (err) {
    console.error("[field] jobs failed:", err);
  }
  const sections = jobs
    ? [
        { id: "today", title: "Today", items: jobs.todayJobs, compact: false },
        { id: "upcoming", title: "Coming up", items: jobs.upcoming, compact: true },
        { id: "recent", title: "Recent", items: jobs.recent, compact: true },
      ]
    : [];
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <>
      <SyncBadge />
      <FieldIdentity id={staff.id} name={staff.name} />
      <PageHeader eyebrow="Jobs" title="My jobs" subtitle="Installs you're crewing and surveys you're doing, three weeks either side of today." />
      {!jobs && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
          We couldn&apos;t load your jobs. Check your signal and try again.
        </div>
      )}
      {jobs && total === 0 && (
        <EmptyState title="No jobs yet" body="Jobs you're assigned to show here: the office puts you on a crew or a survey from the ops board." />
      )}
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <section key={s.id} aria-labelledby={`jobs-${s.id}`} className="mb-8">
            <h2 id={`jobs-${s.id}`} className="mb-3 font-display text-2xl text-ink-900">
              {s.title} <span className="font-sans text-base font-semibold text-ink-500">({s.items.length})</span>
            </h2>
            <ul className="space-y-4">
              {s.items.map((j) => (
                <li key={`${s.id}-${j.kind}-${j.projectId}`}>
                  <JobCard job={j} today={jobs!.today} compact={s.compact} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
