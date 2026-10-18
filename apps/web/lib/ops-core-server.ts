import {
  COMMS_EVENTS,
  ISSUE_KIND_LABEL,
  defaultsForKind,
  depositPence,
  diffSelfSurvey,
  isOpen,
  kitSummary,
  migrateProject,
  outstandingPence,
  pilotMetrics,
  readiness,
  runsheetProgress,
  schedule2Missing,
  surveyCompleteness,
  transitionIssue,
  type Blocker,
  type CommsEventId,
  type ComplianceItem,
  type DesignRecord,
  type InstallJobV2,
  type Invoice,
  type Issue,
  type IssueKind,
  type Learning,
  type MediaItem,
  type Payment,
  type PilotMetrics,
  type PilotSettings,
  type Project,
  type ProposalRecord,
  type PurchaseOrder,
  type ReadinessContext,
  type SelfSurveyDiffRow,
  type StaffMember,
  type StaffRole,
  type Survey,
  type SurveyRecord,
  type TimeEntry,
} from "@aircon/domain";
import { cardFromProject, type BoardCard } from "@/components/ops/board/board-model";
import { demoLoginAllowed } from "./auth/access";
import { sessionSecretUsable } from "./auth/session";
import { dispatchDue, notify } from "./comms/outbox";
import { emailConfigured } from "./email";
import { isDemoSeedId } from "./demo-seed/ids";
import { healthReport } from "./health";
import { MEDIA_CONTENT_TYPES, MEDIA_MAX_BYTES, safeMediaName, signedMediaUrls } from "./media-server";
import { DAILY_JOB_IDS, DONE_STATUSES, dailyJobsFor, emptySummary, type DailyJob, type DailyOpsSummary } from "./ops-core-schedule";
import { dispatch, londonToday } from "./project-service";
import { smsConfigured } from "./providers/sms";
import { db, isUuid, must, type Row } from "./repo/base";
import * as catalogueRepo from "./repo/catalogue";
import * as complianceRepo from "./repo/compliance";
import * as designsRepo from "./repo/designs";
import * as evidenceRepo from "./repo/evidence";
import * as installJobsRepo from "./repo/installJobs";
import * as invoicesRepo from "./repo/invoices";
import * as issuesRepo from "./repo/issues";
import * as learningsRepo from "./repo/learnings";
import * as mediaRepo from "./repo/media";
import * as paymentsRepo from "./repo/payments";
import * as proposalsRepo from "./repo/proposals";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import * as staffRepo from "./repo/staff";
import * as surveysRepo from "./repo/surveys";
import * as timeRepo from "./repo/time";
import { getSettings } from "./settings-server";
import { MEDIA_BUCKET, dataBackend, getServiceClient } from "./supabase-server";

/**
 * Ops core on the server (feature F7): the board, the pilot dashboard, the
 * daily-ops cron, the digest's numbers, the go-live checks and staff media.
 * Pages call these after their own guard (requireStaff); nothing here checks
 * permissions.
 *
 * The board needs readiness for every project, and the per-project context
 * (project-service buildReadinessContext) costs about eleven queries. Fifty
 * projects would be 550 round trips, so the board reads each table once for
 * all projects and builds the same context in memory (`contextFromRecords`,
 * which mirrors buildReadinessContext rule for rule). The command centre and
 * every action still use the real thing, so what the page enforces is what
 * the reducer enforces.
 */

/* ------------------------------------------------------------------ */
/* Batched reads                                                       */
/* ------------------------------------------------------------------ */

const CHUNK = 100;

/** Rows of a table whose `column` is one of `ids`, in chunks (PostgREST URLs have limits). */
async function rowsWhereIn(table: string, column: string, ids: string[], select = "*"): Promise<Row[]> {
  const wanted = [...new Set(ids.filter(isUuid))];
  const out: Row[] = [];
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const res = await db().from(table).select(select).in(column, wanted.slice(i, i + CHUNK));
    out.push(...((must(res as { data: Row[] | null; error: { message: string } | null }, `${table} batch`) ?? []) as Row[]));
  }
  return out;
}

function groupBy<T extends { projectId: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(item.projectId, [...(out.get(item.projectId) ?? []), item]);
  return out;
}

/** The highest version per project. */
function latestBy<T extends { projectId: string; version: number }>(items: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const item of items) {
    const prev = out.get(item.projectId);
    if (!prev || item.version > prev.version) out.set(item.projectId, item);
  }
  return out;
}

export interface ProjectRecords {
  surveys: Map<string, SurveyRecord>;
  designs: Map<string, DesignRecord>;
  proposals: Map<string, ProposalRecord>;
  compliance: Map<string, ComplianceItem[]>;
  purchaseOrders: Map<string, PurchaseOrder[]>;
  issues: Map<string, Issue[]>;
  jobs: Map<string, installJobsRepo.InstallJobParts>;
  evidence: Map<string, evidenceRepo.StoredEvidence[]>;
  invoices: Map<string, Invoice[]>;
  payments: Map<string, Payment[]>;
  staff: Map<string, StaffMember>;
}

