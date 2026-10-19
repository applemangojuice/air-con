import {
  INSTALL_TEMPLATE_VERSION,
  ISSUE_KIND_LABEL,
  LINK_PLACEHOLDER,
  LEARNING_PROMPTS,
  TAX_CODES,
  blockersFor,
  buildCommissioningRecord,
  can,
  canRecord,
  canReviewExceptions,
  canSetOutcome,
  commissioningFromJob,
  commissioningSignErrors,
  createIssue,
  documentCompany,
  documentCustomer,
  equipmentFromJob,
  fgasFromJob,
  handoverDeadlines,
  idempotencyKey,
  isGatePassed,
  isOpen,
  isPlaceholderPhone,
  latestEvidence,
  meetsRequirement,
  migrateProject,
  targetError,
  ramsAcknowledgements,
  runsheetFromDesign,
  runsheetPercent,
  runsheetProgress,
  setJobTarget,
  transitionIssue,
  withExceptionReview,
  type Blocker,
  type CatalogueItem,
  type CommissioningRecord,
  type DesignRecord,
  type DocumentLink,
  type EvidenceRecord,
  type ExceptionReview,
  type HandoverPackSnapshot,
  type InstallJobV2,
  type InstallStep,
  type Issue,
  type IssueKind,
  type Learning,
  type MeasuredSurvey,
  type MediaItem,
  type Project,
  type ProposalRecord,
  type Severity,
  type StaffMember,
  type StepStatusRecord,
  type TargetKey,
  type TimeEntry,
  wrapUpDayOf,
} from "@aircon/domain";
import type {
  FieldClock,
  FieldHeader,
  FieldIssue,
  FieldJob,
  FieldMe,
  JobCard,
  JobPack,
  LayoutPhoto,
  MyJobs,
  PackMaterial,
  PackRoom,
  RiskFlag,
} from "@/components/field/types";
import { audit } from "./audit";
import { isAssigned, staffCanAccessProject } from "./auth/access";
import { appUrl } from "./brand";
import { crewLead } from "./comms/action-map";
import { notify } from "./comms/outbox";
import { renderMessage, templateContext } from "./comms/templates";
import { createDocument, currentDocument, listDocuments } from "./documents-server";
import { appMode } from "./env-mode";
import type { SyncOp, SyncResult } from "./field-outbox";
import { fmtDate, londonDateOf } from "./format";
import { signedMediaUrls } from "./media-server";
import { buildReadinessContext, dispatch, loadProject, londonToday } from "./project-service";
import { db, isUniqueViolation, isUuid, must, nowIso, type Row } from "./repo/base";
import * as catalogueRepo from "./repo/catalogue";
import * as designsRepo from "./repo/designs";
import * as evidenceRepo from "./repo/evidence";
import * as installJobsRepo from "./repo/installJobs";
import * as issuesRepo from "./repo/issues";
import * as learningsRepo from "./repo/learnings";
import * as mediaRepo from "./repo/media";
import * as messagesRepo from "./repo/messages";
import * as proposalsRepo from "./repo/proposals";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import * as surveysRepo from "./repo/surveys";
import * as timeRepo from "./repo/time";
import { getSettings } from "./settings-server";
import { getServiceClient } from "./supabase-server";

/**
 * The field app on the server (F6): install jobs, the job pack, evidence,
 * outcomes, exception reviews, time, issues, commissioning and handover.
 *
 *   const job = await loadFieldJob(projectId, staff);           // the runsheet screens
 *   const results = await processSyncBatch(staff, ops);         // the phone's outbox
 *
 * Every entry point takes the signed-in staff member and checks, itself,
 * that they may open the project (board-wide view, or assigned to it:
 * subcontractors only ever the latter) on top of the caller's own guard.
 * Qualification gates are the domain's (canRecord, canSetOutcome, the
 * reducer's tech-lead checks); this module never decides them.
 *
 * Project changes go through `dispatch` (gates, audit, comms). Evidence is
 * append-only and idempotent on the phone's id; step outcomes and reviews
 * live on the install_jobs row, written with an optimistic check so two
 * phones saving at once both land.
 */

