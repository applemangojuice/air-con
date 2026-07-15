"use client";

import { useMemo, useState } from "react";
import {
  RESCHEDULE_FEES,
  SLA_COMMITMENTS,
  applyProjectAction,
  currentStage,
  isProjectComplete,
  projectFees,
  projectTimeline,
  stageState,
  type Project,
  type ProjectAction,
  type ProjectStageId,
} from "@aircon/domain";
import { fmtDayTime, gbp } from "@/lib/format";
import { ProjectTimeline } from "./timeline";
import {
  DeliveryPanel,
  FinalQuotePanel,
  FloorPlanPanel,
  InstallationPanel,
  QuoteStagePanel,
  SiteVisitPanel,
  type PanelProps,
} from "./stage-panels";

const PANELS: Record<ProjectStageId, (props: PanelProps) => React.ReactNode> = {
  quote: QuoteStagePanel,
  "floor-plan": FloorPlanPanel,
  "final-quote": FinalQuotePanel,
  "site-visit": SiteVisitPanel,
  delivery: DeliveryPanel,
  installation: InstallationPanel,
};

/**
 * The whole project page. One state machine drives it:
 *  - real projects dispatch actions to the API (the server re-runs the
 *    reducer as the authority and returns the saved project);
 *  - the demo runs the identical reducer in the browser, so the full
 *    journey is playable with no database.
 */
/**
 * Where the customer's next action lives. Usually the current timeline stage,
 * except right after the site visit: delivery is "current" but pends on the
 * installation booking, so focus jumps to the installation panel.
 */
function focusStage(project: Project): ProjectStageId {
  const stage = currentStage(project);
  if (
    stage === "delivery" &&
    project.delivery.status === "pending" &&
    project.installation.status === "not-booked"
  ) {
    return "installation";
  }
  return stage;
}

/** In-panel actions shouldn't yank the view to another stage. */
const KEEP_SELECTION = new Set([
  "toggle-prep",
  "book-installation",
  "reschedule-installation",
  "reschedule-site-visit",
  "set-delivery-date",
]);