/** Everything readiness needs, for many projects, one query per table. */
export async function loadProjectRecords(ids: string[]): Promise<ProjectRecords> {
  const [surveys, designs, proposals, compliance, pos, issues, jobs, invoices, payments, staff] = await Promise.all([
    rowsWhereIn("surveys", "project_id", ids).then((r) => r.map(surveysRepo.fromRow)),
    rowsWhereIn("designs", "project_id", ids).then((r) => r.map(designsRepo.fromRow)),
    rowsWhereIn("proposals", "project_id", ids).then((r) => r.map(proposalsRepo.fromRow)),
    rowsWhereIn("compliance_items", "project_id", ids).then((r) => r.map(complianceRepo.fromRow)),
    rowsWhereIn("purchase_orders", "project_id", ids).then((r) => r.map(purchaseOrdersRepo.fromRow)),
    rowsWhereIn("issues", "project_id", ids).then((r) => r.map(issuesRepo.fromRow)),
    rowsWhereIn("install_jobs", "project_id", ids).then((r) => r.map(installJobsRepo.fromRow)),
    rowsWhereIn("invoices", "project_id", ids).then((r) => r.map(invoicesRepo.fromRow)),
    rowsWhereIn("payments", "project_id", ids).then((r) => r.map(paymentsRepo.fromRow)),
    staffRepo.list(),
  ]);
  const jobIds = jobs.map((j) => j.projectId);
  const evidence = jobIds.length ? (await rowsWhereIn("install_evidence", "project_id", jobIds)).map(evidenceRepo.fromRow) : [];
  evidence.sort((a, b) => a.at.localeCompare(b.at));
  return {
    surveys: latestBy(surveys),
    designs: latestBy(designs),
    proposals: latestBy(proposals),
    compliance: groupBy(compliance),
    purchaseOrders: groupBy(pos),
    issues: groupBy(issues.sort((a, b) => a.number - b.number)),
    jobs: new Map(jobs.map((j) => [j.projectId, j])),
    evidence: groupBy(evidence),
    invoices: groupBy(invoices),
    payments: groupBy(payments),
    staff: new Map(staff.map((s) => [s.id, s])),
  };
}

/** A stub's "not implemented" is expected and quiet; anything else is logged. Mirrors project-service. */
function attempt<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith("not implemented")) console.error(`[ops-core] ${label} failed:`, err);
    return undefined;
  }
}

/** Is a domain function a feature hasn't built yet still a stub? (Probe with harmless input.) */
export function stubbed(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof Error && err.message.startsWith("not implemented");
  }
}

const PROBE_ISSUE: Issue = {
  id: "probe",
  projectId: "probe",
  number: 0,
  kind: "clarification",
  title: "probe",
  severity: "low",
  status: "open",
  blocking: false,
  ownerRole: "ops",
  raisedBy: { kind: "system", name: "probe" },
  raisedAt: "1970-01-01T00:00:00.000Z",
  mediaIds: [],
  customerVisible: false,
  history: [],
};

/** Can issues change status yet? (transitionIssue is the field module's, F6.) */
export function issueTransitionsReady(): boolean {
  // INTEGRATION(f6): true once transitionIssue is implemented; the status buttons then appear.
  return !stubbed(() => transitionIssue(PROBE_ISSUE, "in-progress", "probe", "", new Date().toISOString()));
}

/** The domain's defaults per issue kind, where F6 has built them ({} until then). */
export function issueKindDefaults(): Partial<Record<IssueKind, ReturnType<typeof defaultsForKind>>> {
  const out: Partial<Record<IssueKind, ReturnType<typeof defaultsForKind>>> = {};
  for (const k of Object.keys(ISSUE_KIND_LABEL) as IssueKind[]) {
    try {
      out[k] = defaultsForKind(k);
    } catch {
      // INTEGRATION(f6): defaultsForKind prefills the raise-issue form once implemented.
    }
  }
  return out;
}

function leadEngineer(project: Project): string {
  const crew = project.booking.crew;
  return (crew.find((m) => m.role === "tech-lead") ?? crew[0])?.name ?? "";
}

/** The full install job the domain functions take, from the batched parts. */
function jobFor(project: Project, rec: ProjectRecords): InstallJobV2 | null {
  const parts = rec.jobs.get(project.id);
  if (!parts) return null;
  return {
    ...parts,
    customer: project.customer.name,
    postcode: project.customer.postcode,
    engineer: leadEngineer(project),
    scheduledOn: project.booking.startDate ?? "",
    evidence: (rec.evidence.get(project.id) ?? []).map(({ projectId: _p, ...e }) => e),
  };
}

/**
 * The readiness context from records already in memory. Rule for rule the
 * same as project-service's buildReadinessContext; keep them in step.
 */