export class FieldError extends Error {
  readonly status: number;
  readonly blockers?: Blocker[];
  constructor(message: string, status = 400, blockers?: Blocker[]) {
    super(message);
    this.name = "FieldError";
    this.status = status;
    if (blockers) this.blockers = blockers;
  }
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/** The project, if this person may work on it. Everything else is "not found" (404, never a hint). */
export async function projectForStaff(projectId: string, staff: StaffMember): Promise<Project> {
  if (!getServiceClient()) throw new FieldError("No database connected.", 503);
  if (!isUuid(projectId)) throw new FieldError("Not found", 404);
  const project = await loadProject(projectId);
  if (!project || !staffCanAccessProject(staff, project)) throw new FieldError("Not found", 404);
  return project;
}

function meOf(staff: StaffMember, today: string): FieldMe {
  return {
    id: staff.id,
    name: staff.name,
    roles: staff.roles,
    external: staff.external,
    quals: {
      fgas: meetsRequirement(staff, "fgas", today),
      electrical: meetsRequirement(staff, "electrical", today),
      techLead: meetsRequirement(staff, "tech-lead", today),
    },
    canReview: canReviewExceptions(staff, today).ok,
    canSign: can(staff, "commissioning.sign") && meetsRequirement(staff, "tech-lead", today),
    canViewAll: can(staff, "projects.view-all"),
    staff: {
      id: staff.id,
      email: "",
      name: staff.name,
      roles: staff.roles,
      external: staff.external,
      active: staff.active,
      qualifications: staff.qualifications.map((q) => ({
        kind: q.kind,
        reference: q.reference.trim() ? "on file" : "",
        ...(q.expiresOn ? { expiresOn: q.expiresOn } : {}),
      })),
    },
  };
}

/** Prices are for staff who see money; subcontractors never do. */
const seesPrices = (staff: StaffMember) => !staff.external && can(staff, "projects.view-all");

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function mapsUrl(address: string, postcode: string): string {
  const q = [address, postcode].filter((s) => s && s.trim()).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

const KIT: Record<Project["kit"]["status"], { label: string; tone: JobCard["kitTone"] }> = {
  "not-ordered": { label: "Kit not ordered", tone: "warn" },
  ordered: { label: "Kit ordered", tone: "info" },
  confirmed: { label: "Kit date confirmed", tone: "info" },
  dispatched: { label: "Kit on its way", tone: "info" },
  delivered: { label: "Kit delivered, not checked", tone: "warn" },
  inspected: { label: "Kit checked", tone: "success" },
};

// p.kit is the project's own kit status. F5's purchasing (syncKitStatus) keeps it in step with the purchase orders,
// and the ready-to-install gate reads the same orders through kitSummary, so the badge and the gate agree.
export function kitBadge(p: Project): { label: string; tone: NonNullable<JobCard["kitTone"]> } {
  const k = KIT[p.kit.status] ?? KIT["not-ordered"];
  const short = p.kit.shortages > 0 ? `, ${p.kit.shortages} short` : "";
  return { label: `${k.label}${short}`, tone: p.kit.shortages > 0 ? "warn" : (k.tone ?? "neutral") };
}

const PRE_2000 = new Set(["pre-1930", "1930-1950", "1950-2000"]);

/** The flags crews care about before they leave: height, asbestos, pets, hidden services. */
export function riskFlags(measured: MeasuredSurvey | null | undefined, opts: { pump?: boolean } = {}): RiskFlag[] {
  if (!measured) return [{ key: "survey-missing", label: "No survey on file: check risks on arrival", tone: "warn" }];
  const out: RiskFlag[] = [];
  const height =
    measured.risks.workingAtHeight || measured.outdoor.positions.some((p) => p.chosen && (p.accessEquipment === "tower" || p.accessEquipment === "scaffold"));
  if (height) {
    const eq = measured.outdoor.positions.find((p) => p.chosen && p.accessEquipment !== "none")?.accessEquipment;
    out.push({ key: "height", label: eq && eq !== "ladder" ? `Working at height: ${eq}` : "Working at height", tone: "warn" });
  }
  const asbestos =
    measured.house.asbestosRisk === "suspected"
      ? "Asbestos suspected: don't drill until cleared"
      : measured.house.asbestosRisk === "possible" || measured.electrics.asbestosFlashGuard === "possible" || measured.electrics.asbestosFlashGuard === "yes"
        ? "Possible asbestos: check before drilling"
        : PRE_2000.has(measured.house.era) || measured.house.asbestosRisk === "not-assessed"
          ? "Pre-2000 home: asbestos check before drilling"
          : null;
  if (asbestos) out.push({ key: "asbestos", label: asbestos, tone: measured.house.asbestosRisk === "suspected" ? "danger" : "warn" });
  if (measured.site.petsKids?.trim()) out.push({ key: "pets", label: `Pets or children: ${measured.site.petsKids.trim()}`, tone: "neutral" });
  if (measured.risks.concealedServicesConcern) out.push({ key: "services", label: "Hidden services flagged: scan before drilling", tone: "warn" });
  if (opts.pump) out.push({ key: "pump", label: "Condensate pump on this job", tone: "neutral" });
  return out;
}

function dayState(p: Project): { currentDay: number | null; nextDay: number | null; totalDays: number } {
  const totalDays = p.booking.installDays || p.booking.dates.length || 3;
  const current = p.install.days.find((d) => d.status === "in-progress")?.n ?? null;
  // Complete: the last day stays open to the crew until they end it (update, learnings, their clock).
  if (p.install.status === "complete") return { currentDay: current ?? wrapUpDayOf(p)?.n ?? null, nextDay: null, totalDays };
  const startedNs = p.install.days.filter((d) => d.startedAt).map((d) => d.n);
  const next = current ? null : (startedNs.length ? Math.max(...startedNs) + 1 : 1);
  return { currentDay: current, nextDay: next, totalDays };
}

function headerOf(p: Project, risks: RiskFlag[], today: string): FieldHeader {
  const { currentDay, nextDay, totalDays } = dayState(p);
  const kit = kitBadge(p);
  const days = p.install.days.length
    ? p.install.days
    : p.booking.dates.map((date, i) => ({ n: i + 1, date, status: "planned" as const }));
  return {
    projectId: p.id,
    customerName: p.customer.name || "Customer",
    address: p.customer.addressLine,
    postcode: p.customer.postcode,
    mapsUrl: mapsUrl(p.customer.addressLine, p.customer.postcode),
    ...(p.customer.phone ? { customerPhone: p.customer.phone } : {}),
    ...(p.customer.accessNotes ? { accessNotes: p.customer.accessNotes } : {}),
    ...(p.customer.parkingNotes ? { parkingNotes: p.customer.parkingNotes } : {}),
    ...(p.pilot ? { pilotLabel: p.pilot.label } : {}),
    dates: p.booking.dates,
    days,
    totalDays,
    currentDay,
    nextDay,
    crew: p.booking.crew,
    installStatus: p.install.status,
    handoverStatus: p.handover.status,
    bookingStatus: p.booking.status,
    kitLabel: kit.label,
    kitTone: kit.tone,
    risks,
    ...(p.install.onMyWay ? { onMyWay: p.install.onMyWay } : {}),
    ...(p.handover.packDocumentId ? { packDocumentId: p.handover.packDocumentId } : {}),
    ...(p.handover.signoff ? { signoff: p.handover.signoff } : {}),
    electricalCert: p.handover.electricalCert,
    today,
  };
}

/* ------------------------------------------------------------------ */
/* The install job                                                     */
/* ------------------------------------------------------------------ */

/** A stored job nobody has worked on, built from an older template: safe to rebuild. */
async function rebuildable(parts: installJobsRepo.InstallJobParts): Promise<boolean> {
  if (parts.templateVersion === INSTALL_TEMPLATE_VERSION) return false;
  if (parts.stepStatuses.length || parts.exceptionReviews.length || parts.commissioning) return false;
  return (await evidenceRepo.listForProject(parts.projectId)).length === 0;
}

/** The accepted option's design variant, and the design it came from. */
async function acceptedDesign(projectId: string): Promise<{ design: DesignRecord; variantId: string; proposal: ProposalRecord } | string> {
  const proposal = await proposalsRepo.acceptedForProject(projectId);
  if (!proposal?.acceptance) return "There's no accepted proposal on record, so there's nothing to build the runsheet from.";
  const option = proposal.options.find((o) => o.id === proposal.acceptance!.optionId);
  if (!option) return "The accepted option isn't on the proposal record.";
  let design = proposal.designId ? await designsRepo.get(proposal.designId) : null;
  if (!design || design.status !== "approved") design = await designsRepo.approvedForProject(projectId);
  if (!design) return "No approved design on record. The tech lead signs the design before the runsheet can be built.";
  if (!design.variants.some((v) => v.id === option.designVariantId)) {
    return `The approved design doesn't have the accepted option's variant (${option.designVariantId}).`;
  }
  return { design, variantId: option.designVariantId, proposal };
}

/**
 * The job's install record, created from the approved design variant of
 * the accepted option once the booking is confirmed. Idempotent: an
 * existing job is returned as it is (a job built from an older template
 * that nobody has touched yet is rebuilt to the current one).
 */
export async function ensureInstallJob(
  projectId: string,
  project?: Project | null,
): Promise<{ ok: true; job: InstallJobV2; created: boolean } | { ok: false; reason: string }> {
  const p = project ?? (await loadProject(projectId));
  if (!p) return { ok: false, reason: "Project not found." };
  const existing = await installJobsRepo.getForProject(projectId);
  if (existing && !(await rebuildable(existing))) {
    const job = await installJobsRepo.loadForProject(projectId, p);
    return job ? { ok: true, job, created: false } : { ok: false, reason: "The install job couldn't be read." };
  }
  if (p.booking.status !== "booked") return { ok: false, reason: "The runsheet is built once the booking is confirmed." };

  const source = await acceptedDesign(projectId);
  if (typeof source === "string") return { ok: false, reason: source };
  const [catalogue, survey] = await Promise.all([catalogueRepo.list(), surveysRepo.currentForProject(projectId)]);
  let runsheet: InstallStep[];
  try {
    runsheet = runsheetFromDesign(source.design, source.variantId, catalogue, survey?.data);
  } catch (err) {
    return { ok: false, reason: `The runsheet couldn't be built from the design: ${(err as Error).message}` };
  }
  const parts: installJobsRepo.InstallJobParts = {
    id: existing?.id ?? crypto.randomUUID(),
    projectId,
    designId: source.design.id,
    templateVersion: INSTALL_TEMPLATE_VERSION,
    runsheet,
    stepStatuses: [],
    exceptionReviews: [],
    qa: { status: "in-progress" },
  };
  if (existing) {
    // Rebuild only if it's still untouched (someone may have started meanwhile).
    const res = await db()
      .from("install_jobs")
      .update({ design_id: isUuid(parts.designId) ? parts.designId : null, template_version: parts.templateVersion, runsheet, updated_at: nowIso() })
      .eq("project_id", projectId)
      .eq("template_version", existing.templateVersion)
      .select("id");
    must(res, "install_jobs rebuild");
  } else {
    const res = await db()
      .from("install_jobs")
      .insert({
        id: parts.id,
        project_id: projectId,
        design_id: isUuid(parts.designId) ? parts.designId : null,
        template_version: parts.templateVersion,
        runsheet,
        step_statuses: [],
        exception_reviews: [],
        commissioning: null,
        qa: parts.qa,
      })
      .select("id");
    // Two phones opening the job at once: the other one made it. Read theirs.
    if (!isUniqueViolation(res.error)) must(res, "install_jobs insert");
  }
  const job = await installJobsRepo.loadForProject(projectId, p);
  if (!job) return { ok: false, reason: "The install job couldn't be read." };
  if (!existing) await audit({ actor: { kind: "system", name: "field" }, action: "install-job.create", entity: "project", entityId: projectId, detail: { template: INSTALL_TEMPLATE_VERSION, steps: runsheet.length } });
  return { ok: true, job, created: !existing };
}

type JobParts = installJobsRepo.InstallJobParts;

/**
 * Read-modify-write the job row with an optimistic check on updated_at, so
 * concurrent saves from two phones are retried rather than lost. `mutate`
 * returns the new parts, or null for "nothing to change".
 */
async function mutateJob(projectId: string, mutate: (parts: JobParts) => JobParts | null): Promise<JobParts> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = must(await db().from("install_jobs").select("*").eq("project_id", projectId).maybeSingle(), "install_jobs read") as Row | null;
    if (!row) throw new FieldError("There's no runsheet for this job yet.", 409);
    const parts = installJobsRepo.fromRow(row);
    const next = mutate(parts);
    if (!next) return parts;
    const res = await db()
      .from("install_jobs")
      .update({
        runsheet: next.runsheet,
        step_statuses: next.stepStatuses,
        exception_reviews: next.exceptionReviews,
        commissioning: next.commissioning ?? null,
        qa: next.qa,
        updated_at: nowIso(),
      })
      .eq("project_id", projectId)
      .eq("updated_at", row.updated_at as string)
      .select("id");
    const data = must(res, "install_jobs update") as Row[] | null;
    if ((data ?? []).length === 1) return next;
  }
  throw new FieldError("Someone else saved this job at the same moment. Please try again.", 409);
}

const asV2 = (parts: JobParts, base: InstallJobV2): InstallJobV2 => ({ ...base, ...parts });

/* ------------------------------------------------------------------ */
/* Today and the jobs list                                             */
/* ------------------------------------------------------------------ */

async function projectsWithVisits(): Promise<Project[]> {
  const [installs, surveys] = await Promise.all([
    db().from("projects").select("id, project").not("install_on", "is", null),
    db().from("projects").select("id, project").not("site_visit_at", "is", null),
  ]);
  const rows = [...((must(installs, "projects with installs") as Row[] | null) ?? []), ...((must(surveys, "projects with surveys") as Row[] | null) ?? [])];
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const p = migrateProject(row.project);
      if (!p.closure.closed || p.closure.reason !== "cancelled") out.push({ ...p, id });
    } catch {
      // An unreadable snapshot never takes the list down.
    }
  }
  return out;
}

function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function installCard(p: Project, today: string, date: string): Promise<JobCard> {
  const [survey, job] = await Promise.all([surveysRepo.currentForProject(p.id), installJobsRepo.loadForProject(p.id, p).catch(() => null)]);
  const { currentDay, totalDays } = dayState(p);
  const idx = p.booking.dates.indexOf(date);
  const day = p.install.days.find((d) => d.date === date) ?? (currentDay && date === today ? p.install.days.find((d) => d.n === currentDay) : undefined);
  const dayN = day?.n ?? (idx >= 0 ? idx + 1 : undefined);
  const kit = kitBadge(p);
  let progressPct: number | undefined;
  if (job) {
    try {
      progressPct = runsheetPercent(job);
    } catch {
      progressPct = undefined;
    }
  }
  const pump = Boolean(job?.runsheet.some((s) => s.title === "Condensate" && /pump/.test(s.item ?? "")));
  return {
    projectId: p.id,
    kind: "install",
    customerName: p.customer.name || "Customer",
    address: p.customer.addressLine,
    postcode: p.customer.postcode,
    mapsUrl: mapsUrl(p.customer.addressLine, p.customer.postcode),
    ...(p.customer.phone ? { customerPhone: p.customer.phone } : {}),
    ...(p.pilot ? { pilotLabel: p.pilot.label } : {}),
    date,
    ...(dayN ? { dayN } : {}),
    totalDays,
    ...(day ? { dayStatus: day.status } : {}),
    ...(day?.startedAt ? { startedAt: day.startedAt } : {}),
    ...(p.customer.accessNotes ? { accessNotes: p.customer.accessNotes } : {}),
    ...(p.customer.parkingNotes ? { parkingNotes: p.customer.parkingNotes } : {}),
    crew: p.booking.crew,
    risks: riskFlags(survey?.data, { pump }),
    kitLabel: kit.label,
    kitTone: kit.tone,
    ...(progressPct !== undefined ? { progressPct } : {}),
    installStatus: p.install.status,
    handoverStatus: p.handover.status,
    href: dayN ? `/field/jobs/${p.id}/day/${dayN}` : `/field/jobs/${p.id}`,
  };
}

