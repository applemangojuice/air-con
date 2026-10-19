import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Fragment } from "react";
import {
  ISSUE_KIND_LABEL,
  LEARNING_PROMPTS,
  LEARNING_STATUS_LABEL,
  PILOT_METRIC_ROWS,
  STAGE_INFO,
  TIME_KIND_LABEL,
  can,
  metricComparable,
  rowExtremes,
  type IssueKind,
  type Learning,
  type MetricRow,
  type TimeEntry,
} from "@aircon/domain";
import { Badge } from "@/components/kit/badge";
import { LinkButton } from "@/components/kit/button";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { Tabs } from "@/components/kit/tabs";
import { LearningStatusForm } from "@/components/ops/command/forms";
import { fmtInstant } from "@/components/ops/command/model";
import { requireStaff } from "@/lib/auth/server";
import { loadPilotRows, type PilotRow } from "@/lib/ops-core-server";
import { getServiceClient } from "@/lib/supabase-server";
import { setLearningStatusAction } from "../projects/[id]/actions";
import { formatBreakdown, formatMetric } from "./format";

export const metadata: Metadata = { title: "Pilots · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS_TABS = ["open", "applied", "wont-fix", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

/**
 * The pilot learning dashboard (plan §9): Pilot 1 vs 2 vs 3 vs 4 on every
 * number we said we'd measure, best and worst picked out per row, and the
 * learnings that came out of each, with what we changed because of them.
 */
export default async function PilotsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff("pilots.view");
  const tabParam = (await searchParams).learnings;
  const tab: StatusTab = STATUS_TABS.includes(tabParam as StatusTab) ? (tabParam as StatusTab) : "open";
  const showMoney = can(staff, "finance.view-margin");
  const canEdit = can(staff, "projects.edit");

  if (!getServiceClient()) {
    return (
      <Shell>
        <EmptyState title="No database connected" body="Pilot numbers come from real records, so there's nothing to compare in demo mode." />
      </Shell>
    );
  }

  let data: Awaited<ReturnType<typeof loadPilotRows>>;
  try {
    data = await loadPilotRows();
  } catch (err) {
    console.error("[pilots] load failed:", err);
    return (
      <Shell>
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          The pilot numbers couldn&apos;t load. Reload in a moment.
        </p>
      </Shell>
    );
  }
  const { rows, learnings } = data;
  const metricRows = PILOT_METRIC_ROWS.filter((r) => showMoney || r.group !== "Money");
  const groups = [...new Set(metricRows.map((r) => r.group))];
  const shownLearnings = tab === "all" ? learnings : learnings.filter((l) => l.status === tab);
  const counts = Object.fromEntries(STATUS_TABS.map((t) => [t, t === "all" ? learnings.length : learnings.filter((l) => l.status === t).length]));

  return (
    <Shell canExport={showMoney && rows.length > 0}>
      {rows.length === 0 ? (
        <EmptyState
          title="No pilots yet"
          body="Tag a project with a pilot number (New pilot does it for you) and it lines up here, number by number."
          action={
            <LinkButton href="/ops/projects/new" variant="primary">
              Set up a pilot
            </LinkButton>
          }
        />
      ) : (
        <>
          <section aria-labelledby="compare">
            <h2 id="compare" className="sr-only">
              Comparison
            </h2>
            <div className="relative overflow-x-auto rounded-2xl border border-line bg-white" tabIndex={0} aria-label="Pilot comparison table, scrolls sideways">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Each pilot side by side. Best and worst per row are marked.</caption>
                <thead>
                  <tr className="border-b border-line bg-surface">
                    <th scope="col" className="sticky left-0 z-10 min-w-[11rem] bg-surface px-4 py-3 text-left text-xs font-semibold text-ink-500">
                      Measure
                    </th>
                    {rows.map((r) => (
                      <th key={r.metrics.projectId} scope="col" className="min-w-[10rem] px-4 py-3 text-left align-top">
                        <Link href={`/ops/projects/${r.metrics.projectId}`} className="font-semibold text-accent-700 hover:underline">
                          Pilot {r.metrics.pilotNumber}
                        </Link>
                        <span className="block text-xs font-normal text-ink-700">{r.metrics.label}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge tone="info">{STAGE_INFO[r.metrics.stage].label}</Badge>
                          {r.demo && <Badge tone="warn">DEMO</Badge>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g}>
                      <tr className="border-b border-line bg-cream">
                        <th colSpan={rows.length + 1} scope="colgroup" className="sticky left-0 px-4 pb-1.5 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                          {g}
                        </th>
                      </tr>
                      {metricRows
                        .filter((m) => m.group === g)
                        .map((m) => (
                          <MetricLine key={m.key} row={m} pilots={rows} />
                        ))}
                      {g === "Labour" && (
                        <>
                          <BreakdownLine label="Hours by person" pilots={rows} pick={(r) => formatBreakdown(r.metrics.labourHoursByPerson, " h")} />
                          <BreakdownLine
                            label="Hours by kind"
                            pilots={rows}
                            pick={(r) =>
                              formatBreakdown(
                                Object.fromEntries(Object.entries(r.metrics.labourHoursByKind).map(([k, v]) => [TIME_KIND_LABEL[k as TimeEntry["kind"]] ?? k, v])),
                                " h",
                              )
                            }
                          />
                        </>
                      )}
                      {g === "Quality" && (
                        <BreakdownLine
                          label="Issues by kind"
                          pilots={rows}
                          pick={(r) =>
                            formatBreakdown(Object.fromEntries(Object.entries(r.metrics.issuesByKind).map(([k, v]) => [ISSUE_KIND_LABEL[k as IssueKind] ?? k, v])))
                          }
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-ink-500">
              <li>
                <span className="mr-1 inline-block rounded bg-emerald-100 px-1.5 font-semibold text-emerald-900">Best</span>
                <span className="mr-1 inline-block rounded bg-amber-100 px-1.5 font-semibold text-amber-900">Worst</span>
                per row, only among pilots far enough along for the number to be final (costs and hours once installed, defects once handed over). A dash means nothing was recorded.
              </li>
              {showMoney && <li>* Some costs are expected (from the purchase order or proposal), not yet actual. Labour is costed at the rates in Settings.</li>}
              {showMoney && (
                <li>
                  † Incomplete: an order line has no cost yet, or nothing has been ordered, so the cost leaves it out and gross profit and margin show a dash
                  until it&apos;s entered (actual costs go in on each project&apos;s Kit page).
                </li>
              )}
              <li>Messages sent counts only messages a provider accepted; demo-mode messages aren&apos;t counted.</li>
              {rows.some((r) => r.diffNote) && <li>Self-survey accuracy: {[...new Set(rows.map((r) => r.diffNote).filter(Boolean))].join(" ")}</li>}
            </ul>
          </section>

          <section aria-labelledby="learnings" className="mt-10">
            <h2 id="learnings" className="font-display text-2xl text-ink-900">
              Learnings
            </h2>
            <p className="mt-1 text-sm text-ink-500">What each pilot taught us, and what we changed. Mark one applied once the checklist, the engine or the habit has changed.</p>
            <div className="mt-4">
              <Tabs
                label="Learning status"
                current={`/ops/pilots?learnings=${tab}`}
                tabs={STATUS_TABS.map((t) => ({ href: `/ops/pilots?learnings=${t}`, label: t === "all" ? "All" : LEARNING_STATUS_LABEL[t], count: counts[t] }))}
              />
            </div>
            {shownLearnings.length === 0 ? (
              <EmptyState title={tab === "open" ? "Nothing open" : "Nothing here"} body="Learnings come from the field app's end-of-day prompts and the command centre." />
            ) : (
              <ul className="space-y-3">
                {shownLearnings.map((l) => (
                  <LearningCard key={l.id} learning={l} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, canExport = false }: { children: ReactNode; canExport?: boolean }) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        title="Pilots"
        subtitle="Pilot 1 against Pilot 2 against Pilot 3: price, cost, time, quality and what we learned."
        actions={
          canExport ? (
            <LinkButton href="/ops/pilots/export" variant="secondary" prefetch={false}>
              Download CSV
            </LinkButton>
          ) : undefined
        }
      />
      {children}
    </main>
  );
}

function MetricLine({ row, pilots }: { row: MetricRow; pilots: PilotRow[] }) {
  const values = pilots.map((p) => p.metrics[row.key] as number | null | undefined);
  const { best, worst } = rowExtremes(
    row,
    pilots.map((p) => p.metrics),
  );
  const costRow = ["equipmentCostPence", "materialsCostPence", "actualCostPence", "grossProfitPence", "grossMarginPct"].includes(row.key);
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium text-ink-700">
        {row.label}
      </th>
      {pilots.map((p, i) => {
        const isBest = best.includes(i);
        const isWorst = worst.includes(i);
        const flagged = costRow && (p.metrics.costBasis === "expected" || p.metrics.costBasis === "mixed") && values[i] !== null;
        // A cost missing where one should be: an order line with no cost, or nothing ordered by the time the kit is due.
        const kitDue = metricComparable({ from: "kit" }, p.metrics);
        const incomplete =
          costRow &&
          (p.metrics.costBasis === "incomplete" || (p.metrics.costBasis === "none" && kitDue)) &&
          row.key !== "grossProfitPence" &&
          row.key !== "grossMarginPct";
        return (
          <td key={p.metrics.projectId} className={`px-4 py-2 tabular-nums ${isBest ? "bg-emerald-50 font-semibold text-emerald-900" : isWorst ? "bg-amber-50 font-semibold text-amber-900" : "text-ink-900"}`}>
            {formatMetric(values[i], row.format)}
            {flagged && <span title="Includes expected costs">*</span>}
            {incomplete && (
              <span title={p.metrics.costBasis === "none" ? "Nothing ordered yet" : `${p.metrics.unknownCostLines} order line${p.metrics.unknownCostLines === 1 ? " has" : "s have"} no cost yet`}>†</span>
            )}
            {row.key === "messagesSent" && p.demoMessages > 0 && <span className="ml-1 text-xs font-normal text-ink-500">(+{p.demoMessages} demo)</span>}
            {isBest && <span className="sr-only"> (best)</span>}
            {isWorst && <span className="sr-only"> (worst)</span>}
          </td>
        );
      })}
    </tr>
  );
}

function BreakdownLine({ label, pilots, pick }: { label: string; pilots: PilotRow[]; pick: (p: PilotRow) => string }) {
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium text-ink-700">
        {label}
      </th>
      {pilots.map((p) => (
        <td key={p.metrics.projectId} className="px-4 py-2 text-xs text-ink-700">
          {pick(p)}
        </td>
      ))}
    </tr>
  );
}

function LearningCard({ learning: l, canEdit }: { learning: Learning & { projectLabel: string }; canEdit: boolean }) {
  return (
    <li className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <Link href={`/ops/projects/${l.projectId}#learnings`} className="font-semibold text-accent-700 hover:underline">
            {l.projectLabel}
          </Link>
          <span className="text-ink-500">
            {" "}
            · {l.author.name} · {fmtInstant(l.createdAt)}
            {l.stage ? ` · ${STAGE_INFO[l.stage].label}` : ""}
            {l.dayN ? ` · day ${l.dayN}` : ""}
          </span>
        </p>
        <Badge tone={l.status === "open" ? "warn" : l.status === "applied" ? "success" : "neutral"}>{LEARNING_STATUS_LABEL[l.status]}</Badge>
      </div>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        {l.answers.map((a) => (
          <div key={a.promptId}>
            <dt className="text-xs font-semibold text-ink-500">{LEARNING_PROMPTS.find((p) => p.id === a.promptId)?.question ?? a.promptId}</dt>
            <dd className="text-ink-900">{a.answer}</dd>
          </div>
        ))}
      </dl>
      {l.tags.length > 0 && <p className="mt-2 text-xs text-ink-500">Tags: {l.tags.join(", ")}</p>}
      {l.appliedNote && <p className="mt-2 text-sm text-emerald-800">Changed: {l.appliedNote}</p>}
      {canEdit && (
        <div className="mt-3 border-t border-line pt-3">
          <LearningStatusForm action={setLearningStatusAction} learningId={l.id} status={l.status} />
        </div>
      )}
    </li>
  );
}
