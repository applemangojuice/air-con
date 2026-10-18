import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/kit";
import { requireStaff } from "@/lib/auth/server";
import { fmtDayTime } from "@/lib/format";
import { listSurveysFor } from "@/lib/survey-server";

/**
 * /field/survey: the surveys this person can work on, under way first,
 * then theirs, then by time. Subcontractors only see the ones they're
 * assigned to.
 */

export const metadata: Metadata = { title: "Surveys" };
export const dynamic = "force-dynamic";

export default async function FieldSurveysPage() {
  const staff = await requireStaff("survey.conduct");
  let surveys: Awaited<ReturnType<typeof listSurveysFor>> = [];
  let failed = false;
  try {
    surveys = await listSurveysFor(staff);
  } catch (err) {
    console.error("[survey] list failed:", err);
    failed = true;
  }

  return (
    <div className="scroll-mt-[76px]">
      <PageHeader eyebrow="Surveys" title="Home surveys" subtitle="Booked and under way. Tap one to open the visit." />
      {failed ? (
        <EmptyState title="Couldn't load the surveys" body="Check your signal and pull down to refresh. Nothing has been lost." />
      ) : surveys.length === 0 ? (
        <EmptyState title="No surveys booked" body="When the office books a home survey, it shows here with everything you need for the visit." />
      ) : (
        <ul className="space-y-3">
          {surveys.map((s) => (
            <li key={s.projectId}>
              <Link
                href={`/field/survey/${s.projectId}`}
                className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 hover:border-ink-300 focus-visible:ring-2 focus-visible:ring-accent-500"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-semibold text-ink-900">{s.customerName}</span>
                    {s.status === "in-progress" ? (
                      <span className="rounded-full border border-sage-200 bg-sage-50 px-2.5 py-0.5 text-xs font-semibold text-sage-700">Under way</span>
                    ) : s.mine ? (
                      <span className="rounded-full border border-accent-100 bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">Yours</span>
                    ) : null}
                  </span>
                  <span className="block truncate text-base text-ink-700">
                    {s.addressLine}, {s.postcode}
                  </span>
                  <span className="block text-sm text-ink-500">
                    {s.scheduledFor ? fmtDayTime(s.scheduledFor) : "No time set"}
                    {s.surveyorName && !s.mine ? ` · ${s.surveyorName}` : ""}
                    {s.pilotLabel ? ` · ${s.pilotLabel}` : ""}
                  </span>
                </span>
                <span aria-hidden className="text-2xl text-ink-500">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