export function contextFromRecords(
  project: Project,
  rec: ProjectRecords,
  settings: PilotSettings,
  today: string,
  actor?: StaffMember,
): ReadinessContext {
  const id = project.id;
  const compliance = rec.compliance.get(id) ?? [];
  const issues = rec.issues.get(id) ?? [];
  const job = jobFor(project, rec);
  const ctx: ReadinessContext = {
    today,
    settings,
    ...(actor ? { actor } : {}),
    compliance: compliance.map((c) => ({ key: c.key, label: c.label, status: c.status, statutory: c.statutory, gate: c.gate })),
    crew: project.booking.crew.map((m) => rec.staff.get(m.staffId)).filter((s): s is StaffMember => Boolean(s)),
    openIssues: issues.filter(isOpen).map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      severity: i.severity,
      blocking: i.blocking,
      ...(i.gate ? { gate: i.gate } : {}),
    })),
    commissioning: job?.commissioning ? { signed: true, signedBy: job.commissioning.signedBy.name } : { signed: false },
  };
  const survey = rec.surveys.get(id);
  if (survey) {
    ctx.surveyCompleteness = attempt("surveyCompleteness", () => {
      const c = surveyCompleteness(survey.data);
      return { pct: c.pct, missing: c.missing.map((m) => `${m.section}: ${m.item}`) };
    }) ?? { pct: 0, missing: ["the completeness check isn't available yet"] };
  }
  const design = rec.designs.get(id);
  if (design) {
    const errors = (design.variants ?? []).flatMap((v) => (v.systems ?? []).flatMap((s) => s.compatibility?.errors ?? []));
    ctx.design = { status: design.status, ...(design.approval ? { approvedBy: design.approval.name } : {}), compatibilityErrors: [...new Set(errors)] };
  }
  const proposal = rec.proposals.get(id);
  if (proposal) {
    ctx.proposalCheck = {
      belowMinMargin: (proposal.options ?? []).some((o) => o.pricing?.belowMinMargin === true),
      marginOverride: Boolean(proposal.marginOverride),
      taxConfirmed: !settings.tax.vatRegistered || settings.tax.accountantConfirmed,
      taxOverride: Boolean(proposal.taxOverride),
      expired: Boolean(proposal.validUntil) && proposal.validUntil.slice(0, 10) < today,
    };
  }
  const pos = rec.purchaseOrders.get(id) ?? [];
  if (pos.length > 0) {
    const kit = attempt("kitSummary", () => kitSummary(pos));
    if (kit) ctx.kit = { requiredLines: kit.requiredLines, deliveredLines: kit.deliveredLines, inspectedLines: kit.inspectedLines, damaged: kit.damaged };
  }
  if (job) {
    const progress = attempt("runsheetProgress", () => runsheetProgress(job));
    if (progress) {
      ctx.runsheet = {
        complete: progress.complete,
        openExceptions: progress.openExceptions,
        missing: progress.missing,
        blocked: progress.blocked,
        walkthroughDone: progress.walkthroughDone,
      };
    }
  }
  const invoices = rec.invoices.get(id) ?? [];
  const payments = rec.payments.get(id) ?? [];
  const money = attempt("money", () => {
    const contract = project.money.contractTotalPence ?? 0;
    const depositInvoices = new Set(invoices.filter((i) => i.kind === "deposit" && i.status !== "void").map((i) => i.id));
    const depositPaidPence = payments
      .filter((p) => p.status === "succeeded" && p.invoiceId && depositInvoices.has(p.invoiceId))
      .reduce((sum, p) => sum + p.amountPence, 0);
    return {
      depositDuePence: contract > 0 ? depositPence(contract, settings) : 0,
      depositPaidPence,
      outstandingPence: outstandingPence(invoices),
    };
  });
  if (money) ctx.money = money;
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export interface LoadedProject {
  project: Project;
  updatedAt: string;
  demo: boolean;
}

/** Every readable project, most recently touched first. Unreadable snapshots are skipped and logged. */
export async function loadAllProjects(limit = 500): Promise<LoadedProject[]> {
  const res = await db().from("projects").select("id, created_at, updated_at, project").order("updated_at", { ascending: false }).limit(limit);
  const rows = (must(res as { data: Row[] | null; error: { message: string } | null }, "projects list") ?? []) as Row[];
  const out: LoadedProject[] = [];
  for (const row of rows) {
    try {
      const project = migrateProject(row.project);
      out.push({
        project,
        updatedAt: String(row.updated_at ?? row.created_at ?? project.createdAt),
        demo: isDemoSeedId(project.id) || /\(DEMO\)/.test(project.customer.name),
      });
    } catch (err) {
      console.error(`[ops-core] project ${String(row.id)} has an unreadable snapshot:`, err);
    }
  }
  return out;
}

export interface BoardData {
  cards: BoardCard[];
  today: string;
  staff: { id: string; name: string }[];
}

/** The board: every project as a card, readiness included. */
export async function loadBoard(): Promise<BoardData> {
  const [projects, settings] = await Promise.all([loadAllProjects(), getSettings()]);
  const today = londonToday();
  const rec = await loadProjectRecords(projects.map((p) => p.project.id));
  const cards = projects.map(({ project, updatedAt, demo }) => {
    const ctx = attempt("board context", () => contextFromRecords(project, rec, settings, today)) ?? null;
    const invoiceNumbers = (rec.invoices.get(project.id) ?? []).map((i) => i.number);
    return cardFromProject(project, ctx, { invoiceNumbers, demo, updatedAt });
  });
  const staff = [...rec.staff.values()].filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));
  return { cards, today, staff };
}

/* ------------------------------------------------------------------ */
/* Pulse (console + digest)                                            */
/* ------------------------------------------------------------------ */

export interface Pulse {
  today: string;
  installsToday: BoardCard[];
  surveysToday: BoardCard[];
  blocked: BoardCard[];
  overdue: BoardCard[];
  openIssues: number;
  outstanding: { count: number; pence: number; invoices: { projectId: string; customer: string; number: string; duePence: number; dueOn?: string }[] };
  live: number;
}

/** Today in one look: what's on, what's stuck, what's owed. */
export async function loadPulse(board?: BoardData): Promise<Pulse> {
  const data = board ?? (await loadBoard());
  const { cards, today } = data;
  const live = cards.filter((c) => c.column !== "closed");
  const [openIssues, invoices] = await Promise.all([issuesRepo.listOpen(), invoicesRepo.list({ statuses: ["issued", "part-paid"] })]);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const owed = invoices
    .map((i) => ({ i, due: Math.max(0, i.totalPence - i.paidPence) }))
    .filter((x) => x.due > 0)
    .map(({ i, due }) => ({
      projectId: i.projectId,
      customer: byId.get(i.projectId)?.customer ?? "Unknown project",
      number: i.number,
      duePence: due,
      ...(i.dueOn ? { dueOn: i.dueOn } : {}),
    }));
  return {
    today,
    installsToday: live.filter((c) => c.installDates.includes(today)),
    surveysToday: live.filter((c) => c.surveyAt?.slice(0, 10) === today),
    blocked: live.filter((c) => c.blockers > 0),
    overdue: live.filter((c) => c.nextAction.dueOn && c.nextAction.dueOn < today),
    openIssues: openIssues.length,
    outstanding: { count: owed.length, pence: owed.reduce((s, x) => s + x.duePence, 0), invoices: owed },
    live: live.length,
  };
}

