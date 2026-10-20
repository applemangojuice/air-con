import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  COMPLIANCE_CATEGORY_LABEL,
  COMPLIANCE_GATE_GROUPS,
  COMPLIANCE_STATUS_TEXT,
  COMPLIANCE_TEMPLATE,
  BUILDING_REGS_ROUTES,
  BUILDING_REGS_ROUTE_TEXT,
  HRB_MIN_HEIGHT_M,
  HRB_MIN_STOREYS,
  PD_CHECKS,
  PLANNING_OUTCOMES,
  PLANNING_OUTCOME_TEXT,
  buildingRegsRouteProblem,
  higherRiskBuilding,
  isFlat,
  ROLE_LABEL,
  can,
  cancellationStatus,
  complianceProgress,
  asbestosSuspectedAtSurvey,
  complianceTemplateFor,
  meetsRequirement,
  planningNoiseFlags,
  type ComplianceItem,
  type DesignRecord,
  type ComplianceStatus,
  type MeasuredSurvey,
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
import * as designsRepo from "@/lib/repo/designs";
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

  const [settings, survey, crew, design] = await Promise.all([
    getSettings(),
    surveysRepo.currentForProject(id),
    staffRepo.listByIds(p.booking.crew.map((c) => c.staffId)),
    designsRepo.approvedForProject(id).catch(() => null),
  ]);
  const media = await mediaRepo.listByIds([...new Set(items.flatMap((i) => i.mediaIds))]);
  const urls = await signedMediaUrls(media);
  const mediaById = new Map(media.map((m) => [m.id, { ...m, url: urls.get(m.id) ?? null }]));
  const progress = complianceProgress(items);
  const reviewer = can(staff, "compliance.review");
  const contributor = reviewer || can(staff, "projects.edit") || can(staff, "install.work");
  const today = londonToday();

  const context = (item: ComplianceItem) =>
    contextFor(item, { project: p, survey: survey?.data.permissions.pd, measured: survey?.data, crew, settingsCert: settings.company.fgasCompanyCert, today, design, items });
  const missingKeys = COMPLIANCE_TEMPLATE.filter((t) => !items.some((i) => i.key === t.key));

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
          {missingKeys.length > 0 && contributor && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This checklist is missing some of the current template&apos;s items: {missingKeys.map((t) => t.label).join("; ")}.
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
                        {...(survey?.data ? { measured: survey.data } : {})}
                        companyName={settings.company.legalName}
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
    /** The approved design: its own unit-count, size and noise checks sit beside the survey's answers. */
    design?: DesignRecord | null;
    /** The whole checklist: the planning consent item reads the planning outcome and the listing answer. */
    items: ComplianceItem[];
    /** The survey itself: tenure for the owner's authority, the asbestos answers for the asbestos check. */
    measured?: MeasuredSurvey;
  },
): ContextRow[] {
  const p = facts.project;
  const on = p.booking.dates.at(-1) ?? facts.today;
  switch (item.key) {
    case "planning-pd": {
      const answers: ContextRow[] = !facts.survey
        ? [{ label: "Survey checklist", value: "Not recorded yet", tone: "warn" }]
        : PD_CHECKS.map((c) => {
            const a = facts.survey?.[c.id];
            return { label: c.label, value: a === "yes" ? "Yes" : a === "no" ? "No" : a === "unsure" ? "Unsure" : "Not answered", tone: a === "yes" ? "success" : a === "no" ? "danger" : "warn" };
          });
      return [...answers, ...designChecks(facts.design, ["planning", "unit-count", "outdoor-volume", "noise"])];
    }
    case "planning-consent": {
      const pd = facts.items.find((i) => i.key === "planning-pd");
      const des = facts.items.find((i) => i.key === "designations");
      const listedAnswer = facts.survey?.["not-listed"];
      return [
        {
          label: "Planning outcome",
          value: pd?.status === "approved" && pd.planningOutcome ? `${PLANNING_OUTCOME_TEXT[pd.planningOutcome]}${pd.reviewedBy ? ` (${pd.reviewedBy})` : ""}` : "Not recorded yet",
          tone: pd?.status === "approved" && pd.planningOutcome === "pd" ? "success" : "warn",
        },
        {
          label: "Listed building (designations check)",
          value: des?.status === "approved" && des.listedBuilding ? (des.listedBuilding === "yes" ? "Yes" : "No") : "Not checked yet",
          tone: des?.status === "approved" && des.listedBuilding === "no" ? "success" : des?.listedBuilding === "yes" ? "danger" : "warn",
        },
        {
          label: "Survey: isn't a listed building",
          value: listedAnswer === "yes" ? "Yes" : listedAnswer === "no" ? "No: listed" : listedAnswer === "unsure" ? "Unsure" : "Not answered",
          tone: listedAnswer === "yes" ? "success" : listedAnswer === "no" ? "danger" : "warn",
        },
      ];
    }
    case "noise-assessment":
      return designChecks(facts.design, ["noise"]);
    case "ownership-authority": {
      const site = facts.measured?.site;
      if (!site) return [{ label: "Survey", value: "Not recorded yet", tone: "warn" }];
      const consent = site.tenure === "leaseholder" || site.tenure === "tenant";
      return [
        { label: "Tenure (survey)", value: site.tenure, tone: consent || site.tenure === "unknown" ? "warn" : "success", ...(consent ? { detail: "The written consent must be attached to approve this, and install day 1 waits for it." } : {}) },
        { label: "Decision maker", value: site.decisionMaker?.trim() || "Not recorded", tone: site.decisionMaker?.trim() ? undefined : "warn" },
        { label: "Authority to go ahead (survey tick)", value: site.ownerConfirmed ? "Confirmed" : "Not confirmed", tone: site.ownerConfirmed ? "success" : "warn" },
      ];
    }
    case "heat-pump-building-regs": {
      const m = facts.measured;
      if (!m) return [{ label: "Survey", value: "Not recorded yet", tone: "warn" }];
      if (!isFlat(m)) return [{ label: "Home (survey)", value: m.house.type, tone: "success", detail: "A house: any route can work (our competent person scheme, full plans, or a building notice)." }];
      const b = m.house.block ?? {};
      const hrb = higherRiskBuilding(m);
      return [
        {
          label: "The block (survey)",
          value: [b.storeys ? `${b.storeys} storeys` : "", b.heightM ? `${b.heightM} m` : ""].filter(Boolean).join(", ") || "Not recorded",
          tone: hrb ? "danger" : b.storeys || b.heightM ? "success" : "warn",
          detail: hrb
            ? `A higher-risk building (${HRB_MIN_STOREYS} storeys or ${HRB_MIN_HEIGHT_M} m and above, with two or more homes): the Building Safety Regulator is the building control authority. Outside our competent person scheme (check it covers work in a higher-risk building), the Regulator's approval comes before any work: apply on GOV.UK and allow its decision period. No building notice, no full plans to the council.`
            : "A flat in a block: no building notice (the Fire Safety Order covers the block's common parts). Our competent person scheme, or a full plans application.",
        },
        { label: "Crosses a compartment wall or floor, or a common part", value: b.crossing ?? "Not answered", tone: b.crossing === "no" ? "success" : "warn", ...(b.crossing !== "no" ? { detail: "The crew photographs the fire-stopping on day 1 (Fire-stopping at the compartment crossing)." } : {}) },
        { label: "Freeholder or managing agent", value: b.freeholder?.trim() || "Not recorded", tone: b.freeholder?.trim() ? undefined : "warn" },
      ];
    }
    case "asbestos": {
      const m = facts.measured;
      if (!m) return [{ label: "Survey", value: "Not recorded yet", tone: "warn" }];
      const suspected = asbestosSuspectedAtSurvey(m);
      return [
        { label: "Built", value: m.house.era, tone: m.house.era === "2000+" ? "success" : "warn" },
        {
          label: "Survey: asbestos",
          value: m.house.asbestosRisk,
          tone: m.house.asbestosRisk === "none-suspected" ? "success" : m.house.asbestosRisk === "suspected" ? "danger" : "warn",
          ...(m.house.asbestosNote ? { detail: m.house.asbestosNote } : {}),
        },
        { label: "Survey: fuse board flash guard", value: m.electrics.asbestosFlashGuard, tone: m.electrics.asbestosFlashGuard === "yes" ? "danger" : m.electrics.asbestosFlashGuard === "possible" ? "warn" : "success" },
        ...(suspected ? [{ label: "To approve", value: "Test result or route change attached", tone: "warn" as const, detail: "The survey suspects asbestos: attach the test result or asbestos survey (or the route that avoids it) and say how it's cleared." }] : []),
      ];
    }
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

type ContextRow = { label: string; value: string; tone?: "success" | "warn" | "danger"; detail?: string };

const RULE_WORD = { pass: "Pass", review: "Review", fail: "Blocked" } as const;

/**
 * The approved design's own checks (Class G unit count and size, the noise
 * estimate), per option, in the design's words: never a planning decision,
 * only what the reviewer should weigh.
 */
function designChecks(design: DesignRecord | null | undefined, ids: string[]): ContextRow[] {
  if (!design) return [{ label: "Approved design", value: "None yet", tone: "warn" }];
  const rows: ContextRow[] = [];
  for (const v of design.variants) {
    const flagged = new Set(planningNoiseFlags(v).map((r) => r.id));
    for (const r of v.rules.filter((x) => ids.includes(x.id))) {
      rows.push({
        label: `Design v${design.version}, ${v.label}: ${r.title}`,
        value: RULE_WORD[r.status],
        tone: flagged.has(r.id) ? (r.status === "fail" ? "danger" : "warn") : "success",
        detail: r.detail,
      });
    }
  }
  return rows.length ? rows : [{ label: `Design v${design.version}`, value: "No unit-count, size or noise result recorded", tone: "warn" }];
}

function ContextList({ context }: { context: ContextRow[] }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-1.5 rounded-2xl bg-surface/60 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      {context.map((c) => (
        <div key={c.label} className="contents">
          <dt className="text-ink-700">{c.label}</dt>
          <dd className={`font-medium sm:text-right ${c.tone === "success" ? "text-emerald-800" : c.tone === "danger" ? "text-red-700" : c.tone === "warn" ? "text-amber-800" : "text-ink-900"}`}>{c.value}</dd>
          {c.detail && <dd className="-mt-1 mb-1 text-xs leading-relaxed text-ink-500 sm:col-span-2">{c.detail}</dd>}
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
  measured,
  companyName,
}: {
  item: ComplianceItem;
  projectId: string;
  staff: StaffMember;
  reviewer: boolean;
  contributor: boolean;
  media: { id: string; contentType: string; url: string | null; caption?: string; takenAt: string }[];
  context: ContextRow[];
  /** The survey: which Building Regulations routes fit this home. */
  measured?: MeasuredSurvey;
  /** Our legal name: the CDM roles' default. */
  companyName: string;
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
            {item.status === "approved" && item.planningOutcome && <p className="font-semibold text-ink-900">Outcome: {PLANNING_OUTCOME_TEXT[item.planningOutcome]}</p>}
            {item.status === "approved" && item.buildingRegsRoute && <p className="font-semibold text-ink-900">Route: {BUILDING_REGS_ROUTE_TEXT[item.buildingRegsRoute]}</p>}
            {item.status === "approved" && item.cdmRoles && (
              <p className="font-semibold text-ink-900">
                Principal contractor: {item.cdmRoles.principalContractor} · Principal designer: {item.cdmRoles.principalDesigner}
              </p>
            )}
            {item.status === "approved" && item.listedBuilding && (
              <p className="font-semibold text-ink-900">Listed building, or in the curtilage of one: {item.listedBuilding === "yes" ? "Yes" : "No"}</p>
            )}
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
                {item.key === "planning-pd" && choices.some((c) => c.to === "approved") && (
                  <fieldset className="mt-3">
                    <legend className="mb-1.5 text-sm font-semibold text-ink-900">Outcome (to approve)</legend>
                    <div className="flex flex-col gap-y-1">
                      {PLANNING_OUTCOMES.map((o) => (
                        <label key={o} className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
                          <input type="radio" name="planningOutcome" value={o} className="h-4 w-4 accent-accent-600" />
                          {PLANNING_OUTCOME_TEXT[o]}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">&quot;Needed&quot; holds install day 1 until the council&apos;s decision notice is on &quot;Planning permission or listed building consent granted&quot;.</p>
                  </fieldset>
                )}
                {item.key === "heat-pump-building-regs" && choices.some((c) => c.to === "approved") && (
                  <fieldset className="mt-3">
                    <legend className="mb-1.5 text-sm font-semibold text-ink-900">How is it covered? (to approve)</legend>
                    <div className="flex flex-col gap-y-1">
                      {BUILDING_REGS_ROUTES.map((r) => {
                        const block = measured ? { flat: isFlat(measured), higherRisk: higherRiskBuilding(measured) } : undefined;
                        const problem = buildingRegsRouteProblem(r, block);
                        return (
                          <label key={r} className={`flex min-h-11 items-center gap-2 text-sm ${problem ? "text-ink-500" : "text-ink-900"}`}>
                            <input type="radio" name="buildingRegsRoute" value={r} disabled={Boolean(problem)} defaultChecked={r === "competent-person" && !problem} className="h-4 w-4 accent-accent-600" />
                            {BUILDING_REGS_ROUTE_TEXT[r]}
                            {problem ? <span className="text-xs">(not for this home)</span> : null}
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">Write the scheme and registration number, or the application reference and date, in the note.</p>
                  </fieldset>
                )}
                {item.key === "rams" && choices.some((c) => c.to === "approved") && (
                  <fieldset className="mt-3">
                    <legend className="mb-1.5 text-sm font-semibold text-ink-900">CDM 2015 roles (to approve)</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-sm text-ink-900">
                        Principal contractor
                        <input name="principalContractor" defaultValue={item.cdmRoles?.principalContractor ?? companyName} maxLength={160} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" />
                      </label>
                      <label className="block text-sm text-ink-900">
                        Principal designer
                        <input name="principalDesigner" defaultValue={item.cdmRoles?.principalDesigner ?? companyName} maxLength={160} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" />
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">Us for both unless someone else agreed in writing; the subcontracted electrician is a contractor. With a subcontractor, the handover pack gets a short health and safety file.</p>
                  </fieldset>
                )}
                {item.key === "designations" && choices.some((c) => c.to === "approved") && (
                  <fieldset className="mt-3">
                    <legend className="mb-1.5 text-sm font-semibold text-ink-900">Is it a listed building, or in the curtilage of one? (to approve)</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      {(["no", "yes"] as const).map((v) => (
                        <label key={v} className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
                          <input type="radio" name="listedBuilding" value={v} className="h-4 w-4 accent-accent-600" />
                          {v === "yes" ? "Yes: listed" : "No: not listed"}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">&quot;Yes&quot; holds install day 1 until listed building consent is granted.</p>
                  </fieldset>
                )}
                <label htmlFor={`rn-${item.id}`} className="mb-1.5 mt-3 block text-sm font-semibold text-ink-900">
                  {item.key === "planning-pd"
                    ? "What you checked (required to approve)"
                    : item.key === "planning-consent"
                      ? "Decision notice: reference, date granted and conditions (required to approve)"
                      : "Note"}
                </label>
                <textarea
                  id={`rn-${item.id}`}
                  name="note"
                  maxLength={2000}
                  className={textarea}
                  placeholder={
                    item.key === "planning-pd"
                      ? "The PD conditions you checked, or why an application or consent is needed"
                      : item.key === "planning-consent"
                        ? "e.g. 2026/1234/P granted 3 Nov 2026; condition 3: unit painted to match the brickwork"
                        : "What you checked, or why"
                  }
                  aria-describedby={`rh-${item.id}`}
                />
                <p id={`rh-${item.id}`} className="mt-1.5 text-xs text-ink-500">
                  {item.key === "planning-consent"
                    ? "Statutory: approval needs the decision notice attached (above, under Add evidence) and its reference, date and conditions here. It can't be overridden."
                    : item.statutory
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