function surveyCard(p: Project): JobCard {
  const at = p.survey.scheduledFor ?? "";
  return {
    projectId: p.id,
    kind: "survey",
    customerName: p.customer.name || "Customer",
    address: p.customer.addressLine,
    postcode: p.customer.postcode,
    mapsUrl: mapsUrl(p.customer.addressLine, p.customer.postcode),
    ...(p.customer.phone ? { customerPhone: p.customer.phone } : {}),
    ...(p.pilot ? { pilotLabel: p.pilot.label } : {}),
    date: at.slice(0, 10),
    scheduledFor: at,
    surveyStatus: p.survey.status,
    ...(p.customer.accessNotes ? { accessNotes: p.customer.accessNotes } : {}),
    ...(p.customer.parkingNotes ? { parkingNotes: p.customer.parkingNotes } : {}),
    crew: p.survey.surveyor ? [{ staffId: p.survey.surveyor.staffId, name: p.survey.surveyor.name, role: "surveyor", external: false }] : [],
    risks: [],
    // The survey flow (F2) lives at /field/survey/[projectId].
    href: `/field/survey/${p.id}`,
  };
}

/** The install day this project has on `date`, or the day under way when it's today. */
function installDateFor(p: Project, today: string): string | null {
  if (p.booking.status !== "booked") return null;
  if (p.install.days.some((d) => d.status === "in-progress")) return today;
  return p.booking.dates.includes(today) && p.install.status !== "complete" ? today : null;
}

/**
 * Today, upcoming and recent visits for this person: install days where
 * they're on the crew and surveys they're doing. Staff with the board-wide
 * view also see the rest of today's team.
 */
export async function listMyJobs(staff: StaffMember): Promise<MyJobs> {
  const today = londonToday();
  const out: MyJobs = { today, todayJobs: [], upcoming: [], recent: [], team: [] };
  if (!getServiceClient()) return out;
  const projects = await projectsWithVisits();
  const viewAll = can(staff, "projects.view-all");
  const horizon = addDaysIso(today, 21);
  const since = addDaysIso(today, -21);
  for (const p of projects) {
    const onCrew = p.booking.crew.some((m) => m.staffId === staff.id);
    const surveying = p.survey.surveyor?.staffId === staff.id;
    const todayDate = installDateFor(p, today);
    const surveyDay = p.survey.scheduledFor?.slice(0, 10);
    const surveyOpen = p.survey.status === "booked" || p.survey.status === "in-progress";

    if (onCrew && p.booking.status === "booked") {
      if (todayDate) out.todayJobs.push(await installCard(p, today, todayDate));
      else {
        const next = p.install.status === "complete" ? undefined : p.booking.dates.find((d) => d > today);
        // Days actually worked count too: a crew can start before the booked dates.
        const worked = p.install.days.flatMap((d) => (d.date ? [d.date] : []));
        const last = [...p.booking.dates, ...worked].filter((d) => d <= today).sort().pop();
        if (next && next <= horizon) out.upcoming.push(await installCard(p, today, next));
        else if (p.install.status === "complete" || (last && last >= since)) {
          if (last && last >= since) out.recent.push(await installCard(p, today, last));
        }
      }
    } else if (viewAll && todayDate) {
      out.team.push(await installCard(p, today, todayDate));
    }

    if (surveying && surveyDay) {
      if (surveyDay === today && surveyOpen) out.todayJobs.push(surveyCard(p));
      else if (surveyDay > today && surveyDay <= horizon && surveyOpen) out.upcoming.push(surveyCard(p));
      else if (surveyDay < today && surveyDay >= since) out.recent.push(surveyCard(p));
    } else if (viewAll && surveyDay === today && surveyOpen && !surveying) {
      out.team.push(surveyCard(p));
    }
  }
  const byTime = (a: JobCard, b: JobCard) => (a.scheduledFor ?? `${a.date}T08:00`).localeCompare(b.scheduledFor ?? `${b.date}T08:00`);
  out.todayJobs.sort(byTime);
  out.upcoming.sort(byTime);
  out.recent.sort((a, b) => byTime(b, a));
  out.team.sort(byTime);
  return out;
}

/* ------------------------------------------------------------------ */
/* One job: the runsheet screens                                       */
/* ------------------------------------------------------------------ */

async function clockFor(staff: StaffMember, projectId: string): Promise<FieldClock | null> {
  const open = await timeRepo.openForStaff(staff.id).catch(() => null);
  if (!open || open.projectId !== projectId) return null;
  return { entryId: open.id, startedAt: open.startedAt, kind: open.kind, ...(open.dayN ? { dayN: open.dayN } : {}) };
}

async function fieldIssues(projectId: string, staff: StaffMember, customerName?: string): Promise<FieldIssue[]> {
  const issues = await issuesRepo.listForProject(projectId);
  const shown = issues.filter((i) => isOpen(i) || Date.parse(i.resolvedAt ?? "") > Date.now() - 14 * 86_400_000);
  const media = await mediaRepo.listByIds(shown.flatMap((i) => i.mediaIds));
  const urls = await signedMediaUrls(media);
  return shown
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.number - a.number)
    .map((i) => toFieldIssue(i, staff, urls, customerName));
}

function toFieldIssue(i: Issue, staff: StaffMember, urls: Map<string, string>, customerName?: string): FieldIssue {
  return {
    id: i.id,
    projectId: i.projectId,
    number: i.number,
    kind: i.kind,
    title: i.title,
    ...(i.detail ? { detail: i.detail } : {}),
    severity: i.severity,
    status: i.status,
    blocking: i.blocking,
    raisedAt: i.raisedAt,
    raisedBy: i.raisedBy.name,
    customerVisible: i.customerVisible,
    ...(i.variation
      ? {
          variation: {
            status: i.variation.status,
            description: i.variation.description,
            ...(seesPrices(staff) ? { totalDeltaPence: i.variation.totalDeltaPence } : {}),
          },
        }
      : {}),
    mediaUrls: i.mediaIds.map((id) => urls.get(id)).filter((u): u is string => Boolean(u)),
    ...(customerName ? { customerName } : {}),
  };
}