export function ProjectView({ initialProject, demo }: { initialProject: Project; demo: boolean }) {
  const [project, setProject] = useState(initialProject);
  const [selected, setSelected] = useState<ProjectStageId>(() => focusStage(initialProject));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(() => projectTimeline(project, new Date().toISOString()), [project]);
  const fees = projectFees(project);
  const complete = isProjectComplete(project);

  async function dispatch(action: ProjectAction) {
    setError(null);

    if (demo) {
      const result = applyProjectAction(project, action, new Date().toISOString());
      if (!result.ok) return setError(result.error);
      setProject(result.project);
      if (!KEEP_SELECTION.has(action.type)) setSelected(focusStage(result.project));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = (await res.json().catch(() => null)) as
        | { project?: Project; error?: string }
        | null;
      if (!res.ok || !data?.project) {
        setError(data?.error ?? "That didn't work. Give it another go in a sec.");
      } else {
        setProject(data.project);
        if (!KEEP_SELECTION.has(action.type)) setSelected(focusStage(data.project));
      }
    } catch {
      setError("Network wobble. Give it another go in a sec.");
    } finally {
      setBusy(false);
    }
  }

  const Panel = PANELS[selected];

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-display sm:text-3xl">Your installation</h1>
          <p className="mt-1 text-sm text-ink-500">
            {project.customer.addressLine}, {project.customer.postcode}
            {!demo && <> · ref {project.id.slice(0, 8)}</>}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            complete ? "bg-sage-100 text-sage-700" : "bg-accent-100 text-accent-700"
          }`}
        >
          {complete ? "Complete 🎉" : `Now: ${entries.find((e) => e.state === "current")?.stage.replace("-", " ")}`}
        </span>
      </div>

      {demo && (
        <p className="rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-ink-700">
          <strong>Demo project.</strong> Click around freely, every step works and nothing is
          saved. The grey demo buttons play our side (site visit, courier, install crew).
        </p>
      )}

      <ProjectTimeline entries={entries} selected={selected} onSelect={setSelected} />

      {error && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Panel project={project} demo={demo} busy={busy} dispatch={dispatch} />

      {demo && <DemoControls project={project} dispatch={dispatch} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <SlaCard />
        <FeesCard accrued={fees.changeFeesGbp} />
      </div>

      <UpdatesFeed project={project} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SlaCard() {
  return (
    <section className="rounded-3xl border border-line bg-white p-5">
      <h2 className="font-bold">Our commitments to you</h2>
      <p className="mt-1 text-xs text-ink-500">
        If we miss one, you get the money off automatically. No chasing, no arguing.
      </p>
      <ul className="mt-3 space-y-2.5">
        {SLA_COMMITMENTS.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">{c.promise}</span>
            <span className="block text-xs text-sage-700">or {c.remedy}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeesCard({ accrued }: { accrued: number }) {
  return (
    <section className="rounded-3xl border border-line bg-white p-5">
      <h2 className="font-bold">Changing a date</h2>
      <p className="mt-1 text-xs text-ink-500">
        Move anything on the timeline whenever you need. Fees only kick in as the day gets close,
        because by then couriers and crews are already booked.
      </p>
      <div className="mt-3 space-y-3">
        {(Object.keys(RESCHEDULE_FEES) as (keyof typeof RESCHEDULE_FEES)[]).map((kind) => (
          <div key={kind} className="text-sm">
            <p className="font-medium capitalize">{kind.replace("-", " ")}</p>
            <p className="text-xs text-ink-500">
              {RESCHEDULE_FEES[kind]
                .map((band) => `${band.label}: ${band.feeGbp === 0 ? "free" : gbp(band.feeGbp)}`)
                .join(" · ")}
            </p>
          </div>
        ))}
      </div>
      {accrued > 0 && (
        <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-xs text-ink-700">
          Change fees so far: <strong>{gbp(accrued)}</strong>, added to your final balance.
        </p>
      )}
    </section>
  );
}

function UpdatesFeed({ project }: { project: Project }) {
  const events = project.events.slice().reverse();
  return (
    <section className="rounded-3xl border border-line bg-white p-5">
      <h2 className="font-bold">Updates</h2>
      <ol className="mt-3 space-y-3">
        {events.map((event, i) => (
          <li key={`${event.at}-${i}`} className="flex gap-3 text-sm">
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? "bg-accent-500" : "bg-line"}`}
            />
            <span>
              {event.label}
              <span className="block text-xs text-ink-300">{fmtDayTime(event.at)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** Demo-only: play the ops side so the whole journey is walkable. */
function DemoControls({
  project,
  dispatch,
}: {
  project: Project;
  dispatch: (action: ProjectAction) => void;
}) {
  const actions: { label: string; action: ProjectAction }[] = [];

  if (project.floorPlan.status === "approved" && project.finalQuote.status === "pending") {
    actions.push({
      label: "Our team issues your final quote",
      action: {
        type: "ops-issue-final-quote",
        totalGbp: project.quoteSummary.totalGbp,
        note: "Confirmed after photo review.",
      },
    });
  }
  if (project.siteVisit.status === "booked") {
    actions.push({
      label: "The site visit happens",
      action: {
        type: "ops-complete-site-visit",
        summary:
          "Walked every room on the call. Unit positions confirmed, and the outdoor unit fits the rear wall with room to spare.",
        approvedForInstall: true,
        electricsStatus: "validated",
        electricsSummary:
          "Dedicated circuit from spare way 7, cable route along the kitchen soffit. No board work needed.",
      },
    });
  }
  if (
    project.installation.status === "booked" &&
    !project.installation.installer &&
    project.siteVisit.status === "completed"
  ) {
    actions.push({
      label: "We assign your installer",
      action: {
        type: "ops-assign-installer",
        installer: {
          name: "Danny Okafor",
          role: "Lead installation engineer",
          bio: "F-Gas certified, 240+ installs of exactly your system layout. Tidy to a fault, brings his own dust sheets.",
          yearsExperience: 9,
        },
      },
    });
  }
  if (project.delivery.status === "scheduled" && project.installation.status === "booked") {
    actions.push({
      label: "Courier dispatches your kit",
      action: { type: "ops-mark-dispatched", courier: "DPD", trackingRef: "15501899081995" },
    });
  }
  if (project.delivery.status === "dispatched") {
    actions.push({ label: "Courier delivers", action: { type: "ops-mark-delivered" } });
  }
  if (project.delivery.status === "delivered" && project.installation.status === "booked") {
    actions.push({
      label: "Installation day happens",
      action: { type: "ops-complete-installation" },
    });
  }

  if (actions.length === 0) return null;

  return (
    <section className="rounded-3xl border border-dashed border-ink-300 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
        Demo: play our side
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => dispatch(a.action)}
            className="rounded-full border border-ink-300 bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-line"
          >
            ▶ {a.label}
          </button>
        ))}
      </div>
    </section>
  );
}
