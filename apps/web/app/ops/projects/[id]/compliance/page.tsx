import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  COMPLIANCE_CATEGORY_LABEL,
  COMPLIANCE_GATE_GROUPS,
  COMPLIANCE_STATUS_TEXT,
  PD_CHECKS,
  ROLE_LABEL,
  can,
  cancellationStatus,
  complianceProgress,
  complianceTemplateFor,
  meetsRequirement,
  type ComplianceItem,
  type ComplianceStatus,
  type Project,
  type StaffMember,
} from "@aircon/domain";
import { Badge, Card, EmptyState, Stat, StatusChip } from "@/components/kit";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { loadChecklistFor } from "@/lib/compliance-server";
import { fmtDate } from "@/lib/format";
import { signedMediaUrls } from "@/lib/media-server";
import { londonToday } from "@/lib/project-service";
import { isUuid } from "@/lib/repo/base";
import * as mediaRepo from "@/lib/repo/media";
import * as staffRepo from "@/lib/repo/staff";
import * as surveysRepo from "@/lib/repo/surveys";
import { getSettings } from "@/lib/settings-server";
import { ActionForm } from "../booking/_f5/action-form";
import { fmtLondon } from "../booking/_f5/action-state";
import { JobHeader } from "../booking/_f5/job-header";
import { PhotoUpload } from "../booking/_f5/photo-upload";
import { createChecklistAction, evidenceAction, reviewAction } from "./actions";