async function evidenceMediaUrls(job: InstallJobV2 | null): Promise<Record<string, string>> {
  if (!job) return {};
  const ids = [...new Set(job.evidence.map((e) => e.mediaId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return {};
  const items = await mediaRepo.listByIds(ids);
  const urls = await signedMediaUrls(items);
  return Object.fromEntries(urls);
}

/** Everything the runsheet, commissioning and handover screens need for one job. */
export async function loadFieldJob(projectId: string, staff: StaffMember): Promise<FieldJob> {
  const project = await projectForStaff(projectId, staff);
  const today = londonToday();
  const [ensured, survey, clock, issues] = await Promise.all([
    ensureInstallJob(projectId, project).catch((err: unknown) => ({ ok: false as const, reason: `The runsheet couldn't be loaded: ${(err as Error).message}` })),
    surveysRepo.currentForProject(projectId),
    clockFor(staff, projectId),
    fieldIssues(projectId, staff),
  ]);
  const job = ensured.ok ? ensured.job : null;
  const pump = Boolean(job?.runsheet.some((s) => s.title === "Condensate" && /pump/.test(s.item ?? "")));
  const mode = appMode();
  return {
    header: headerOf(project, riskFlags(survey?.data, { pump }), today),
    job,
    ...(ensured.ok ? {} : { jobProblem: ensured.reason }),
    me: meOf(staff, today),
    clock,
    issues,
    mediaUrls: await evidenceMediaUrls(job),
    smsMode: mode.sms,
    emailMode: mode.email,
  };
}

/* ------------------------------------------------------------------ */
/* The job pack                                                        */
/* ------------------------------------------------------------------ */

const STANDARD_TOOLS = [
  "Dust sheets, floor and stair protection",
  "Cable and pipe detector",
  "Core drill with dust extraction, and the right bit",
  "Spirit level and laser",
  "Flaring tool, pipe cutter, deburrer and benders",
  "Calibrated torque wrench with crowfoot heads",
  "Oxygen-free nitrogen, regulator with relief valve",
  "Vacuum pump and digital micron gauge",
  "Manifold gauges and refrigerant scale",
  "Leak detection spray",
  "Thermometer probe for the air temperature split",
  "Multifunction tester (electrician)",
  "Lock-off kit",
];

function toolsFor(job: InstallJobV2 | null, measured: MeasuredSurvey | null | undefined): { label: string; why?: string }[] {
  const out: { label: string; why?: string }[] = STANDARD_TOOLS.map((label) => ({ label }));
  const steps = job?.runsheet ?? [];
  const sizes = new Set<string>();
  for (const s of steps) for (const e of s.evidence) if (e.targetKey?.startsWith("torque.")) sizes.add(e.targetKey.slice(7));
  if (sizes.size) out.push({ label: `Flare heads: ${[...sizes].sort((a, b) => Number(a) - Number(b)).map((s) => `${s} mm`).join(", ")}`, why: "Pipe sizes on this design" });
  if (steps.some((s) => s.title === "Condensate" && /pump/.test(s.item ?? ""))) out.push({ label: "Condensate pump and its alarm wiring", why: "A room on this job can't drain by gravity" });
  const access = measured?.outdoor.positions.find((p) => p.chosen && p.accessEquipment !== "none")?.accessEquipment;
  if (access === "tower" || access === "scaffold") out.push({ label: access === "tower" ? "Mobile tower (PASMA)" : "Scaffold, booked", why: "The outdoor position is at height" });
  else if (access === "ladder") out.push({ label: "Ladder with stand-off", why: "The outdoor position needs a ladder" });
  return out;
}

function layoutPhoto(m: { id: string; annotations: LayoutPhoto["annotations"]; width?: number; height?: number; caption?: string }, urls: Map<string, string>): LayoutPhoto {
  return {
    id: m.id,
    url: urls.get(m.id) ?? null,
    annotations: m.annotations,
    ...(m.width ? { width: m.width } : {}),
    ...(m.height ? { height: m.height } : {}),
    ...(m.caption ? { caption: m.caption } : {}),
  };
}

/** The job pack: layout photos, equipment by room, materials, tools, RAMS, instructions and documents. */
export async function loadJobPack(projectId: string, staff: StaffMember): Promise<JobPack> {
  const base = await loadFieldJob(projectId, staff);
  const project = (await loadProject(projectId))!;
  const [source, survey, pos, allMedia, catalogue] = await Promise.all([
    acceptedDesign(projectId),
    surveysRepo.currentForProject(projectId),
    purchaseOrdersRepo.listForProject(projectId),
    mediaRepo.listForProject(projectId),
    catalogueRepo.list(),
  ]);
  const byCat = new Map<string, CatalogueItem>(catalogue.map((c) => [c.id, c]));
  const design = typeof source === "string" ? null : source.design;
  const variant = typeof source === "string" ? undefined : design?.variants.find((v) => v.id === source.variantId);
  const option = typeof source === "string" ? undefined : source.proposal.options.find((o) => o.id === source.proposal.acceptance?.optionId);

  // Layout photos: the design's per-room layout media, else drawn-on survey photos of that room.
  const mediaById = new Map(allMedia.map((m) => [m.id, m]));
  const roomPhotoIds = new Map<string, string[]>();
  for (const r of design?.rooms ?? []) {
    const ids = r.layoutMediaIds.filter((id) => mediaById.has(id));
    roomPhotoIds.set(
      r.roomId,
      ids.length ? ids : allMedia.filter((m) => m.roomId === r.roomId && m.annotations.length > 0).map((m) => m.id).slice(0, 3),
    );
  }
  const outdoorIds = (option?.outdoorMediaIds ?? []).filter((id) => mediaById.has(id));
  const outsideFallback = allMedia.filter((m) => m.tag === "outdoor-location" && m.annotations.length > 0).map((m) => m.id);
  const outsideIds = outdoorIds.length ? outdoorIds : outsideFallback.slice(0, 3);
  const wanted = [...new Set([...[...roomPhotoIds.values()].flat(), ...outsideIds])].map((id) => mediaById.get(id)!).filter(Boolean);
  const urls = await signedMediaUrls(wanted);

  const rooms: PackRoom[] = (design?.rooms ?? [])
    .filter((r) => variant?.roomUnits.some((u) => u.roomId === r.roomId))
    .map((r) => {
      const unit = variant?.roomUnits.find((u) => u.roomId === r.roomId);
      const item = unit ? byCat.get(unit.indoorItemId) : undefined;
      return {
        roomId: r.roomId,
        name: r.roomName,
        floor: r.floor,
        unitLabel: item?.label ?? "Indoor unit (not in the catalogue)",
        model: item?.model ?? "",
        pipeRunM: r.pipeRunM,
        condensate: r.condensate,
        photos: (roomPhotoIds.get(r.roomId) ?? []).map((id) => layoutPhoto(mediaById.get(id)!, urls)),
      };
    });
  const outside = (variant?.systems ?? []).map((sys, i, all) => {
    const item = byCat.get(sys.outdoorItemId);
    const position = survey?.data.outdoor.positions.find((p) => p.id === sys.outdoorPositionId) ?? survey?.data.outdoor.positions.find((p) => p.chosen);
    const label = `${all.length > 1 ? `System ${i + 1}: ` : ""}${item?.label ?? "Outdoor unit"}${item?.model ? ` (${item.model})` : ""}`;
    const note = [position?.label, position ? `base: ${position.base.replace(/-/g, " ")}` : "", position?.defrostDrainage ? `defrost water: ${position.defrostDrainage}` : ""]
      .filter(Boolean)
      .join(" · ");
    return { label, photos: i === 0 ? outsideIds.map((id) => layoutPhoto(mediaById.get(id)!, urls)) : [], ...(note ? { note } : {}) };
  });

  // Materials: the purchase orders when they exist, else the design's bill of materials.
  const PO_STATUS: Record<string, string> = {
    required: "Not ordered yet",
    approved: "Approved, not ordered",
    ordered: "Ordered",
    confirmed: "Supplier confirmed",
    dispatched: "On its way",
    delivered: "Delivered",
    inspected: "Checked",
    cancelled: "Cancelled",
  };
  const materials: PackMaterial[] = pos.length
    ? pos
        .filter((po) => po.status !== "cancelled")
        .flatMap((po) =>
          po.lines.map((l) => ({
            key: `${po.id}:${l.id}`,
            label: l.label,
            qty: l.qty,
            status: `${PO_STATUS[po.status] ?? po.status}${l.receivedQty > 0 && l.receivedQty < l.qty ? `: ${l.receivedQty} of ${l.qty} in` : ""} · ${po.supplier}`,
            source: "po" as const,
          })),
        )
    : (variant?.bom ?? []).map((l, i) => ({ key: `bom:${i}`, label: l.label, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), source: "bom" as const }));

  const job = base.job;
  const ramsStep = job?.runsheet.find((s) => s.evidence.some((e) => e.role === "rams"));
  const acks = job ? ramsAcknowledgements(job) : [];

  const instructions: string[] = [];
  const m = survey?.data;
  if (m?.wishes.notes) instructions.push(m.wishes.notes);
  if (m?.wishes.timing) instructions.push(`Timing: ${m.wishes.timing}`);
  if (m?.site.decisionMaker) instructions.push(`Decision maker: ${m.site.decisionMaker}`);
  if (m?.site.siteContactPhone) instructions.push(`Site contact: ${m.site.siteContactPhone}`);
  for (const r of m?.rooms ?? []) if (r.routeNote) instructions.push(`${r.name}: ${r.routeNote}`);
  for (const i of await issuesRepo.listForProject(projectId)) {
    if (i.kind === "customer-instruction" && isOpen(i)) instructions.push(`${i.title}${i.detail ? `: ${i.detail}` : ""}`);
  }
  const prep = project.booking.prep.filter((p) => p.done).map((p) => p.label);
  if (prep.length) instructions.push(`The customer has confirmed: ${prep.join("; ").toLowerCase()}.`);

  // Priced documents only for staff who see prices; subcontractors get the plain scope.
  const documents = seesPrices(staff)
    ? (await listDocuments(projectId))
        .filter((d) => d.status === "final" && (d.kind === "proposal" || d.kind === "contract" || d.kind === "survey-report" || d.kind === "variation"))
        .map((d) => ({ id: d.id, title: d.title, ref: d.ref, kind: d.kind, href: `/d/${d.id}` }))
    : [];
  const scope = rooms.map((r) => `${r.name}: ${r.unitLabel}${r.condensate === "pump" ? ", condensate pump" : ""}`);
  for (const o of outside) scope.push(`Outside: ${o.label}`);
  if (option && seesPrices(staff)) {
    scope.unshift(`Accepted option: ${option.label}`);
  }

  return {
    ...base,
    rooms,
    outside,
    materials,
    tools: toolsFor(job, survey?.data),
    rams: {
      acknowledged: acks.map((a) => ({ by: a.by, at: a.at })),
      mine: acks.some((a) => a.byStaffId === staff.id),
      ...(ramsStep ? { specId: ramsStep.evidence.find((e) => e.role === "rams")!.id } : {}),
      ...(ramsStep?.guidance ? { guidance: ramsStep.guidance } : {}),
    },
    instructions,
    documents,
    scope,
    ...(typeof source === "string" ? { designNote: source } : design?.notes ? { designNote: design.notes } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* The sync batch (the phone's outbox)                                 */
/* ------------------------------------------------------------------ */

const PERMANENT = (id: string, error: string): SyncResult => ({ id, ok: false, error, permanent: true });

/** A capture time from the phone: trusted for the record, never in the future. */
function captureTime(at: string): string {
  const t = Date.parse(at);
  const now = Date.now();
  if (!Number.isFinite(t)) return new Date(now).toISOString();
  return new Date(Math.min(t, now)).toISOString();
}

/** Why recording on this step isn't possible right now, or null. */
export function recordingRefusal(project: Project, step: InstallStep): string | null {
  // The RAMS are read before anyone sets off: that acknowledgement may come in before day 1.
  const preStart = step.evidence.some((e) => e.role === "rams");
  if (project.install.status === "not-started" && !preStart) return "Day 1 hasn't started yet. Tap Arrived to start it, then capture again.";
  if (project.handover.status === "handed-over") return "This job is handed over, so the runsheet is closed. Raise an issue instead.";
  if (step.stage !== "handover" && project.handover.status !== "pending") {
    return "Commissioning is signed, so the install runsheet is closed. Raise an issue instead.";
  }
  return null;
}

interface BatchContext {
  staff: StaffMember;
  projects: Map<string, Project | null>;
  jobs: Map<string, InstallJobV2 | null>;
}

async function projectFor(ctx: BatchContext, projectId: string): Promise<Project | null> {
  if (!ctx.projects.has(projectId)) {
    let p: Project | null = null;
    try {
      p = isUuid(projectId) ? await loadProject(projectId) : null;
    } catch {
      p = null;
    }
    ctx.projects.set(projectId, p && staffCanAccessProject(ctx.staff, p) ? p : null);
  }
  return ctx.projects.get(projectId) ?? null;
}

async function jobFor(ctx: BatchContext, projectId: string, project: Project): Promise<InstallJobV2 | null> {
  if (!ctx.jobs.has(projectId)) ctx.jobs.set(projectId, await installJobsRepo.loadForProject(projectId, project));
  return ctx.jobs.get(projectId) ?? null;
}

async function syncEvidence(ctx: BatchContext, op: Extract<SyncOp, { type: "evidence" }>, project: Project): Promise<SyncResult> {
  const job = await jobFor(ctx, op.projectId, project);
  if (!job) return PERMANENT(op.id, "There's no runsheet for this job yet.");
  const step = job.runsheet.find((s) => s.evidence.some((e) => e.id === op.specId));
  const spec = step?.evidence.find((e) => e.id === op.specId);
  if (!step || !spec) return PERMANENT(op.id, "That step isn't on this job's runsheet any more.");
  const at = captureTime(op.at);
  const gate = canRecord(step, ctx.staff, at);
  if (!gate.ok) return PERMANENT(op.id, gate.reason ?? "You can't record this step.");
  const refusal = recordingRefusal(project, step);
  if (refusal) return PERMANENT(op.id, refusal);
  if (op.mediaId) {
    const media = await mediaRepo.get(op.mediaId);
    if (!media || media.projectId !== op.projectId) return PERMANENT(op.id, "The photo didn't arrive. Take it again.");
  }
  const record: EvidenceRecord = {
    id: op.id,
    specId: op.specId,
    at,
    by: ctx.staff.name,
    byStaffId: ctx.staff.id,
    ...(op.value !== undefined ? { value: op.value } : {}),
    ...(op.ref?.trim() ? { ref: op.ref.trim() } : {}),
    ...(op.note?.trim() ? { note: op.note.trim() } : {}),
    ...(op.mediaId ? { mediaId: op.mediaId } : {}),
    ...(op.gps ? { gps: op.gps } : {}),
  };
  const res = await evidenceRepo.appendIdempotent(op.projectId, record);
  if (!res.duplicate) job.evidence.push(record);
  return { id: op.id, ok: true, ...(res.duplicate ? { duplicate: true } : {}) };
}

async function insertIssue(issue: Issue): Promise<{ issue: Issue; created: boolean }> {
  const res = await db().from("issues").insert(issuesRepo.toRow(issue)).select("*").single();
  if (isUniqueViolation(res.error)) {
    const existing = await issuesRepo.get(issue.id);
    if (existing) return { issue: existing, created: false };
  }
  return { issue: issuesRepo.fromRow(must(res, "issues insert") as Row), created: true };
}

async function alertTeam(project: Project, issue: Issue): Promise<void> {
  try {
    await notify("team-alert", {
      projectId: project.id,
      data: {
        title: `${issue.blocking ? "Blocking issue" : "Issue"} #${issue.number}: ${issue.title}`,
        ...(issue.detail ? { detail: issue.detail } : {}),
        lines: [
          `${ISSUE_KIND_LABEL[issue.kind]}, ${issue.severity}${issue.blocking ? ", holding the job" : ""}`,
          `Raised by ${issue.raisedBy.name}`,
          ...(issue.mediaIds.length ? [`${issue.mediaIds.length} photo${issue.mediaIds.length === 1 ? "" : "s"} attached`] : []),
        ],
        urgent: issue.blocking || issue.severity === "critical" || issue.kind === "safety",
      },
      discriminator: `issue:${issue.id}`,
    });
  } catch (err) {
    console.error("[field] team alert failed:", err);
  }
}

/** Create a field issue (idempotent on its id) and tell the team; variations also go to the customer. */
async function raiseIssue(
  project: Project,
  staff: StaffMember,
  input: {
    id: string;
    kind: IssueKind;
    title: string;
    detail?: string;
    severity?: Severity;
    blocking?: boolean;
    mediaIds?: string[];
    at: string;
    variation?: { description: string; priceDeltaNetPence: number };
  },
): Promise<{ issue: Issue; created: boolean }> {
  const existing = await issuesRepo.get(input.id);
  if (existing) {
    if (existing.projectId !== project.id) throw new FieldError("That issue belongs to another job.", 409);
    return { issue: existing, created: false };
  }
  const settings = await getSettings();
  const taxCode = settings.tax.vatRegistered ? settings.tax.defaultTaxCode : "outside-scope";
  const issue = createIssue({
    id: input.id,
    projectId: project.id,
    number: await issuesRepo.nextNumber(project.id),
    kind: input.kind,
    title: input.title,
    ...(input.detail ? { detail: input.detail } : {}),
    raisedBy: { kind: "staff", id: staff.id, name: staff.name },
    raisedAt: input.at,
    mediaIds: input.mediaIds ?? [],
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.blocking !== undefined ? { blocking: input.blocking } : {}),
    // Raised during the install: it holds install complete (and, before day 1, ready to install).
    ...(project.install.status !== "not-started" ? { gate: "install-complete" as const } : {}),
    ...(input.variation
      ? {
          variation: {
            description: input.variation.description,
            priceDeltaNetPence: input.variation.priceDeltaNetPence,
            taxRatePct: TAX_CODES[taxCode]?.ratePct ?? 0,
          },
          nextAction: "Customer to approve or decline in their portal. Don't do the work until they approve.",
        }
      : {}),
  });
  const saved = await insertIssue(issue);
  if (saved.created) {
    await audit({ actor: staff, action: "issue.raise", entity: "issue", entityId: issue.id, detail: { projectId: project.id, kind: issue.kind, blocking: issue.blocking } });
    await alertTeam(project, saved.issue);
    if (saved.issue.variation) {
      try {
        // The customer approves or declines in the portal (F1's /api/portal/variations); an accepted
        // variation is billed on its own or picked up by the balance invoice (F5's planInvoices).
        await notify("variation-approval", {
          projectId: project.id,
          data: {
            title: saved.issue.title,
            description: saved.issue.variation!.description,
            totalDeltaPence: saved.issue.variation!.totalDeltaPence,
            issueNumber: saved.issue.number,
          },
          discriminator: saved.issue.id,
        });
      } catch (err) {
        console.error("[field] variation-approval failed:", err);
      }
    }
  }
  return saved;
}

async function syncStatus(ctx: BatchContext, op: Extract<SyncOp, { type: "step-status" }>, project: Project): Promise<SyncResult> {
  const job = await jobFor(ctx, op.projectId, project);
  if (!job) return PERMANENT(op.id, "There's no runsheet for this job yet.");
  const step = job.runsheet.find((s) => s.id === op.stepId);
  if (!step) return PERMANENT(op.id, "That step isn't on this job's runsheet any more.");
  if (job.stepStatuses.some((s) => s.id === op.id)) return { id: op.id, ok: true, duplicate: true };
  const at = captureTime(op.at);
  const gate = canSetOutcome(step, op.outcome, ctx.staff, at, op.reason);
  if (!gate.ok) return PERMANENT(op.id, gate.reason ?? "You can't record that outcome.");
  const refusal = recordingRefusal(project, step);
  if (refusal) return PERMANENT(op.id, refusal);

  // Blocked, or a failed critical step: an issue the office (or tech lead) owns.
  let issueId: string | undefined;
  if (op.outcome === "blocked" || (op.outcome === "fail" && step.critical)) {
    const id = op.issueId && isUuid(op.issueId) ? op.issueId : crypto.randomUUID();
    const what = `${step.title}${step.item ? ` (${step.item})` : ""}`;
    const { issue } = await raiseIssue(project, ctx.staff, {
      id,
      kind: op.outcome === "blocked" ? "blocker" : "defect",
      title: op.outcome === "blocked" ? `Blocked: ${what}` : `Failed: ${what}`,
      detail: op.reason?.trim(),
      ...(op.outcome === "fail" ? { severity: "high" as const, blocking: true } : {}),
      at,
    });
    issueId = issue.id;
  }
  const record: StepStatusRecord = {
    id: op.id,
    stepId: op.stepId,
    outcome: op.outcome,
    ...(op.reason?.trim() ? { reason: op.reason.trim() } : {}),
    at,
    by: ctx.staff.name,
    byStaffId: ctx.staff.id,
    ...(issueId ? { issueId } : {}),
  };
  const saved = await mutateJob(op.projectId, (parts) => {
    if (parts.stepStatuses.some((s) => s.id === op.id)) return null;
    return { ...parts, stepStatuses: [...parts.stepStatuses, record] };
  });
  job.stepStatuses = saved.stepStatuses;
  return { id: op.id, ok: true };
}

async function syncTimeStart(ctx: BatchContext, op: Extract<SyncOp, { type: "time-start" }>): Promise<SyncResult> {
  if (!isUuid(op.id)) return PERMANENT(op.id, "Bad time entry id.");
  const existing = await timeRepo.get(op.id);
  if (existing) return { id: op.id, ok: true, duplicate: true };
  const at = captureTime(op.at);
  // One clock per person: arriving somewhere stops whatever was left running.
  const open = await timeRepo.openForStaff(ctx.staff.id);
  if (open && Date.parse(open.startedAt) <= Date.parse(at)) {
    const minutes = Math.max(0, Math.round((Date.parse(at) - Date.parse(open.startedAt)) / 60_000));
    await timeRepo.update({ ...open, endedAt: at, minutes, note: [open.note, "Closed when the next clock started."].filter(Boolean).join(" ") });
  }
  const entry: TimeEntry = {
    id: op.id,
    projectId: op.projectId,
    staffId: ctx.staff.id,
    staffName: ctx.staff.name,
    kind: op.kind,
    ...(op.dayN ? { dayN: op.dayN } : {}),
    startedAt: at,
    ...(op.note?.trim() ? { note: op.note.trim() } : {}),
  };
  const res = await db().from("time_entries").insert(timeRepo.toRow(entry)).select("id");
  if (isUniqueViolation(res.error)) return { id: op.id, ok: true, duplicate: true };
  must(res, "time insert");
  return { id: op.id, ok: true };
}

async function syncTimeStop(ctx: BatchContext, op: Extract<SyncOp, { type: "time-stop" }>): Promise<SyncResult> {
  const entry = await timeRepo.get(op.entryId);
  // The start may still be in another batch; it's ordered first, so this is rare. Retry later.
  if (!entry) return { id: op.id, ok: false, error: "The clock this stops hasn't synced yet.", permanent: false };
  if (entry.staffId !== ctx.staff.id) return PERMANENT(op.id, "That's someone else's clock.");
  if (entry.endedAt) return { id: op.id, ok: true, duplicate: true };
  const at = captureTime(op.at);
  const end = Date.parse(at) < Date.parse(entry.startedAt) ? entry.startedAt : at;
  const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(entry.startedAt)) / 60_000));
  await timeRepo.update({ ...entry, endedAt: end, minutes });
  return { id: op.id, ok: true };
}

async function syncIssue(ctx: BatchContext, op: Extract<SyncOp, { type: "issue" }>, project: Project): Promise<SyncResult> {
  if (!isUuid(op.id)) return PERMANENT(op.id, "Bad issue id.");
  for (const id of op.mediaIds) {
    const media = await mediaRepo.get(id);
    if (!media || media.projectId !== op.projectId) return PERMANENT(op.id, "A photo on this issue didn't arrive. Raise it again with the photo.");
  }
  const { created } = await raiseIssue(project, ctx.staff, {
    id: op.id,
    kind: op.kind,
    title: op.title,
    ...(op.detail ? { detail: op.detail } : {}),
    severity: op.severity,
    blocking: op.blocking,
    mediaIds: op.mediaIds,
    at: captureTime(op.at),
    ...(op.variation ? { variation: op.variation } : {}),
  });
  return { id: op.id, ok: true, ...(created ? {} : { duplicate: true }) };
}

/**
 * Apply a batch from the phone's outbox, in order. Every op is idempotent
 * (client ids: evidence and time by primary key, outcomes by record id,
 * issues by id), so a retry after a lost response is harmless. A result per
 * op: ok (with `duplicate` when it had already landed), or an error that's
 * `permanent` (the phone shows it and stops retrying) or not (retry later).
 */
export async function processSyncBatch(staff: StaffMember, ops: SyncOp[]): Promise<SyncResult[]> {
  const ctx: BatchContext = { staff, projects: new Map(), jobs: new Map() };
  const results: SyncResult[] = [];
  for (const op of ops) {
    try {
      if (!can(staff, "install.work")) {
        results.push(PERMANENT(op.id, "You don't have install permissions."));
        continue;
      }
      const project = await projectFor(ctx, op.projectId);
      if (!project) {
        results.push(PERMANENT(op.id, "That job isn't one of yours (or it no longer exists)."));
        continue;
      }
      switch (op.type) {
        case "evidence":
          results.push(await syncEvidence(ctx, op, project));
          break;
        case "step-status":
          results.push(await syncStatus(ctx, op, project));
          break;
        case "time-start":
          results.push(await syncTimeStart(ctx, op));
          break;
        case "time-stop":
          results.push(await syncTimeStop(ctx, op));
          break;
        case "issue":
          results.push(await syncIssue(ctx, op, project));
          break;
      }
    } catch (err) {
      if (err instanceof FieldError) results.push({ id: op.id, ok: false, error: err.message, permanent: err.status < 500 && err.status !== 409 });
      else {
        console.error(`[field] sync ${op.type} ${op.id} failed:`, err);
        results.push({ id: op.id, ok: false, error: "The server couldn't save this just now. It'll retry.", permanent: false });
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Gate actions (online only)                                          */
/* ------------------------------------------------------------------ */

function throwDispatch(result: Awaited<ReturnType<typeof dispatch>>): Project {
  if ("error" in result) throw new FieldError(result.error, result.status, result.blockers);
  return result.project;
}

/** The SMS the customer would get, before it's sent: same template, same data. */
export async function onMyWayPreview(projectId: string, staff: StaffMember, etaMinutes: number) {
  const project = await projectForStaff(projectId, staff);
  const settings = await getSettings();
  const ctx = templateContext({ settings, portalUrl: LINK_PLACEHOLDER, project });
  const rendered = renderMessage("installer-on-my-way", ctx, { etaMinutes, at: new Date().toISOString(), name: staff.name });
  const phone = project.customer.phone?.trim();
  return {
    sms: rendered.sms ?? null,
    to: phone ? maskPhone(phone) : null,
    mode: appMode().sms,
    booked: project.booking.status === "booked",
  };
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `ending ${digits.slice(-3)}` : "on file";
}

export type SendStatus = "sent" | "demo" | "queued" | "failed" | "not-sent";

async function messageStatus(event: Parameters<typeof idempotencyKey>[0], projectId: string, discriminator: string, channel: "email" | "sms"): Promise<{ status: SendStatus; error?: string }> {
  const m = await messagesRepo.findByKey(idempotencyKey(event, projectId, discriminator, channel)).catch(() => null);
  if (!m) return { status: "not-sent" };
  if (m.status === "sent") return { status: "sent" };
  if (m.status === "demo") return { status: "demo" };
  if (m.status === "queued") return { status: "queued" };
  return { status: m.status === "failed" ? "failed" : "not-sent", ...(m.error ? { error: m.error } : {}) };
}

/** On my way: records it on the project (which sends the SMS through the outbox) and reports what really happened. */
export async function sendOnMyWay(projectId: string, staff: StaffMember, etaMinutes: number) {
  await projectForStaff(projectId, staff);
  const project = throwDispatch(await dispatch(projectId, { type: "installer-on-my-way", etaMinutes, by: staff.name }, staff));
  const at = project.install.onMyWay?.at ?? "";
  const sms = await messageStatus("installer-on-my-way", projectId, `${at.slice(0, 10) || "-"}:${Math.round(etaMinutes)}`, "sms");
  return { ...sms, hasPhone: Boolean(project.customer.phone?.trim()) };
}

/** Start install day n (day 1 runs the ready-to-install gate in the reducer). */
export async function startDay(projectId: string, staff: StaffMember, n: number, gps?: { lat: number; lng: number }): Promise<Project> {
  if (!can(staff, "install.work")) throw new FieldError("You don't have install permissions.", 403);
  await projectForStaff(projectId, staff);
  const project = throwDispatch(await dispatch(projectId, { type: "install-day-started", n, by: staff.name }, staff));
  if (n === 1 && gps) {
    // The arrival fix, on the runsheet's arrival slot.
    const job = await installJobsRepo.loadForProject(projectId, project);
    const spec = job?.runsheet.flatMap((s) => s.evidence).find((e) => e.role === "arrival-gps");
    if (spec && !latestEvidence(job!, spec.id)) {
      await evidenceRepo.appendIdempotent(projectId, { id: `gps-${projectId}-day1`, specId: spec.id, at: nowIso(), by: staff.name, byStaffId: staff.id, gps });
    }
  }
  return project;
}

/** Every photo attached to an issue on this project. */
async function issuePhotoIds(projectId: string): Promise<Set<string>> {
  return new Set((await issuesRepo.listForProject(projectId)).flatMap((i) => i.mediaIds ?? []));
}

/** Install media from one day, newest first, with URLs: the photos the end-of-day update can share. */
export async function dayPhotos(projectId: string, staff: StaffMember, n: number) {
  const project = await projectForStaff(projectId, staff);
  const day = project.install.days.find((d) => d.n === n);
  const date = day?.date ?? project.booking.dates[n - 1];
  // Photos of an issue (damage, a safety worry, a question for the office) aren't the day's finished
  // work: the customer sees an issue only through the issue itself, never by being picked here.
  const onIssues = await issuePhotoIds(projectId);
  const items = (await mediaRepo.listForProject(projectId)).filter(
    // The London day the photo was taken on (a photo at 00:30 BST is that day's, not the UTC day before).
    (m) =>
      (m.source === "install" || m.source === "handover") &&
      m.contentType.startsWith("image/") &&
      !onIssues.has(m.id) &&
      (!date || londonDateOf(m.takenAt) === date),
  );
  const urls = await signedMediaUrls(items);
  return items.map((m) => ({ id: m.id, url: urls.get(m.id) ?? null, caption: m.caption, tag: m.tag, customerVisible: m.customerVisible, takenAt: m.takenAt }));
}

/**
 * End the day: share the picked photos with the customer, record the day's
 * summary and customer update (which emails it), save the learning answers
 * and stop the clock.
 */
export async function endDay(
  projectId: string,
  staff: StaffMember,
  input: { n: number; summary: string; customerText: string; mediaIds: string[]; learnings: { promptId: string; answer: string }[]; clockEntryId?: string },
) {
  if (!can(staff, "install.work")) throw new FieldError("You don't have install permissions.", 403);
  await projectForStaff(projectId, staff);
  const mediaIds = [...new Set(input.mediaIds)].slice(0, 4);
  const media = await mediaRepo.listByIds(mediaIds);
  if (media.length !== mediaIds.length || media.some((m) => m.projectId !== projectId)) throw new FieldError("One of the photos isn't on this job.", 400);
  if (mediaIds.length) {
    const onIssues = await issuePhotoIds(projectId);
    if (mediaIds.some((id) => onIssues.has(id))) throw new FieldError("One of the photos is on an issue, so it isn't shared in the day's update. Pick another.", 400);
  }
  // Shared first: the update must never point at photos the customer can't open.
  for (const m of media) if (!m.customerVisible) await mediaRepo.update({ ...m, customerVisible: true });
  const text = input.customerText.trim();
  const project = throwDispatch(
    await dispatch(
      projectId,
      { type: "install-day-ended", n: input.n, summary: input.summary.trim() || `Day ${input.n} done.`, ...(text ? { customerUpdate: { text, mediaIds } } : {}) },
      staff,
    ),
  );
  const learningsSaved = input.learnings.length ? await insertLearnings(projectId, staff, input.n, input.learnings) : 0;
  if (input.clockEntryId && isUuid(input.clockEntryId)) {
    const entry = await timeRepo.get(input.clockEntryId);
    if (entry && entry.staffId === staff.id && !entry.endedAt) {
      const end = nowIso();
      await timeRepo.update({ ...entry, endedAt: end, minutes: Math.max(0, Math.round((Date.parse(end) - Date.parse(entry.startedAt)) / 60_000)) });
    }
  }
  const email = text ? await messageStatus("install-day-update", projectId, `day-${input.n}`, "email") : { status: "not-sent" as SendStatus };
  return { project, email, learningsSaved };
}

async function insertLearnings(projectId: string, staff: StaffMember, dayN: number, raw: { promptId: string; answer: string }[]): Promise<number> {
  const answers = raw
    .filter((a) => LEARNING_PROMPTS.some((p) => p.id === a.promptId) && a.answer.trim())
    .map((a) => ({ promptId: a.promptId, answer: a.answer.trim().slice(0, 2000) }));
  if (!answers.length) return 0;
  const learning: Learning = {
    id: crypto.randomUUID(),
    projectId,
    dayN,
    stage: "install",
    author: { staffId: staff.id, name: staff.name },
    answers,
    tags: [],
    status: "open",
    createdAt: nowIso(),
  };
  await learningsRepo.insert(learning);
  return answers.length;
}

/** The two-minute learning prompts at the end of a day, saved for the pilot review. */
export async function saveLearnings(projectId: string, staff: StaffMember, dayN: number, answers: { promptId: string; answer: string }[]) {
  if (!can(staff, "install.work")) throw new FieldError("You don't have install permissions.", 403);
  await projectForStaff(projectId, staff);
  return { saved: await insertLearnings(projectId, staff, dayN, answers) };
}

/** The end-of-day email the customer would get (the template, with today's words). */
export async function dayUpdatePreview(projectId: string, staff: StaffMember, n: number, text: string, photoCount: number) {
  const project = await projectForStaff(projectId, staff);
  const settings = await getSettings();
  const ctx = templateContext({ settings, portalUrl: `${appUrl()}/p/${projectId}#install`, project });
  const next = project.install.days.find((d) => d.n === n + 1)?.date ?? project.booking.dates[n];
  // The same signer the real email gets (comms crewLead): the tech lead, else whoever ends the day.
  const lead = crewLead(project, { staffId: staff.id, name: staff.name });
  const r = renderMessage("install-day-update", ctx, {
    n,
    totalDays: project.booking.installDays || project.booking.dates.length || undefined,
    text,
    photoCount,
    ...(next ? { nextDate: next } : {}),
    ...(lead ? { by: lead.name } : {}),
    ...(project.install.status === "complete" ? { complete: { handoverPack: Boolean(project.handover.packDocumentId) } } : {}),
  });
  return { subject: r.subject, text: r.text, to: project.customer.email ? "the customer's email" : null, mode: appMode().email };
}

/* ---------------- tech lead: exceptions, targets, commissioning ---------------- */

export async function reviewException(
  projectId: string,
  staff: StaffMember,
  input: { specId: string; evidenceId?: string; resolution: ExceptionReview["resolution"]; reason: string },
): Promise<InstallJobV2> {
  const project = await projectForStaff(projectId, staff);
  const today = londonToday();
  const gate = canReviewExceptions(staff, today);
  if (!gate.ok) throw new FieldError(gate.reason ?? "Only the tech lead reviews exceptions.", 403);
  if (input.reason.trim().length < 3) throw new FieldError("Give the reason: it goes on the record.", 400);
  const job = await installJobsRepo.loadForProject(projectId, project);
  if (!job) throw new FieldError("There's no runsheet for this job yet.", 409);
  if (job.commissioning) throw new FieldError("Commissioning is signed: the readings are closed.", 409);
  const spec = job.runsheet.flatMap((s) => s.evidence).find((e) => e.id === input.specId);
  if (!spec) throw new FieldError("That reading isn't on this runsheet.", 404);
  const record = latestEvidence(job, spec.id);
  if (!record) throw new FieldError("There's no reading to review.", 409);
  if (input.evidenceId && record.id && input.evidenceId !== record.id) {
    throw new FieldError("A newer reading has come in since you opened this. Check it again.", 409);
  }
  const review: ExceptionReview = {
    specId: spec.id,
    ...(record.id ? { evidenceId: record.id } : {}),
    resolution: input.resolution,
    reason: input.reason.trim(),
    by: staff.name,
    byStaffId: staff.id,
    at: nowIso(),
  };
  const saved = await mutateJob(projectId, (parts) => ({ ...parts, exceptionReviews: [...parts.exceptionReviews, review] }));
  await audit({ actor: staff, action: "install.exception-review", entity: "project", entityId: projectId, detail: { specId: spec.id, resolution: input.resolution } });
  return asV2(saved, withExceptionReview(job, review));
}

export async function setTarget(
  projectId: string,
  staff: StaffMember,
  input: { key: TargetKey; min?: number; max?: number; note?: string },
): Promise<InstallJobV2> {
  const project = await projectForStaff(projectId, staff);
  const today = londonToday();
  const gate = canReviewExceptions(staff, today);
  if (!gate.ok) throw new FieldError("Only the tech lead sets the job's targets.", 403);
  const job = await installJobsRepo.loadForProject(projectId, project);
  if (!job) throw new FieldError("There's no runsheet for this job yet.", 409);
  if (job.commissioning) throw new FieldError("Commissioning is signed: the targets are closed.", 409);
  const problem = targetError(input.key, input.min, input.max);
  if (problem) throw new FieldError(problem, 400);
  const saved = await mutateJob(projectId, (parts) => ({ ...parts, runsheet: setJobTarget(parts.runsheet, input, staff.name, nowIso()) }));
  await audit({ actor: staff, action: "install.target", entity: "project", entityId: projectId, detail: input });
  return asV2(saved, job);
}

function header(settings: Awaited<ReturnType<typeof getSettings>>, project: Project, at: string) {
  return { company: documentCompany(settings), customer: documentCustomer(project), issuedAt: at };
}

/** Gate codes the commissioning screen already explains from the runsheet itself. */
const RUNSHEET_GATE_CODES = new Set(["install-not-started", "runsheet-missing", "runsheet-incomplete", "exceptions-open", "install-not-complete", "commissioning-unsigned"]);

/**
 * What else holds commissioning, beyond the runsheet: open blocking issues
 * and compliance items. Shown before the tech lead signs, so the project
 * gate's answer is no surprise. A preview only: signing re-checks.
 */
export async function commissioningHolds(projectId: string, staff: StaffMember): Promise<Blocker[]> {
  try {
    const project = await projectForStaff(projectId, staff);
    const ctx = await buildReadinessContext(project, staff);
    const seen = new Set<string>();
    // Only the install-complete gate: the commissioned gate's own items
    // (the commissioning record itself) are what signing produces.
    return (["install-complete"] as const)
      .filter((g) => !isGatePassed(project, g))
      .flatMap((g) => blockersFor(project, ctx, g))
      .filter((b) => {
        if (b.severity !== "block" || RUNSHEET_GATE_CODES.has(b.code) || seen.has(b.code)) return false;
        seen.add(b.code);
        return true;
      });
  } catch (err) {
    // A preview only: signing re-checks every gate, so a failed preview mustn't stop the page.
    console.error(`[field] commissioning preview for ${projectId} failed:`, err);
    return [];
  }
}

/**
 * The tech lead signs commissioning: the record goes on the job, the
 * install is completed (when the runsheet is), commissioning is signed on
 * the project, and the commissioning certificate is issued. If the project
 * refuses either step, the record is taken back off, so nothing claims to
 * be signed that isn't.
 */
export async function signCommissioning(projectId: string, staff: StaffMember, notes?: string) {
  const project = await projectForStaff(projectId, staff);
  const now = nowIso();
  const today = londonToday();
  if (!can(staff, "commissioning.sign")) throw new FieldError("You don't have permission to sign commissioning.", 403);
  const job = await installJobsRepo.loadForProject(projectId, project);
  if (!job) throw new FieldError("There's no runsheet for this job yet.", 409);
  const errors = commissioningSignErrors(job, staff, today);
  if (errors.length) throw new FieldError(errors.join(" "), 409);
  const record: CommissioningRecord = buildCommissioningRecord(job, staff, now, notes);
  await mutateJob(projectId, (parts) => (parts.commissioning ? null : { ...parts, commissioning: record, qa: { status: "signed-off", reviewedBy: staff.name } }));
  const undo = () =>
    mutateJob(projectId, (parts) =>
      parts.commissioning?.at === record.at ? { ...parts, commissioning: undefined, qa: { status: "in-progress" } } : null,
    ).catch((err) => console.error("[field] couldn't take back the commissioning record:", err));

  let p = project;
  if (p.install.status !== "complete") {
    const done = await dispatch(projectId, { type: "install-completed" }, staff);
    if ("error" in done) {
      await undo();
      throw new FieldError(done.error, done.status, done.blockers);
    }
    p = done.project;
  }
  const signed = await dispatch(projectId, { type: "commissioning-signed", by: staff.name }, staff);
  if ("error" in signed) {
    await undo();
    throw new FieldError(signed.error, signed.status, signed.blockers);
  }
  p = signed.project;

  const settings = await getSettings();
  const fullJob = { ...job, commissioning: record };
  let certificate: { id: string; ref: string } | null = null;
  try {
    const doc = await createDocument(
      projectId,
      "commissioning-certificate",
      { ...header(settings, p, now), commissioning: record, equipment: equipmentFromJob(fullJob) },
      { title: "Commissioning certificate", customerVisible: true, createdBy: staff.name },
    );
    certificate = { id: doc.id, ref: doc.ref };
  } catch (err) {
    console.error("[field] commissioning certificate failed:", err);
  }
  return { project: p, record, certificate };
}

/* ---------------- handover ---------------- */

/** The care guide: one page, how to run it. Plain words, nothing that needs a manual figure we don't have. */
export const CARE_GUIDE: string[] = [
  "Set it and leave it: pick a comfortable temperature (around 21°C for heating, 24°C for cooling) and let it hold it. Switching on and off uses more.",
  "Use heating mode in winter: it's a heat pump, and it heats efficiently as well as cooling.",
  "Clean the filters regularly in heavy use: they lift out from the front panel. Rinse, dry, refit. Check the manual for how often.",
  "A puff of steam from the outdoor unit in winter is normal: it's defrosting. A few drips outside are normal too.",
  "Keep about 30 cm clear around the outdoor unit and don't cover it.",
  "If something's not right, switch it off at the remote and tell us: don't open the units.",
];

/** How many as-built photos the pack carries (finished first, then progress). */
export const AS_BUILT_MAX = 12;

export interface HandoverDraft {
  snapshot: HandoverPackSnapshot;
  missing: string[];
  certificate: DocumentLink | null;
}

/** What the handover pack would say right now, and what's still missing before it can be published. */
export async function handoverDraft(projectId: string, staff: StaffMember): Promise<HandoverDraft> {
  const project = await projectForStaff(projectId, staff);
  const job = await installJobsRepo.loadForProject(projectId, project);
  const settings = await getSettings();
  const now = nowIso();
  const missing: string[] = [];
  if (project.handover.status === "pending") missing.push("Commissioning isn't signed yet.");
  if (!job) missing.push("There's no runsheet for this job.");
  const completedOn = (project.install.completedAt ?? now).slice(0, 10);
  const deadlines = handoverDeadlines(completedOn);
  const cert = await currentDocument(projectId, "commissioning-certificate").catch(() => null);
  const docs = (await listDocuments(projectId).catch(() => [])).filter(
    (d) => d.status === "final" && d.customerVisible && (d.kind === "contract" || d.kind === "commissioning-certificate" || d.kind === "variation"),
  );
  const links: DocumentLink[] = docs.map((d) => ({ kind: d.kind, ref: d.ref, id: d.id, title: d.title }));
  const equipment = job ? equipmentFromJob(job) : [];
  if (equipment.some((e) => !e.serial)) missing.push("Some serial numbers weren't captured at the kit check.");
  const fgas = job ? fgasFromJob(job) : [];
  if (fgas.some((f) => !f.record)) missing.push("The F-gas charge record isn't complete.");
  const progress = job ? runsheetProgress(job) : null;
  const catalogue = await catalogueRepo.list().catch(() => [] as CatalogueItem[]);
  const outdoorModels = new Set(equipment.filter((e) => /outdoor/i.test(e.room)).map((e) => e.model));
  const notes = catalogue.filter((c) => c.kind === "outdoor" && c.model && outdoorModels.has(c.model) && c.warranty).map((c) => `${c.model}: ${c.warranty}`);
  const warrantyText = [settings.warranty.manufacturerSummary, ...notes].filter(Boolean).join(" ") || null;
  const dueOn = project.handover.warrantyDueOn ?? (/daikin/i.test(notes.join(" ")) ? addDaysIso(completedOn, 90) : addDaysIso(completedOn, 30));
  const crewLead = project.booking.crew.find((c) => c.role === "tech-lead") ?? project.booking.crew.find((c) => !c.external);
  // The as-built photos: what the customer can already see of the finished job, frozen into the pack.
  const asBuilt = (await mediaRepo.listForProject(projectId, { customerVisibleOnly: true }).catch(() => [] as MediaItem[]))
    .filter((m) => m.tag === "completed" || m.tag === "progress")
    .sort((a, b) => (a.tag === b.tag ? 0 : a.tag === "completed" ? -1 : 1))
    .slice(0, AS_BUILT_MAX)
    .map((m) => ({ mediaId: m.id, ...(m.caption ? { caption: m.caption } : {}) }));
  if (asBuilt.length === 0) missing.push("There are no as-built photos the customer can see (finished or progress photos).");
  const phone = isPlaceholderPhone(settings.company.phone) ? undefined : settings.company.phone;
  const snapshot: HandoverPackSnapshot = {
    ...header(settings, project, now),
    completedOn,
    equipment,
    commissioning: job?.commissioning ?? { signedBy: { staffId: "", name: "", qualificationRef: "" }, at: "", results: job ? commissioningFromJob(job) : [] },
    documents: links,
    warranty: { text: warrantyText, registered: project.handover.warrantyRegistered, ...(project.handover.warrantyRegistered ? {} : { dueOn }) },
    electricalCert: { status: project.handover.electricalCert, dueBy: deadlines.electricalCertDueBy },
    maintenanceInfo: { dueBy: deadlines.maintenanceInfoDueBy, provided: true },
    fgas: fgas.filter((f) => f.record).map((f) => f.record!),
    care: CARE_GUIDE,
    contacts: [
      ...(crewLead ? [{ label: "Your technical lead", name: crewLead.name }] : []),
      { label: settings.company.tradingName, ...(phone ? { phone } : {}), email: settings.company.email },
      { label: "Report a problem", ...(phone ? { phone } : {}), email: settings.company.email },
    ],
    asBuilt,
  };
  if (progress && !progress.walkthroughDone) missing.push("The customer walkthrough isn't ticked off yet.");
  return { snapshot, missing, certificate: cert ? { kind: "commissioning-certificate", ref: cert.ref, id: cert.id, title: cert.title } : null };
}

/** Publish the handover pack (a new version supersedes the old) and record it on the project, which emails the customer. */
export async function publishHandoverPack(projectId: string, staff: StaffMember) {
  if (!can(staff, "install.work")) throw new FieldError("You don't have install permissions.", 403);
  const draft = await handoverDraft(projectId, staff);
  const blocking = draft.missing.filter((m) => /Commissioning|runsheet/.test(m));
  if (blocking.length) throw new FieldError(blocking.join(" "), 409);
  const doc = await createDocument(projectId, "handover-pack", draft.snapshot, { title: "Your handover pack", customerVisible: true, createdBy: staff.name });
  const project = throwDispatch(await dispatch(projectId, { type: "handover-pack-published", documentId: doc.id }, staff));
  const email = await messageStatus("handover-ready", projectId, doc.id, "email");
  return { project, document: { id: doc.id, ref: doc.ref }, email };
}

/**
 * The customer signs off on the installer's phone: "All good", or "There's
 * a snag" with each snag recorded as a customer-visible issue first, so the
 * count on the sign-off is the real number of records.
 */
export async function signHandover(
  projectId: string,
  staff: StaffMember,
  input: { name: string; outcome: "all-good" | "snags"; snags: { id: string; text: string }[]; signatureMediaId?: string },
) {
  if (!can(staff, "install.work")) throw new FieldError("You don't have install permissions.", 403);
  const project = await projectForStaff(projectId, staff);
  if (input.signatureMediaId) {
    const sig = await mediaRepo.get(input.signatureMediaId);
    if (!sig || sig.projectId !== projectId) throw new FieldError("The signature didn't upload. Ask them to sign again.", 400);
  }
  const snags = input.outcome === "snags" ? input.snags.filter((s) => s.text.trim()) : [];
  if (input.outcome === "snags" && snags.length === 0) throw new FieldError("Write down at least one snag, or sign as all good.", 400);
  const now = nowIso();
  for (const s of snags) {
    if (!isUuid(s.id)) throw new FieldError("Bad snag id.", 400);
    await raiseIssue(project, staff, {
      id: s.id,
      kind: "snag",
      title: s.text.trim().slice(0, 140),
      ...(s.text.trim().length > 140 ? { detail: s.text.trim() } : {}),
      at: now,
    }).then(async ({ issue, created }) => {
      // Raised with the customer, in their words.
      if (created) await issuesRepo.update({ ...issue, raisedBy: { kind: "customer", name: input.name.trim() }, history: issue.history.map((h, i) => (i === 0 ? { ...h, by: input.name.trim(), note: `Raised at handover (recorded by ${staff.name}).` } : h)) });
    });
  }
  const signed = throwDispatch(
    await dispatch(projectId, { type: "handover-signed", name: input.name, outcome: input.outcome, snagCount: snags.length }, staff),
  );
  if (input.signatureMediaId) {
    await audit({ actor: staff, action: "handover.signature", entity: "project", entityId: projectId, detail: { mediaId: input.signatureMediaId, name: input.name.trim() } });
  }
  return { project: signed, snagCount: snags.length };
}

/* ------------------------------------------------------------------ */
/* Issues: mine                                                        */
/* ------------------------------------------------------------------ */

/** Open issues on my jobs and the ones I raised, newest first, across projects. */
export async function listMyIssues(staff: StaffMember): Promise<FieldIssue[]> {
  if (!getServiceClient()) return [];
  const open = await issuesRepo.listOpen();
  const out: FieldIssue[] = [];
  const projects = new Map<string, Project | null>();
  for (const i of open) {
    if (!projects.has(i.projectId)) projects.set(i.projectId, await loadProject(i.projectId).catch(() => null));
    const p = projects.get(i.projectId);
    if (!p) continue;
    const mineByJob = isAssigned(staff.id, p);
    const raised = i.raisedBy.id === staff.id;
    const owned = i.ownerStaffId === staff.id;
    if (!(mineByJob || raised || owned)) continue;
    if (!staffCanAccessProject(staff, p)) continue;
    out.push(toFieldIssue(i, staff, new Map(), p.customer.name));
  }
  const media = await mediaRepo.listByIds(open.filter((i) => out.some((o) => o.id === i.id)).flatMap((i) => i.mediaIds));
  const urls = await signedMediaUrls(media);
  return out.map((o) => ({ ...o, mediaUrls: (open.find((i) => i.id === o.id)?.mediaIds ?? []).map((id) => urls.get(id)).filter((u): u is string => Boolean(u)) }));
}

/** An installer's own update on an issue: in progress or resolved, with a note. Nothing else from the field. */
export async function updateIssueFromField(staff: StaffMember, issueId: string, to: "in-progress" | "resolved", note: string): Promise<FieldIssue> {
  const issue = await issuesRepo.get(issueId);
  if (!issue) throw new FieldError("Not found", 404);
  const project = await projectForStaff(issue.projectId, staff);
  if (!can(staff, "install.work")) throw new FieldError("You don't have install permissions.", 403);
  if (!isOpen(issue)) throw new FieldError("That issue is already closed.", 409);
  if (issue.kind === "variation") throw new FieldError("Variations are decided by the customer, not from the field.", 409);
  if (to === "resolved" && note.trim().length < 3) throw new FieldError("Say what was done: it goes on the record.", 400);
  const next = transitionIssue(issue, to, staff.name, note, nowIso());
  const saved = await issuesRepo.update(next);
  await audit({ actor: staff, action: `issue.${to}`, entity: "issue", entityId: issue.id, detail: { projectId: project.id } });
  return toFieldIssue(saved, staff, new Map(), project.customer.name);
}

/** A friendly date for messages from this module. */
export const fieldDate = (iso: string) => fmtDate(iso);
