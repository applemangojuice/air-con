import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TIME_KIND_LABEL, can, entryMinutes } from "@aircon/domain";
import { EmptyState, PageHeader, Stat } from "@/components/kit/layout";
import { TimeForm } from "@/components/ops/command/forms";
import { fmtInstant, hoursLabel, timeTotals } from "@/components/ops/command/model";
import { requireStaff } from "@/lib/auth/server";
import { loadProject, londonToday } from "@/lib/project-service";
import * as staffRepo from "@/lib/repo/staff";
import * as timeRepo from "@/lib/repo/time";
import { addTimeAction } from "../actions";

export const metadata: Metadata = { title: "Time · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectTimePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("projects.view-all");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [project, entries, team] = await Promise.all([loadProject(id), timeRepo.listForProject(id), staffRepo.list({ activeOnly: true })]);
  if (!project) notFound();
  const totals = timeTotals(entries);
  const sorted = [...entries].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const canEdit = can(staff, "projects.edit");
  const travel = totals.byKind.find((k) => k.kind === "travel")?.minutes ?? 0;
  const rework = totals.byKind.find((k) => k.kind === "rework")?.minutes ?? 0;

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        back={{ href: `/ops/projects/${id}#time`, label: project.customer.name || "Project" }}
        eyebrow={project.pilot ? `Pilot ${project.pilot.number}` : "Project"}
        title="Time log"
        subtitle="Every hour on this job: the field app's arrive, pause and leave, plus anything added here. It feeds the pilot comparison."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Logged" value={hoursLabel(totals.totalMinutes)} />
        <Stat label="People" value={String(totals.byPerson.length)} />
        <Stat label="Travel" value={hoursLabel(travel)} />
        <Stat label="Rework" value={hoursLabel(rework)} tone={rework > 0 ? "warn" : "neutral"} />
      </div>

      {canEdit && (
        <section className="mt-6 rounded-2xl border border-line bg-white p-4 sm:p-5" aria-labelledby="add-time">
          <h2 id="add-time" className="mb-3 font-display text-xl text-ink-900">
            Add time
          </h2>
          {team.length === 0 ? (
            <p className="text-sm text-ink-500">There&apos;s nobody on the team yet. Add people in Staff first.</p>
          ) : (
            <TimeForm action={addTimeAction.bind(null, id)} staff={team.map((s) => ({ id: s.id, name: s.name }))} today={londonToday()} me={staff.id} />
          )}
        </section>
      )}

      {entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No time logged yet" body="The field app records arrive, pause and leave. Survey, design, travel and admin time can be added above." />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink-900">By person</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {totals.byPerson.map((x) => (
                  <li key={x.name} className="flex justify-between gap-2">
                    <span>{x.name}</span>
                    <span className="tabular-nums">{hoursLabel(x.minutes)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink-900">By kind</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {totals.byKind.map((x) => (
                  <li key={x.kind} className="flex justify-between gap-2">
                    <span>{x.label}</span>
                    <span className="tabular-nums">{hoursLabel(x.minutes)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Time entries, newest first</caption>
              <thead className="border-b border-line bg-surface text-xs text-ink-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Started</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Who</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Kind</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Day</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Length</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((t) => {
                  const running = !t.endedAt && t.minutes === undefined;
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{fmtInstant(t.startedAt, { year: true })}</td>
                      <td className="px-4 py-2.5">{t.staffName}</td>
                      <td className="px-4 py-2.5">{TIME_KIND_LABEL[t.kind]}</td>
                      <td className="px-4 py-2.5">{t.dayN ?? "–"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{running ? <span className="font-semibold text-amber-800">Running</span> : hoursLabel(entryMinutes(t))}</td>
                      <td className="px-4 py-2.5 text-ink-500">{t.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