/* ------------------------------------------------------------------ */
/* Command centre                                                      */
/* ------------------------------------------------------------------ */

export interface CommandRecords {
  survey: SurveyRecord | null;
  design: DesignRecord | null;
  proposal: ProposalRecord | null;
  compliance: ComplianceItem[];
  purchaseOrders: PurchaseOrder[];
  issues: Issue[];
  job: InstallJobV2 | null;
  invoices: Invoice[];
  payments: Payment[];
  time: TimeEntry[];
  learnings: Learning[];
  staff: StaffMember[];
  selfSurvey: Survey | null;
  quoteSource: string | null;
}

/** The records behind one project's command centre (readiness comes from project-service). */
export async function loadCommandRecords(project: Project): Promise<CommandRecords> {
  const id = project.id;
  const [survey, design, proposal, compliance, purchaseOrders, issues, job, invoices, payments, time, learnings, staff, quote] = await Promise.all([
    surveysRepo.currentForProject(id),
    designsRepo.latestForProject(id),
    proposalsRepo.latestForProject(id),
    complianceRepo.listForProject(id),
    purchaseOrdersRepo.listForProject(id),
    issuesRepo.listForProject(id),
    installJobsRepo.loadForProject(id, project),
    invoicesRepo.listForProject(id),
    paymentsRepo.listForProject(id),
    timeRepo.listForProject(id),
    learningsRepo.listForProject(id),
    staffRepo.list(),
    isUuid(project.quoteId)
      ? db().from("quote_requests").select("survey, source").eq("id", project.quoteId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const q = (quote as { data: Row | null }).data;
  return {
    survey,
    design,
    proposal,
    compliance,
    purchaseOrders,
    issues,
    job,
    invoices,
    payments,
    time,
    learnings,
    staff,
    selfSurvey: q && typeof q.survey === "object" && q.survey !== null ? (q.survey as Survey) : null,
    quoteSource: q ? String(q.source ?? "") : null,
  };
}

/** The self-survey vs measured diff, or why it isn't available. */
export function selfSurveyDiff(self: Survey | null, survey: SurveyRecord | null): { rows: SelfSurveyDiffRow[] } | { unavailable: string } {
  if (!self) return { unavailable: "There's no customer self-survey on this project's quote to compare against." };
  if (!survey) return { unavailable: "No measured survey yet. The comparison appears once the surveyor has started." };
  try {
    return { rows: diffSelfSurvey(self, survey.data) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // INTEGRATION(f2): diffSelfSurvey lands with the field survey; then swap this table for components/field/survey/self-survey-diff.tsx.
    if (message.startsWith("not implemented")) return { unavailable: "The room-by-room comparison arrives with the field survey module." };
    console.error("[ops-core] diffSelfSurvey failed:", err);
    return { unavailable: "The comparison couldn't be worked out for this survey." };
  }
}

/** Blockers for every gate not yet passed, grouped by gate, in journey order. */
export function blockersByGate(project: Project, ctx: ReadinessContext): { gate: Blocker["gate"]; blockers: Blocker[] }[] {
  const all = attempt("readiness", () => readiness(project, ctx)) ?? [];
  const groups: { gate: Blocker["gate"]; blockers: Blocker[] }[] = [];
  for (const b of all) {
    const g = groups.find((x) => x.gate === b.gate);
    if (g) g.blockers.push(b);
    else groups.push({ gate: b.gate, blockers: [b] });
  }
  return groups;
}

/** Signed read URLs for staff photos, by staff id. */
export async function staffPhotoUrls(staff: StaffMember[]): Promise<Map<string, string>> {
  const ids = staff.map((s) => s.photoMediaId).filter((x): x is string => Boolean(x));
  if (!ids.length) return new Map();
  const items = await mediaRepo.listByIds(ids);
  const urls = await signedMediaUrls(items);
  const out = new Map<string, string>();
  for (const s of staff) {
    const url = s.photoMediaId ? urls.get(s.photoMediaId) : undefined;
    if (url) out.set(s.id, url);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pilots                                                              */
/* ------------------------------------------------------------------ */

export interface PilotRow {
  metrics: PilotMetrics;
  demo: boolean;
  demoMessages: number;
  customer: string;
  diffNote?: string;
}

/** Every project with a pilot number, as metrics, in pilot order. */
export async function loadPilotRows(): Promise<{ rows: PilotRow[]; learnings: (Learning & { projectLabel: string })[] }> {
  const [all, settings, learnings] = await Promise.all([loadAllProjects(), getSettings(), learningsRepo.list()]);
  const pilots = all.filter((p) => p.project.pilot);
  const ids = pilots.map((p) => p.project.id);
  const [proposals, pos, time, issues, messages, surveys, quotes, staff] = await Promise.all([
    rowsWhereIn("proposals", "project_id", ids).then((r) => r.map(proposalsRepo.fromRow)),
    rowsWhereIn("purchase_orders", "project_id", ids).then((r) => r.map(purchaseOrdersRepo.fromRow)),
    rowsWhereIn("time_entries", "project_id", ids).then((r) => r.map(timeRepo.fromRow)),
    rowsWhereIn("issues", "project_id", ids).then((r) => r.map(issuesRepo.fromRow)),
    rowsWhereIn("messages", "project_id", ids, "project_id, status"),
    rowsWhereIn("surveys", "project_id", ids).then((r) => r.map(surveysRepo.fromRow)),
    rowsWhereIn("quote_requests", "id", pilots.map((p) => p.project.quoteId), "id, survey"),
    staffRepo.list(),
  ]);
  const roles: Record<string, StaffRole[]> = Object.fromEntries(staff.map((s) => [s.id, s.roles]));
  const latestSurvey = latestBy(surveys);
  const posBy = groupBy(pos);
  const timeBy = groupBy(time);
  const issuesBy = groupBy(issues);
  const selfByQuote = new Map(quotes.map((q) => [String(q.id), q.survey as Survey]));
  const sent = new Map<string, number>();
  const demoSent = new Map<string, number>();
  for (const m of messages) {
    const pid = String(m.project_id);
    if (m.status === "sent") sent.set(pid, (sent.get(pid) ?? 0) + 1);
    if (m.status === "demo") demoSent.set(pid, (demoSent.get(pid) ?? 0) + 1);
  }
  // The proposal the numbers are about: the accepted one, else the newest.
  const proposalFor = (pid: string) => {
    const mine = proposals.filter((p) => p.projectId === pid).sort((a, b) => b.version - a.version);
    return mine.find((p) => p.status === "accepted") ?? mine[0];
  };

  const rows: PilotRow[] = pilots.map(({ project, demo }) => {
    const survey = latestSurvey.get(project.id) ?? null;
    const self = selfByQuote.get(project.quoteId) ?? null;
    const diff = selfSurveyDiff(self, survey);
    const proposal = proposalFor(project.id);
    const metrics = pilotMetrics({
      project,
      ...(proposal ? { proposal } : {}),
      purchaseOrders: posBy.get(project.id) ?? [],
      time: timeBy.get(project.id) ?? [],
      issues: issuesBy.get(project.id) ?? [],
      messagesSent: sent.get(project.id) ?? 0,
      ...("rows" in diff ? { surveyDiff: diff.rows } : {}),
      settings,
      staffRoles: roles,
      ...(survey?.minutes ? { surveyMinutes: survey.minutes } : {}),
    });
    return {
      metrics,
      demo,
      demoMessages: demoSent.get(project.id) ?? 0,
      customer: project.customer.name,
      ...("unavailable" in diff ? { diffNote: diff.unavailable } : {}),
    };
  });
  rows.sort((a, b) => (a.metrics.pilotNumber ?? 0) - (b.metrics.pilotNumber ?? 0));
  const labelById = new Map(all.map((p) => [p.project.id, p.project.pilot ? `Pilot ${p.project.pilot.number}` : p.project.customer.name]));
  return {
    rows,
    learnings: learnings.map((l) => ({ ...l, projectLabel: labelById.get(l.projectId) ?? "Unknown project" })),
  };
}

/* ------------------------------------------------------------------ */
/* Daily ops                                                           */
/* ------------------------------------------------------------------ */

const SYSTEM = { kind: "system" as const, name: "daily-ops" };

async function runJob(job: DailyJob, summary: DailyOpsSummary): Promise<void> {
  const tally = summary.jobs[job.job];
  tally.planned++;
  if (job.kind === "dispatch") {
    const r = await dispatch(job.projectId, job.action, SYSTEM);
    if ("error" in r) {
      tally.failed++;
      summary.errors.push(`${job.job} on ${job.projectId}: ${r.error}`);
    } else tally.done++;
    return;
  }
  // The union of event and data is checked where the job is built (ops-core-schedule).
  const result = await notify(job.event as CommsEventId, { projectId: job.projectId, data: job.data as never, discriminator: job.discriminator });
  if ((DONE_STATUSES as readonly string[]).includes(result.status)) {
    tally.done++;
    if (job.record) {
      const r = await dispatch(job.projectId, job.record, SYSTEM);
      // "already sent" means an earlier run recorded it: fine.
      if ("error" in r && !/already/i.test(r.error)) summary.errors.push(`${job.job} on ${job.projectId}: couldn't record it (${r.error})`);
    }
  } else if (result.status === "disabled" || result.status === "not-allowed" || result.status === "no-recipient") {
    tally.skipped++;
  } else {
    tally.failed++;
    const why = result.results.find((x) => x.error)?.error ?? result.status;
    summary.errors.push(`${job.job} on ${job.projectId}: ${why}`);
  }
}

/**
 * The daily jobs (contract §H): reminders, nudges, expiries and aftercare
 * for every project, then the outbox's due and failed messages. Safe to run
 * any number of times a day: messages are keyed per occurrence.
 */
export async function runDailyOps(now: Date = new Date()): Promise<DailyOpsSummary> {
  const at = now.toISOString();
  const today = londonToday(now);
  const summary = emptySummary(at, today);
  if (!getServiceClient()) {
    summary.errors.push("No database connected: nothing to run.");
    return summary;
  }
  const [projects, settings] = await Promise.all([loadAllProjects(2000), getSettings()]);
  for (const { project } of projects) {
    let jobs: DailyJob[];
    try {
      jobs = dailyJobsFor(project, today, settings);
    } catch (err) {
      summary.errors.push(`planning ${project.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (jobs.length) summary.projects++;
    for (const job of jobs) {
      try {
        await runJob(job, summary);
      } catch (err) {
        summary.jobs[job.job].failed++;
        summary.errors.push(`${job.job} on ${project.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  try {
    summary.outbox = await dispatchDue(at);
  } catch (err) {
    summary.errors.push(`outbox: ${err instanceof Error ? err.message : String(err)}`);
  }
  return summary;
}

export { DAILY_JOB_IDS };

/* ------------------------------------------------------------------ */
/* Go-live checklist                                                   */
/* ------------------------------------------------------------------ */

export type CheckLevel = "green" | "amber" | "red";

export interface GoLiveCheck {
  id: string;
  label: string;
  level: CheckLevel;
  detail: string;
  fix?: string;
  href?: string;
}

/** The pilot platform's tables (migration 0010). Anything missing means the migration hasn't run. */
const PILOT_TABLES = [
  "staff",
  "login_tokens",
  "customers",
  "media",
  "surveys",
  "designs",
  "proposals",
  "catalogue_items",
  "catalogue_compatibility",
  "purchase_orders",
  "compliance_items",
  "install_jobs",
  "install_evidence",
  "issues",
  "time_entries",
  "invoices",
  "payments",
  "messages",
  "documents",
  "learnings",
  "settings",
  "audit_log",
];

async function missingTables(): Promise<string[]> {
  const client = getServiceClient();
  if (!client) return PILOT_TABLES;
  const results = await Promise.all(
    PILOT_TABLES.map(async (t) => {
      const { error } = await client.from(t).select("*", { count: "exact", head: true });
      return error ? t : null;
    }),
  );
  return results.filter((t): t is string => Boolean(t));
}

const looksDemo = (v: string | undefined | null) => Boolean(v && /\bDEMO\b/.test(v));

/**
 * Before the first real customer: every setting, secret and record the
 * pilots depend on, green, amber or red, each with the exact fix.
 */
export async function goLiveChecks(): Promise<GoLiveCheck[]> {
  const env = process.env;
  const checks: GoLiveCheck[] = [];
  const backend = dataBackend();
  const demoMode = demoLoginAllowed(env);
  const has = (k: string) => Boolean(env[k]?.trim());

  // Database.
  const [report, missing] = await Promise.all([healthReport(), missingTables()]);
  if (backend === "supabase") {
    const allOk = report.reachable && missing.length === 0 && report.tables.every((t) => t.ok);
    checks.push({
      id: "database",
      label: "Supabase connected, pilot migrations applied",
      level: allOk ? "green" : "red",
      detail: !report.reachable
        ? `Supabase isn't answering: ${report.connectionError ?? "unreachable"}.`
        : missing.length
          ? `Missing tables: ${missing.join(", ")}.`
          : "Every pilot table is there.",
      fix: "Run supabase/migrations 0010 onwards in the Supabase SQL editor, in order, then reload this page.",
      href: "/ops/status",
    });
  } else {
    checks.push({
      id: "database",
      label: "Supabase connected, pilot migrations applied",
      level: "red",
      detail:
        backend === "none"
          ? "No database: nothing saves."
          : `Using the local ${backend} backend. Fine for trying things out; real customers need Supabase (local files don't survive a Vercel deploy).`,
      fix: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, run migrations 0010 onwards, redeploy.",
    });
  }
  const buckets = report.buckets.filter((b) => !b.ok);
  if (backend === "supabase" && buckets.length) {
    checks.push({
      id: "buckets",
      label: "Storage buckets",
      level: "red",
      detail: `Missing: ${buckets.map((b) => b.bucket).join(", ")}. Photo uploads fail without them.`,
      fix: "Migration 0010 creates project-media; 0001 and 0004 the survey buckets.",
    });
  }

  // Sign-in.
  checks.push({
    id: "session-secret",
    label: "SESSION_SECRET set (32+ characters)",
    level: sessionSecretUsable(env) ? "green" : "red",
    detail: sessionSecretUsable(env)
      ? "Sessions and upload links are signed."
      : has("SESSION_SECRET")
        ? "Set, but too short: production ignores it, so nobody can sign in."
        : "Not set: production signs nobody in.",
    fix: "Generate one with `openssl rand -hex 32`, add SESSION_SECRET in Vercel, redeploy.",
  });
  checks.push({
    id: "admin-emails",
    label: "ADMIN_EMAILS set",
    level: has("ADMIN_EMAILS") ? "green" : "red",
    detail: has("ADMIN_EMAILS")
      ? "The first sign-in from one of those addresses becomes an admin."
      : "Empty: there's no way to create the first admin.",
    fix: "Add ADMIN_EMAILS (comma-separated) in Vercel and redeploy.",
  });

  // Messages.
  const emailOk = emailConfigured() && has("EMAIL_FROM") && has("NEXT_PUBLIC_APP_URL");
  checks.push({
    id: "email",
    label: "Email provider (Resend)",
    level: emailOk ? "green" : "red",
    detail: emailOk
      ? "Customer emails go out through Resend, with links to the live site."
      : `Missing: ${[!emailConfigured() && "RESEND_API_KEY", !has("EMAIL_FROM") && "EMAIL_FROM", !has("NEXT_PUBLIC_APP_URL") && "NEXT_PUBLIC_APP_URL"].filter(Boolean).join(", ")}. Without email, proposals, contracts and sign-in links are only recorded.`,
    fix: "Set RESEND_API_KEY, EMAIL_FROM (on a verified domain) and NEXT_PUBLIC_APP_URL in Vercel.",
  });
  checks.push({
    id: "sms",
    label: "SMS provider (Twilio)",
    level: smsConfigured() ? "green" : "amber",
    detail: smsConfigured()
      ? "Reminder and on-my-way texts go out."
      : "Not configured: texts are recorded in demo mode and never sent. Customers still get every email.",
    fix: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM, or carry on knowingly without texts.",
  });
  checks.push({
    id: "cron",
    label: "CRON_SECRET set",
    level: has("CRON_SECRET") ? "green" : "red",
    detail: has("CRON_SECRET")
      ? "The daily jobs (reminders, expiries, aftercare) and the morning digest run."
      : "Not set: no survey reminders, no proposal expiry, no aftercare, no digest. You can still run them from Messages.",
    fix: "Set CRON_SECRET (a long random string) in Vercel.",
    href: "/ops/messages",
  });

  // Business settings.
  const settings = await getSettings();
  const s2 = schedule2Missing(settings);
  const demoCompany = [settings.company.geographicAddress, settings.company.complaintsProcess, settings.warranty.manufacturerSummary].some(looksDemo);
  checks.push({
    id: "schedule2",
    label: "Pre-contract information (Schedule 2) complete",
    level: s2.length ? "red" : demoCompany ? (demoMode ? "amber" : "red") : "green",
    detail: s2.length
      ? `Missing: ${s2.join(", ")}. Proposals can't be issued until it's there.`
      : demoCompany
        ? "Filled in, but some company details still say DEMO."
        : "Every Schedule 2 item is in settings.",
    fix: "Fill in Company and legal details in Settings.",
    href: "/ops/settings#company",
  });
  const bankNeeded = settings.payments.methods.includes("bank-transfer");
  const bank = settings.company.bank;
  const bankOk = Boolean(bank?.accountName?.trim() && bank?.sortCode?.trim() && bank?.accountNumber?.trim());
  checks.push({
    id: "bank",
    label: "Bank details for transfers",
    level: !bankNeeded || bankOk ? "green" : "red",
    detail: !bankNeeded ? "Bank transfer isn't offered." : bankOk ? "Invoices show where to pay." : "Invoices can't say where to pay by bank transfer.",
    fix: "Add the account name, sort code and account number in Settings.",
    href: "/ops/settings#company",
  });
  const t = settings.tax;
  const vatLevel: CheckLevel = t.vatRegistered
    ? settings.company.vatNumber?.trim() && t.accountantConfirmed
      ? "green"
      : "amber"
    : t.rationale.trim()
      ? "green"
      : "amber";
  checks.push({
    id: "vat",
    label: "VAT position set",
    level: vatLevel,
    detail: t.vatRegistered
      ? `VAT registered${settings.company.vatNumber ? ` (${settings.company.vatNumber})` : ", but no VAT number in settings"}; ${t.accountantConfirmed ? "accountant confirmed" : "the accountant hasn't confirmed the tax code yet, so proposals need an admin override"}.`
      : `Not VAT registered: no VAT on proposals. ${t.rationale.trim() ? "" : "Add the rationale."}`.trim(),
    fix: "Settings → Tax and VAT.",
    href: "/ops/settings#tax",
  });

  // People.
  const staff = getServiceClient() ? await staffRepo.list({ activeOnly: true }).catch(() => [] as StaffMember[]) : [];
  const today = londonToday();
  const real = staff.filter((s) => !s.demo);
  const pool = demoMode ? staff : real;
  const holds = (s: StaffMember, kind: "fgas-cat1" | "part-p") =>
    s.qualifications.some((q) => q.kind === kind && q.reference?.trim() && (!q.expiresOn || q.expiresOn.slice(0, 10) >= today));
  const techLead = pool.some((s) => (s.roles.includes("tech-lead") || s.roles.includes("admin")) && holds(s, "fgas-cat1"));
  const electrician = pool.some((s) => s.roles.includes("electrician") && holds(s, "part-p"));
  checks.push({
    id: "tech-lead",
    label: "A technical lead with a current F-gas certificate",
    level: techLead ? "green" : "red",
    detail: techLead
      ? "Designs and commissioning can be signed off."
      : "Nobody can approve a design or sign commissioning, so no proposal can be issued.",
    fix: "Staff → add the technical lead with their F-gas Category I certificate number and expiry.",
    href: "/ops/staff",
  });
  checks.push({
    id: "electrician",
    label: "An electrician with Part P scheme membership",
    level: electrician ? "green" : "red",
    detail: electrician ? "Bookings can be confirmed." : "No booking can be confirmed without a Part P registered electrician on the crew.",
    fix: "Staff → add the electrician with their competent person scheme number and expiry.",
    href: "/ops/staff",
  });
  if (!demoMode && real.length === 0 && staff.length > 0) {
    checks.push({ id: "real-staff", label: "Real staff accounts", level: "red", detail: "Only DEMO accounts exist.", fix: "Add the team in Staff.", href: "/ops/staff" });
  }

  // Catalogue.
  const catalogue = getServiceClient() ? await catalogueRepo.listActive().catch(() => []) : [];
  const priced = (tier: "standard" | "premium") =>
    catalogue.filter((i) => (i.kind === "indoor" || i.kind === "outdoor") && i.tier === tier && i.costPence !== null && (demoMode || !i.id.startsWith("demo-")));
  const tiersMissing = (["standard", "premium"] as const).filter((tier) => priced(tier).length === 0);
  checks.push({
    id: "catalogue",
    label: "Catalogue: a priced, active unit in each tier",
    level: tiersMissing.length === 0 ? "green" : tiersMissing.length === 2 ? "red" : "amber",
    detail: tiersMissing.length === 0 ? "Standard and premium options can be costed." : `No priced ${tiersMissing.join(" or ")} equipment yet: those options can't be costed.`,
    fix: "Catalogue → enter supplier costs for the units you'll fit.",
    href: "/ops/catalogue",
  });

  // Legal (warn only).
  const legalOk = settings.legal.termsReviewed && settings.legal.cancellationReviewed;
  checks.push({
    id: "legal",
    label: "Terms and cancellation wording reviewed",
    level: legalOk ? "green" : "amber",
    detail: legalOk
      ? `Terms ${settings.legal.termsVersion} reviewed.`
      : `Terms ${settings.legal.termsVersion}: ${[!settings.legal.termsReviewed && "terms", !settings.legal.cancellationReviewed && "cancellation wording"].filter(Boolean).join(" and ")} not yet reviewed by a solicitor. Proposals can still go out, with a warning.`,
    fix: "Get the solicitor's sign-off, then tick it in Settings → Legal.",
    href: "/ops/settings#legal",
  });

  // Demo data.
  if (getServiceClient()) {
    const projects = await loadAllProjects(2000).catch(() => [] as LoadedProject[]);
    const demoProjects = projects.filter((p) => p.demo).length;
    checks.push({
      id: "demo-data",
      label: "No DEMO data on the live system",
      level: demoMode ? "amber" : demoProjects ? "red" : "green",
      detail: demoMode
        ? `Demo sign-in is on (development or ALLOW_DEMO_LOGIN=1), with ${demoProjects} DEMO project${demoProjects === 1 ? "" : "s"}. Turn it off before real customers arrive.`
        : demoProjects
          ? `${demoProjects} DEMO project${demoProjects === 1 ? "" : "s"} on the live database.`
          : "No DEMO projects.",
      fix: demoMode ? "Remove ALLOW_DEMO_LOGIN from Vercel and redeploy." : "Delete the DEMO projects (their quotes have source 'demo') before go-live.",
    });
  }
  return checks;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const COMMS_EVENT_IDS = Object.keys(COMMS_EVENTS) as CommsEventId[];

/** Customer names (and pilot numbers) for a set of project ids, for lists that only hold the id. */
export async function projectNames(ids: string[]): Promise<Map<string, { name: string; pilot?: number }>> {
  const rows = await rowsWhereIn("projects", "id", ids, "id, customer_name, pilot_number");
  return new Map(
    rows.map((r) => [
      String(r.id),
      { name: String(r.customer_name ?? "") || "Unnamed customer", ...(typeof r.pilot_number === "number" ? { pilot: r.pilot_number } : {}) },
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Staff media (profile photos, certificates)                          */
/* ------------------------------------------------------------------ */

export const STAFF_MEDIA_TYPES: Record<"photo" | "evidence", readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp"],
  evidence: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
};

/** `staff/<staffId>/<mediaId>-<name>`: staff media belongs to no project. */
export function staffMediaPath(staffId: string, mediaId: string, fileName: string, contentType: string): string | null {
  if (!isUuid(staffId) || !isUuid(mediaId)) return null;
  return `staff/${staffId.toLowerCase()}/${mediaId.toLowerCase()}-${safeMediaName(fileName, contentType)}`;
}

export function isStaffMediaPath(staffId: string, mediaId: string, path: string): boolean {
  if (!isUuid(staffId) || !isUuid(mediaId)) return false;
  const prefix = `staff/${staffId.toLowerCase()}/${mediaId.toLowerCase()}-`;
  return path.startsWith(prefix) && !path.includes("..") && path.split("/").length === 3 && path.length > prefix.length;
}

/** Step 1: a signed upload URL for a staff photo or certificate. */
export async function startStaffUpload(input: {
  staffId: string;
  purpose: "photo" | "evidence";
  fileName: string;
  contentType: string;
}): Promise<{ mediaId: string; path: string; signedUrl: string } | { error: string; status: number }> {
  const contentType = input.contentType.toLowerCase().split(";")[0]!.trim();
  if (!STAFF_MEDIA_TYPES[input.purpose].includes(contentType) || !(MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return { error: input.purpose === "photo" ? "Photos only: JPEG, PNG or WebP." : "Photos (JPEG, PNG, WebP) or a PDF only.", status: 415 };
  }
  const mediaId = crypto.randomUUID();
  const path = staffMediaPath(input.staffId, mediaId, input.fileName, contentType);
  if (!path) return { error: "Unknown staff member.", status: 404 };
  const { data, error } = await db().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: `Uploads aren't available right now (${error?.message ?? "no URL"}).`, status: 502 };
  return { mediaId, path, signedUrl: data.signedUrl };
}

/** Step 3: the file is in storage, so record it (idempotent). */
export async function confirmStaffUpload(input: {
  staffId: string;
  mediaId: string;
  path: string;
  purpose: "photo" | "evidence";
  by: StaffMember;
}): Promise<{ item: MediaItem; url: string | null } | { error: string; status: number }> {
  if (!isStaffMediaPath(input.staffId, input.mediaId, input.path)) return { error: "That upload isn't valid. Start again.", status: 400 };
  const existing = await mediaRepo.get(input.mediaId);
  if (existing) {
    const urls = await signedMediaUrls([existing]);
    return { item: existing, url: urls.get(existing.id) ?? null };
  }
  const bucket = db().storage.from(MEDIA_BUCKET);
  const { data: info, error } = await bucket.info(input.path);
  if (error || !info) return { error: "The file hasn't arrived yet. Try again.", status: 409 };
  const size = typeof info.size === "number" ? info.size : 0;
  if (size > MEDIA_MAX_BYTES) {
    await bucket.remove([input.path]);
    return { error: "That file is too big (25 MB at most).", status: 413 };
  }
  const contentType = String(info.contentType ?? "application/octet-stream").toLowerCase();
  if (!STAFF_MEDIA_TYPES[input.purpose].includes(contentType)) {
    await bucket.remove([input.path]);
    return { error: "That file type can't be kept here.", status: 415 };
  }
  const item: MediaItem = {
    id: input.mediaId,
    projectId: "",
    bucket: MEDIA_BUCKET,
    storagePath: input.path,
    contentType,
    tag: input.purpose === "photo" ? "other" : "document",
    caption: input.purpose === "photo" ? "Staff photo" : "Qualification evidence",
    source: "ops",
    takenBy: { kind: "staff", id: input.by.id, name: input.by.name },
    takenAt: new Date().toISOString(),
    customerVisible: false,
    annotations: [],
    annotationsVersion: 0,
    locked: false,
  };
  const saved = await mediaRepo.insert(item);
  const urls = await signedMediaUrls([saved]);
  return { item: saved, url: urls.get(saved.id) ?? null };
}

/** A read URL for one media item (staff evidence links). */
export async function mediaUrl(id: string): Promise<string | null> {
  const item = await mediaRepo.get(id);
  if (!item) return null;
  return (await signedMediaUrls([item])).get(id) ?? null;
}

