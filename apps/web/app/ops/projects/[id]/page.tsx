import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PROJECT_STAGES, STAGE_INFO, projectFees, stageState } from "@aircon/domain";
import { fmtDay, fmtDayTime, gbp } from "@/lib/format";
import { loadProject } from "@/lib/projects-server";
import {
  assignInstaller,
  completeInstallation,
  completeSiteVisit,
  issueFinalQuote,
  markDelivered,
  markDispatched,
} from "../actions";

export const metadata: Metadata = {
  title: "Project · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputCls =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const buttonCls =
  "rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-700";

export default async function OpsProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const project = await loadProject(id);
  if (!project) notFound();

  const fees = projectFees(project);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display">{project.customer.name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {project.customer.addressLine}, {project.customer.postcode} · started{" "}
            {fmtDay(project.createdAt)}
          </p>
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <Link href={`/ops/quotes/${project.quoteId}`} className="text-accent-700 hover:underline">
            Quote
          </Link>
          <Link href={`/p/${project.id}`} className="text-accent-700 hover:underline">
            Customer view
          </Link>
          <Link href="/ops/projects" className="text-ink-500 hover:underline">
            ← Projects
          </Link>
        </div>
      </div>

      {/* Stage strip */}
      <div className="mb-6 flex flex-wrap gap-2">
        {PROJECT_STAGES.map((stage) => {
          const state = stageState(project, stage);
          return (
            <span
              key={stage}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                state === "complete"
                  ? "bg-sage-100 text-sage-700"
                  : state === "current"
                    ? "bg-accent-100 text-accent-700 ring-2 ring-accent-200"
                    : "bg-surface text-ink-300"
              }`}
            >
              {state === "complete" ? "✓ " : ""}
              {STAGE_INFO[stage].label}
            </span>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Snapshot */}
        <Card title="Snapshot">
          <Row k="Quoted total" v={gbp(project.quoteSummary.totalGbp)} />
          <Row
            k="Final quote"
            v={
              project.finalQuote.status === "pending"
                ? "not issued"
                : `${gbp(project.finalQuote.totalGbp ?? 0)} (${project.finalQuote.status})`
            }
          />
          <Row
            k="Site visit"
            v={
              project.siteVisit.scheduledFor
                ? `${fmtDayTime(project.siteVisit.scheduledFor)} · ${project.siteVisit.mode} · ${project.siteVisit.paymentStatus}`
                : "not booked"
            }
          />
          <Row
            k="Delivery"
            v={
              project.delivery.expectedDate
                ? `${fmtDay(project.delivery.expectedDate)} (${project.delivery.status})`
                : "-"
            }
          />
          <Row
            k="Installation"
            v={
              project.installation.date
                ? `${fmtDay(project.installation.date)} (${project.installation.status})`
                : "not booked"
            }
          />
          <Row k="Change fees accrued" v={fees.changeFeesGbp ? gbp(fees.changeFeesGbp) : "none"} />
          <Row k="Electrics" v={`${project.electrics.status}: ${project.electrics.summary}`} />
        </Card>

        {/* Final quote */}
        {project.finalQuote.status === "pending" && project.floorPlan.status === "approved" && (
          <Card title="Issue final quote" highlight>
            <form action={issueFinalQuote.bind(null, project.id)} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Total (GBP, inc. VAT)</span>
                <input
                  name="totalGbp"
                  type="number"
                  required
                  min={1}
                  defaultValue={project.quoteSummary.totalGbp}
                  className={inputCls}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Note to customer (optional)</span>
                <input name="note" className={inputCls} placeholder="e.g. adjusted after photo review" />
              </label>
              <button className={buttonCls}>Issue final quote</button>
            </form>
          </Card>
        )}
        {project.finalQuote.status === "pending" && project.floorPlan.status !== "approved" && (
          <Card title="Final quote">
            <p className="text-sm text-ink-500">
              Waiting on the customer to approve their floor plan.
            </p>
          </Card>
        )}

        {/* Site visit */}
        {project.siteVisit.status === "booked" && (
          <Card title="Record site-visit outcome" highlight>
            <form action={completeSiteVisit.bind(null, project.id)} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Summary for the customer</span>
                <textarea name="summary" required rows={3} className={inputCls} />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="approvedForInstall" defaultChecked className="h-4 w-4 accent-accent-600" />
                Approved for installation
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Electrics status</span>
                <select name="electricsStatus" className={inputCls} defaultValue="validated">
                  <option value="validated">validated (plan agreed)</option>
                  <option value="attention">attention (work to resolve)</option>
                  <option value="provisional">provisional (still open)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Electrical connection plan</span>
                <textarea
                  name="electricsSummary"
                  required
                  rows={2}
                  className={inputCls}
                  placeholder="e.g. dedicated circuit from spare way 7, route along kitchen soffit"
                />
              </label>
              <button className={buttonCls}>Complete site visit</button>
            </form>
          </Card>
        )}

        {/* Delivery */}
        {project.delivery.status === "scheduled" && (
          <Card title="Dispatch equipment" highlight>
            <form action={markDispatched.bind(null, project.id)} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Courier</span>
                <input name="courier" required className={inputCls} placeholder="DPD" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Tracking reference</span>
                <input name="trackingRef" required className={inputCls} />
              </label>
              <button className={buttonCls}>Mark dispatched</button>
              <p className="text-xs text-ink-300">
                Courier-API integration lands here. Dispatch and tracking events will sync
                automatically.
              </p>
            </form>
          </Card>
        )}
        {project.delivery.status === "dispatched" && (
          <Card title="Delivery in transit" highlight>
            <p className="text-sm text-ink-500">
              {project.delivery.courier} · {project.delivery.trackingRef}
            </p>
            <form action={markDelivered.bind(null, project.id)} className="mt-3">
              <button className={buttonCls}>Mark delivered</button>
            </form>
          </Card>
        )}

        {/* Installer */}
        {project.installation.status !== "completed" && (
          <Card title={project.installation.installer ? "Reassign installer" : "Assign installer"}>
            <form action={assignInstaller.bind(null, project.id)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-semibold">Name</span>
                  <input
                    name="name"
                    required
                    className={inputCls}
                    defaultValue={project.installation.installer?.name}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-semibold">Years experience</span>
                  <input
                    name="yearsExperience"
                    type="number"
                    min={0}
                    className={inputCls}
                    defaultValue={project.installation.installer?.yearsExperience}
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Role</span>
                <input
                  name="role"
                  required
                  className={inputCls}
                  defaultValue={project.installation.installer?.role ?? "Lead installation engineer"}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Bio (customer-facing)</span>
                <textarea
                  name="bio"
                  rows={2}
                  className={inputCls}
                  defaultValue={project.installation.installer?.bio}
                />
              </label>
              <button className={buttonCls}>Save installer</button>
            </form>
          </Card>
        )}

        {/* Installation completion */}
        {project.installation.status === "booked" && project.delivery.status === "delivered" && (
          <Card title="Installation day" highlight>
            <p className="text-sm text-ink-500">
              Booked for {project.installation.date ? fmtDay(project.installation.date) : "-"}.
              Equipment is on site.
            </p>
            <form action={completeInstallation.bind(null, project.id)} className="mt-3">
              <button className={buttonCls}>Mark installation complete</button>
            </form>
          </Card>
        )}
      </div>

      {/* Event log */}
      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="font-bold">Event log</h2>
        <ol className="mt-3 space-y-2">
          {project.events
            .slice()
            .reverse()
            .map((event, i) => (
              <li key={`${event.at}-${i}`} className="text-sm">
                <span className="text-ink-300">{fmtDayTime(event.at)}</span>{" "}
                <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-500">
                  {event.actor}
                </span>{" "}
                {event.label}
                {event.feeGbp ? <strong> ({gbp(event.feeGbp)})</strong> : null}
              </li>
            ))}
        </ol>
      </section>
    </main>
  );
}

function Card({
  title,
  highlight,
  children,
}: {
  title: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 ${highlight ? "border-accent-400 bg-accent-50/40" : "border-line"}`}
    >
      <h2 className="mb-3 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex justify-between gap-4 border-b border-line/60 py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-ink-500">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </p>
  );
}