export const metadata: Metadata = { title: "Compliance · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const textarea =
  "min-h-24 w-full rounded-2xl border border-line bg-white px-4 py-3 text-base leading-relaxed text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const field = "min-h-12 w-full rounded-full border border-line bg-white px-4 text-base text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

/**
 * The compliance checklist (view: projects.view-all; review:
 * compliance.review). Grouped by the gate each item belongs to, with the
 * guidance, the evidence, who reviewed it and when, and its history.
 * Statutory items are approved on evidence by a qualified reviewer, never
 * overridden; planning is never concluded automatically.
 */
export default async function CompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("projects.view-all");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireProjectAccess(id);
  if (!access || access.kind !== "staff") notFound();
  const loaded = await loadChecklistFor(id);
  if (!loaded) notFound();
  const { project: p, items } = loaded;

  const [settings, survey, crew] = await Promise.all([
    getSettings(),
    surveysRepo.currentForProject(id),
    staffRepo.listByIds(p.booking.crew.map((c) => c.staffId)),
  ]);
  const media = await mediaRepo.listByIds([...new Set(items.flatMap((i) => i.mediaIds))]);
  const urls = await signedMediaUrls(media);
  const mediaById = new Map(media.map((m) => [m.id, { ...m, url: urls.get(m.id) ?? null }]));
  const progress = complianceProgress(items);
  const reviewer = can(staff, "compliance.review");
  const contributor = reviewer || can(staff, "projects.edit") || can(staff, "install.work");
  const today = londonToday();

  const context = (item: ComplianceItem) => contextFor(item, { project: p, survey: survey?.data.permissions.pd, crew, settingsCert: settings.company.fgasCompanyCert, today });

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
      <JobHeader project={p} current="compliance" title="Compliance" subtitle="Every permission, safety check and certificate this job needs, and who signed each one off." />

      {items.length === 0 ? (
        <EmptyState
          title="No compliance checklist on this project"
          body="Install day 1 can't start without one. It's created from the standard template: planning, safety, electrical, F-gas, consumer rights and the rest."
          action={contributor ? <ActionForm flash action={createChecklistAction.bind(null, p.id)} submitLabel="Create the checklist" /> : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Done" value={`${progress.settled} of ${progress.total}`} tone={progress.open === 0 ? "success" : "neutral"} hint="Approved or not applicable" />
            <Stat label="Statutory open" value={String(progress.statutoryOpen)} tone={progress.statutoryOpen ? "warn" : "success"} hint="These block their gate" />
            <Stat label="Waiting for review" value={String(progress.awaitingReview)} hint={reviewer ? "You can review these" : "A technical lead reviews these"} />
            <Stat label="Rejected" value={String(progress.rejected)} tone={progress.rejected ? "danger" : "neutral"} hint="Each holds a blocking issue" />
          </div>
          {items.length < 20 && contributor && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This checklist is missing some of the current template&apos;s items.
              <ActionForm flash action={createChecklistAction.bind(null, p.id)} submitLabel="Add the missing items" variant="secondary" />
            </div>
          )}

          <div className="mt-8 space-y-10">
            {COMPLIANCE_GATE_GROUPS.map((g) => {
              const group = items.filter((i) => i.gate === g.gate);
              if (group.length === 0) return null;
              const done = group.filter((i) => i.status === "approved" || i.status === "not-applicable").length;
              return (
                <section key={g.gate} aria-labelledby={`g-${g.gate}`}>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h2 id={`g-${g.gate}`} className="font-display text-xl text-ink-900 sm:text-2xl">
                        {g.title}
                      </h2>
                      <p className="mt-1 text-sm text-ink-500">{g.enforced}</p>
                    </div>
                    <Badge tone={done === group.length ? "success" : "neutral"}>
                      {done} of {group.length} done
                    </Badge>
                  </div>
                  <ul className="space-y-3">
                    {group.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        projectId={p.id}
                        staff={staff}
                        reviewer={reviewer}
                        contributor={contributor}
                        media={item.mediaIds.map((m) => mediaById.get(m)).filter((m) => m !== undefined)}
                        context={context(item)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}

/** What the project already knows that helps review this item. */
function contextFor(
  item: ComplianceItem,
  facts: {
    project: Project;
    survey?: Partial<Record<string, "yes" | "no" | "unsure">>;
    crew: StaffMember[];
    settingsCert?: { body: string; number: string; expiresOn?: string };
    today: string;
  },
): { label: string; value: string; tone?: "success" | "warn" | "danger" }[] {
  const p = facts.project;
  const on = p.booking.dates.at(-1) ?? facts.today;
  switch (item.key) {
    case "planning-pd":
      if (!facts.survey) return [{ label: "Survey checklist", value: "Not recorded yet", tone: "warn" }];
      return PD_CHECKS.map((c) => {
        const a = facts.survey?.[c.id];
        return { label: c.label, value: a === "yes" ? "Yes" : a === "no" ? "No" : a === "unsure" ? "Unsure" : "Not answered", tone: a === "yes" ? "success" : a === "no" ? "danger" : "warn" };
      });
    case "fgas-company":
      return [
        facts.settingsCert?.number
          ? { label: "In settings", value: `${facts.settingsCert.body} ${facts.settingsCert.number}${facts.settingsCert.expiresOn ? `, until ${fmtDate(facts.settingsCert.expiresOn)}` : ""}`, tone: !facts.settingsCert.expiresOn || facts.settingsCert.expiresOn >= on ? "success" : "danger" }
          : { label: "In settings", value: "No company certificate recorded", tone: "warn" },
      ];
    case "fgas-engineer":
    case "electrical-scope": {
      const req = item.key === "fgas-engineer" ? "fgas" : "electrical";
      if (facts.crew.length === 0) return [{ label: "Crew", value: "Nobody assigned yet", tone: "warn" }];
      return facts.crew.map((m) => ({ label: m.name, value: meetsRequirement(m, req, on) ? `Current on ${fmtDate(on)}` : "No current certificate", tone: meetsRequirement(m, req, on) ? "success" : "warn" }));
    }
    case "cancellation-and-consent": {
      const cs = cancellationStatus(p, facts.today);
      return [
        { label: "Pre-contract information sent", value: p.proposal.preContractInfoSentAt ? fmtDate(p.proposal.preContractInfoSentAt) : "No", tone: p.proposal.preContractInfoSentAt ? "success" : "warn" },
        { label: "Contract copy sent", value: p.proposal.confirmationSentAt ? fmtDate(p.proposal.confirmationSentAt) : "No", tone: p.proposal.confirmationSentAt ? "success" : "warn" },
        { label: "Cancellation period", value: cs.ended ? `Ended ${cs.endsOn ? fmtDate(cs.endsOn) : ""}` : cs.endsOn ? `Runs to ${fmtDate(cs.endsOn)}` : "Not started (kit not delivered)", tone: cs.ended ? "success" : "warn" },
        { label: "Early start", value: cs.earlyStartEvidenced ? "Requested in writing" : p.proposal.earlyStart?.requested ? "Ticked, no written request yet" : "Not requested", tone: cs.earlyStartEvidenced ? "success" : undefined },
      ];
    }
    case "electrical-certificate":
      return [{ label: "Project record", value: p.handover.electricalCert === "received" ? "Certificate received" : p.handover.electricalCert === "not-required" ? "Marked not required" : "Pending", tone: p.handover.electricalCert === "received" ? "success" : "warn" }];
    default:
      return [];
  }
}

function ContextList({ context }: { context: { label: string; value: string; tone?: "success" | "warn" | "danger" }[] }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-1.5 rounded-2xl bg-surface/60 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      {context.map((c) => (
        <div key={c.label} className="contents">
          <dt className="text-ink-700">{c.label}</dt>
          <dd className={`font-medium sm:text-right ${c.tone === "success" ? "text-emerald-800" : c.tone === "danger" ? "text-red-700" : c.tone === "warn" ? "text-amber-800" : "text-ink-900"}`}>{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const REVIEW_CHOICES: { to: ComplianceStatus; label: string }[] = [
  { to: "approved", label: "Approve" },
  { to: "not-applicable", label: "Not applicable" },
  { to: "rejected", label: "Reject" },
  { to: "under-review", label: "Back to review" },
];

function ItemCard({
  item,
  projectId,
  staff,
  reviewer,
  contributor,
  media,
  context,
}: {
  item: ComplianceItem;
  projectId: string;
  staff: StaffMember;
  reviewer: boolean;
  contributor: boolean;
  media: { id: string; contentType: string; url: string | null; caption?: string; takenAt: string }[];
  context: { label: string; value: string; tone?: "success" | "warn" | "danger" }[];
}) {
  const t = complianceTemplateFor(item.key);
  const settled = item.status === "approved" || item.status === "not-applicable";
  const choices = REVIEW_CHOICES.filter((c) => {
    if (c.to === item.status) return false;
    if (t?.auto && c.to === "approved") return false;
    if (t?.allowNa === false && c.to === "not-applicable") return false;
    if (c.to === "under-review" && !settled && item.status !== "rejected") return false;
    return true;
  });
  const canOverride = !item.statutory && staff.roles.includes("admin");

  return (
    <Card as="li" padded={false}>
      <div className="px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink-900">{item.label}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone={item.statutory ? "accent" : "neutral"}>{item.statutory ? "Statutory" : "Internal"}</Badge>
              <Badge tone="neutral">{COMPLIANCE_CATEGORY_LABEL[item.category]}</Badge>
              {t && <Badge tone="neutral">Owner: {ROLE_LABEL[t.ownerRole]}</Badge>}
              {t?.auto && <Badge tone="info">Updates automatically</Badge>}
            </div>
          </div>
          <StatusChip status={item.status} label={COMPLIANCE_STATUS_TEXT[item.status]} />
        </div>

        {(item.reviewedBy || item.note) && (
          <div className="mt-3 text-sm">
            {item.note && <p className="text-ink-900">{item.note}</p>}
            {item.reviewedBy && (
              <p className="mt-1 text-xs text-ink-500">
                {COMPLIANCE_STATUS_TEXT[item.status]} by {item.reviewedBy}
                {item.reviewedAt ? ` on ${fmtLondon(item.reviewedAt)}` : ""}
                {item.overrideReason ? `. Admin override: ${item.overrideReason}` : ""}
              </p>
            )}
          </div>
        )}

        {context.length > 0 && !settled && <ContextList context={context} />}

        {media.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {media.map((m) => (
              <li key={m.id}>
                {m.url && m.contentType.startsWith("image/") ? (
                  <a href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.caption ?? `Evidence added ${fmtDate(m.takenAt)}`} className="h-20 w-28 object-cover" />
                  </a>
                ) : m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-3 text-sm font-semibold text-accent-700">
                    Open file ({fmtDate(m.takenAt)})
                  </a>
                ) : (
                  <span className="inline-flex min-h-11 items-center rounded-full border border-dashed border-line px-3 text-sm text-ink-500">File unavailable</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line bg-surface/40 px-5 py-3 sm:px-6">
        {context.length > 0 && settled && (
          <details className="group min-w-0 open:basis-full">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface group-open:border-ink-300">
              <span aria-hidden className="text-ink-500 transition group-open:rotate-90">▸</span> On record now
              {context.some((c) => c.tone === "warn" || c.tone === "danger") && <><span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" /><span className="sr-only">(something to look at)</span></>}
            </summary>
            <div className="pb-2">
              <ContextList context={context} />
            </div>
          </details>
        )}
        {t && (
          <details className="group min-w-0 open:basis-full">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface group-open:border-ink-300">
              <span aria-hidden className="text-ink-500 transition group-open:rotate-90">▸</span> What to check
            </summary>
            <div className="pb-2 pt-3 text-sm text-ink-700">
              <p>{t.guidance}</p>
              <p className="mt-2">
                <span className="font-semibold text-ink-900">Evidence: </span>
                {t.evidenceHint}
              </p>
              {t.basis && <p className="mt-2 text-xs text-ink-500">Basis: {t.basis}. A working summary, not legal advice.</p>}
            </div>
          </details>
        )}

        {contributor && !t?.auto && (
          <details className="group min-w-0 open:basis-full">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface group-open:border-ink-300">
              <span aria-hidden className="text-ink-500 transition group-open:rotate-90">▸</span> Add evidence or a note
            </summary>
            <div className="pb-2 pt-3">
              <ActionForm flash action={evidenceAction.bind(null, projectId)} submitLabel="Save evidence" variant="secondary" resetOnSuccess>
                <input type="hidden" name="itemId" value={item.id} />
                <PhotoUpload projectId={projectId} tag="document" caption={item.label} label="Photos or a PDF" />
                <label htmlFor={`note-${item.id}`} className="mb-1.5 mt-3 block text-sm font-semibold text-ink-900">
                  Note
                </label>
                <textarea id={`note-${item.id}`} name="note" maxLength={2000} className={textarea} placeholder="What you checked, and what you found" />
              </ActionForm>
            </div>
          </details>
        )}

        {reviewer && choices.length > 0 && (
          <details className="group min-w-0 open:basis-full" open={item.status === "under-review"}>
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface group-open:border-ink-300">
              <span aria-hidden className="text-ink-500 transition group-open:rotate-90">▸</span> Review
            </summary>
            <div className="pb-2 pt-3">
              <ActionForm flash action={reviewAction.bind(null, projectId)} submitLabel="Save the review" busyLabel="Saving…">
                <input type="hidden" name="itemId" value={item.id} />
                <fieldset>
                  <legend className="mb-1.5 text-sm font-semibold text-ink-900">Decision</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {choices.map((c) => (
                      <label key={c.to} className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
                        <input type="radio" name="to" value={c.to} required className="h-4 w-4 accent-accent-600" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label htmlFor={`rn-${item.id}`} className="mb-1.5 mt-3 block text-sm font-semibold text-ink-900">
                  {item.key === "planning-pd" ? "Outcome (required to approve)" : "Note"}
                </label>
                <textarea
                  id={`rn-${item.id}`}
                  name="note"
                  maxLength={2000}
                  className={textarea}
                  placeholder={item.key === "planning-pd" ? "PD checks passed: technical lead confirms (or: planning route needed)" : "What you checked, or why"}
                  aria-describedby={`rh-${item.id}`}
                />
                <p id={`rh-${item.id}`} className="mt-1.5 text-xs text-ink-500">
                  {item.statutory
                    ? "Statutory: approval needs evidence or a written note of what you checked. It can't be overridden."
                    : "Approval needs evidence or a note. A reason is needed to reject or mark it not applicable."}
                </p>
                {canOverride && (
                  <div className="mt-3">
                    <label htmlFor={`ov-${item.id}`} className="mb-1.5 block text-sm font-semibold text-ink-900">
                      Admin override reason (only to approve without evidence)
                    </label>
                    <input id={`ov-${item.id}`} name="overrideReason" maxLength={500} className={field} />
                  </div>
                )}
              </ActionForm>
            </div>
          </details>
        )}

        {(item.history?.length ?? 0) > 0 && (
          <details className="group min-w-0 open:basis-full">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface group-open:border-ink-300">
              <span aria-hidden className="text-ink-500 transition group-open:rotate-90">▸</span> History ({item.history!.length})
            </summary>
            <ol className="space-y-2 pb-2 pt-3 text-sm">
              {[...item.history!].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="text-xs text-ink-500">{fmtLondon(h.at)} · {h.by}</span>
                  <span className="block text-ink-900">
                    {COMPLIANCE_STATUS_TEXT[h.from]} → {COMPLIANCE_STATUS_TEXT[h.to]}
                    {h.note ? `: ${h.note}` : ""}
                    {h.mediaIds?.length ? ` (${h.mediaIds.length} file${h.mediaIds.length === 1 ? "" : "s"})` : ""}
                    {h.overrideReason ? ` (override: ${h.overrideReason})` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </Card>
  );
}
