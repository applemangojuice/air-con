import {
  PROJECT_SCHEMA_VERSION,
  applyProjectAction,
  blockersFor,
  createProject,
  currentStage,
  depositPence,
  settingsForProposal,
  generateQuote,
  instantiateCompliance,
  isOpen,
  kitSummary,
  migrateProject,
  nextGate,
  outstandingPence,
  runsheetProgress,
  surveyCompleteness,
  type Blocker,
  type Project,
  type ProjectAction,
  type QuoteResult,
  type ReadinessContext,
  type StaffMember,
  type Survey,
} from "@aircon/domain";
import { audit, type AuditActor } from "./audit";
import { isPlausibleEmail, normaliseEmail, relinkEmail } from "./auth/access";
import { notifyForAction } from "./comms/for-action";
import { isUuid, uuidOrNull } from "./repo/base";
import * as complianceRepo from "./repo/compliance";
import * as customersRepo from "./repo/customers";
import * as designsRepo from "./repo/designs";
import * as installJobsRepo from "./repo/installJobs";
import * as invoicesRepo from "./repo/invoices";
import * as issuesRepo from "./repo/issues";
import * as paymentsRepo from "./repo/payments";
import * as proposalsRepo from "./repo/proposals";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import * as staffRepo from "./repo/staff";
import * as surveysRepo from "./repo/surveys";
import { withLegacyContact } from "./legacy-contact";
import { getSettings } from "./settings-server";
import { getServiceClient } from "./supabase-server";

/**
 * Projects on the server, v2 (contract §F). The single write path:
 *
 *   const result = await dispatch(projectId, { type: "booking-confirmed" }, { kind: "staff", staff });
 *   if ("error" in result) → show result.error / result.blockers
 *
 * dispatch loads the snapshot (migrating v1 on read), builds the readiness
 * context from every repository, runs the pure reducer with it, saves with
 * an optimistic check (a concurrent write retries rather than being lost),
 * audits, then lets the comms layer speak. Gates live in the reducer, so a
 * refused action comes back with exactly the blockers to show.
 *
 * Permissions are the caller's job (requireStaff / requireProjectAccess);
 * qualifications are the reducer's (ctx.actor).
 *
 * The JSONB snapshot is the truth. The flat columns exist for the ops board
 * and are rewritten from it on every save, so they can't drift.
 */

/* ------------------------------------------------------------------ */
/* Actors                                                              */
/* ------------------------------------------------------------------ */

export type ServiceActor =
  | { kind: "staff"; staff: StaffMember }
  | { kind: "customer"; customerId: string; name?: string }
  | { kind: "system"; name?: string };

/** What callers may pass: a ServiceActor, a staff record, or nothing (the system). */
export type ActorInput = ServiceActor | StaffMember | null | undefined;

export function toServiceActor(actor: ActorInput): ServiceActor {
  if (!actor) return { kind: "system" };
  if ("roles" in actor) return { kind: "staff", staff: actor };
  return actor;
}

/** The comms layer's view of who did it (names in messages, staff ids for team alerts). */
function commsActorOf(actor: ServiceActor): { name?: string; staffId?: string; id?: string } {
  if (actor.kind === "staff") return { name: actor.staff.name, staffId: actor.staff.id, id: actor.staff.id };
  if (actor.kind === "customer") return { id: actor.customerId, name: actor.name };
  return { name: actor.name };
}

function auditActorOf(actor: ServiceActor): AuditActor {
  if (actor.kind === "staff") return { kind: "staff", id: actor.staff.id, name: actor.staff.name };
  if (actor.kind === "customer") return { kind: "customer", id: actor.customerId, name: actor.name };
  return { kind: "system", name: actor.name ?? "system" };
}

/* ------------------------------------------------------------------ */
/* Load + save                                                         */
/* ------------------------------------------------------------------ */

interface LoadedRow {
  project: Project;
  /** For the optimistic save: the row's updated_at as read. */
  updatedAt: string | null;
  schemaVersion: number;
}

async function readRow(id: string): Promise<LoadedRow | null> {
  const db = getServiceClient();
  if (!db || !isUuid(id)) return null;
  const { data, error } = await db
    .from("projects")
    .select("id, quote_id, customer_id, schema_version, updated_at, project")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`project load: ${error.message}`);
  if (!data) return null;
  let project: Project;
  try {
    project = migrateProject(data.project);
  } catch (err) {
    console.error(`[project] ${id} has an unreadable snapshot:`, err);
    return null;
  }
  // v1 kept the contact details on the quote; v2 never borrows them (see legacy-contact).
  project = await withLegacyContact(db, project, data.project, (data.quote_id as string | null) ?? null);
  // customerLink attaches the customer on the row; carry it into the snapshot.
  if (data.customer_id && !project.customer.customerId) project.customer.customerId = String(data.customer_id);
  return {
    project,
    updatedAt: (data.updated_at as string | null) ?? null,
    schemaVersion: Number(data.schema_version ?? 1),
  };
}

/**
 * The project as v2, or null (unknown id, demo mode, unreadable snapshot).
 * v1 rows are migrated in memory; the v2 snapshot is written back on the
 * next save, not on read.
 */
export async function loadProject(id: string): Promise<Project | null> {
  return (await readRow(id))?.project ?? null;
}

/** The flat columns, recomputed from the snapshot. Column names are the v1 ones, kept. */
function denormalise(p: Project, blocked?: boolean) {
  return {
    schema_version: PROJECT_SCHEMA_VERSION,
    customer_name: p.customer.name || "",
    postcode: p.customer.postcode || "",
    current_stage: currentStage(p),
    completed: p.closure.closed,
    site_visit_at: p.survey.scheduledFor ?? null,
    delivery_expected_on: p.kit.expectedDate ?? null,
    install_on: p.booking.startDate ?? null,
    pilot_number: p.pilot?.number ?? null,
    owner_staff_id: uuidOrNull(p.owner?.staffId),
    next_action: p.nextAction?.text ?? null,
    next_action_at: p.nextAction?.dueOn ?? null,
    value_pence: p.money.contractTotalPence ?? Math.round(p.quoteSummary.totalGbp * 100),
    // Never cleared from here: customerLink may have attached one the snapshot hasn't seen.
    ...(isUuid(p.customer.customerId) ? { customer_id: p.customer.customerId } : {}),
    ...(blocked === undefined ? {} : { blocked }),
    updated_at: new Date().toISOString(),
    project: p,
  };
}

type WriteResult = { ok: true } | { ok: false; conflict: boolean; error: string };

async function writeProject(
  project: Project,
  opts: { expectedUpdatedAt?: string | null; blocked?: boolean },
): Promise<WriteResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, conflict: false, error: "No database connected" };
  let q = db.from("projects").update(denormalise(project, opts.blocked)).eq("id", project.id);
  if (opts.expectedUpdatedAt) q = q.eq("updated_at", opts.expectedUpdatedAt);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, conflict: false, error: error.message };
  if ((data ?? []).length === 0) {
    return opts.expectedUpdatedAt
      ? { ok: false, conflict: true, error: "The project changed while saving" }
      : { ok: false, conflict: false, error: "Project not found" };
  }
  return { ok: true };
}

/**
 * Save a v2 snapshot and its board columns (schema_version 2). With
 * `expectedUpdatedAt`, only if nobody saved since that read. Prefer
 * `dispatch`, which also runs the gates, audits and notifies.
 */
export async function saveProject(
  project: Project,
  opts: { expectedUpdatedAt?: string | null; blocked?: boolean } = {},
): Promise<boolean> {
  const result = await writeProject(project, opts);
  if (!result.ok) console.error(`[project] save ${project.id} failed:`, result.error);
  return result.ok;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

/**
 * The project already tagged with this pilot number, if any (other than the
 * one being tagged, or the one a retried new-pilot form already made).
 * Pilot numbers line the pilots up against each other on /ops/pilots and in
 * the CSV, so two households must never share one.
 */
export async function pilotNumberHolder(
  number: number,
  except: { projectId?: string; quoteId?: string } = {},
): Promise<{ id: string; name: string } | null> {
  const db = getServiceClient();
  if (!db || !Number.isInteger(number)) return null;
  const { data, error } = await db.from("projects").select("id, quote_id, customer_name").eq("pilot_number", number);
  if (error) throw new Error(`pilot number lookup failed: ${error.message}`);
  const rows = (data ?? []) as { id: unknown; quote_id: unknown; customer_name: unknown }[];
  const other = rows.find((r) => String(r.id) !== except.projectId && (!except.quoteId || String(r.quote_id ?? "") !== except.quoteId));
  if (!other) return null;
  return { id: String(other.id), name: String(other.customer_name ?? "") || "another household" };
}

/**
 * The v2 project for a saved quote. Idempotent: one project per quote, a
 * repeat call returns the existing id (`created: false`). Links the
 * customer record (created from the quote's email on first sight) and sets
 * up the compliance checklist.
 */
export async function createProjectForQuote(
  quoteId: string,
  opts: {
    pilot?: { number: number; label: string };
    contact?: { email?: string; phone?: string };
    actor?: ActorInput;
  } = {},
): Promise<{ id: string; created: boolean } | { error: string; status: number }> {
  const db = getServiceClient();
  if (!db) return { error: "demo", status: 200 };
  if (!isUuid(quoteId)) return { error: "Quote not found", status: 404 };

  const { data: existing } = await db.from("projects").select("id").eq("quote_id", quoteId).maybeSingle();
  if (existing) return { id: String(existing.id), created: false };

  const { data: quoteRow } = await db
    .from("quote_requests")
    .select("id, customer_name, email, phone, survey, quote, attribution")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quoteRow) return { error: "Quote not found", status: 404 };

  const settings = await getSettings();
  const name = (quoteRow.customer_name as string | null) ?? "";
  const email = normaliseEmail(opts.contact?.email ?? (quoteRow.email as string | null) ?? "");
  const phone = opts.contact?.phone ?? (quoteRow.phone as string | null) ?? undefined;
  let customerId: string | undefined;
  if (isPlausibleEmail(email)) {
    try {
      const customer = await customersRepo.findOrCreate({ email, name: name || undefined, phone });
      customerId = customer.id;
      // The funnel's consents (operational, and marketing only if ticked) become the customer's.
      const consents = customersRepo.consentsFromQuote(quoteRow.attribution);
      if (consents) {
        await customersRepo.recordQuoteConsents(customer, consents).catch((err) => {
          console.error("[project] recording the quote's consents failed (continuing):", err);
        });
      }
    } catch (err) {
      console.error("[project] customer link failed (continuing without):", err);
    }
  }

  const now = new Date().toISOString();
  let project = createProject({
    id: crypto.randomUUID(),
    quoteId,
    createdAt: now,
    customerName: name,
    survey: quoteRow.survey as Survey,
    quote: quoteRow.quote as QuoteResult,
    ...(isPlausibleEmail(email) ? { customerEmail: email } : {}),
    ...(phone ? { customerPhone: phone } : {}),
    ...(customerId ? { customerId } : {}),
    surveyFeeGbp: settings.scheduling.surveyFeeGbp,
    surveyDurationMinutes: settings.scheduling.surveyDurationMinutes,
    installDays: settings.scheduling.installBlockDays,
  });
  if (opts.pilot) {
    const tagged = applyProjectAction(project, { type: "set-pilot", ...opts.pilot }, now);
    if (tagged.ok) project = tagged.project;
  }

  const { data, error } = await db
    .from("projects")
    .insert({ id: project.id, quote_id: quoteId, ...denormalise(project, false) })
    .select("id")
    .single();
  if (error || !data) {
    // Lost a race with a concurrent create; the unique quote_id makes this safe.
    const { data: raced } = await db.from("projects").select("id").eq("quote_id", quoteId).maybeSingle();
    if (raced) return { id: String(raced.id), created: false };
    console.error("[project] insert failed:", error?.message);
    return { error: "Could not create project", status: 502 };
  }

  try {
    await complianceRepo.insertMany(instantiateCompliance(project.id, () => crypto.randomUUID()));
  } catch (err) {
    // Readiness then says the checklist is missing, and ops can add it from the compliance page.
    console.error(`[project] compliance checklist not created for ${project.id}:`, (err as Error).message);
  }

  await audit({
    actor: auditActorOf(toServiceActor(opts.actor)),
    action: "project.create",
    entity: "project",
    entityId: project.id,
    detail: { quoteId, ...(opts.pilot ? { pilot: opts.pilot } : {}) },
  });
  // No comms event for "project created" in v2: the first
  // customer message is survey-booked (contract §H).
  return { id: project.id, created: true };
}

/* ------------------------------------------------------------------ */
/* Readiness context                                                   */
/* ------------------------------------------------------------------ */

/** Today's date in London (yyyy-mm-dd): the day gates and lead times count from. */
export function londonToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Run a derived check. A failure is logged and the fact left unknown, which
 * the gates treat as not passed (fail closed), never as passed.
 */
function attempt<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    console.error(`[readiness] ${label} failed:`, err);
    return undefined;
  }
}

/** Everything outside the snapshot that a gate needs, read from the repositories. */
export async function buildReadinessContext(project: Project, actor?: StaffMember): Promise<ReadinessContext> {
  const id = project.id;
  const [settings, survey, design, proposal, compliance, crew, pos, issues, job, invoices, payments] = await Promise.all([
    getSettings(),
    surveysRepo.currentForProject(id),
    designsRepo.latestForProject(id),
    proposalsRepo.latestForProject(id),
    complianceRepo.listForProject(id),
    staffRepo.listByIds(project.booking.crew.map((m) => m.staffId)),
    purchaseOrdersRepo.listForProject(id),
    issuesRepo.listForProject(id),
    installJobsRepo.loadForProject(id, project),
    invoicesRepo.listForProject(id),
    paymentsRepo.listForProject(id),
  ]);
  const today = londonToday();

  const ctx: ReadinessContext = {
    today,
    settings,
    ...(actor ? { actor } : {}),
    compliance: compliance.map((c) => ({
      key: c.key,
      label: c.label,
      status: c.status,
      statutory: c.statutory,
      gate: c.gate,
    })),
    crew,
    openIssues: issues.filter(isOpen).map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      severity: i.severity,
      blocking: i.blocking,
      ...(i.gate ? { gate: i.gate } : {}),
    })),
    commissioning: job?.commissioning
      ? { signed: true, signedBy: job.commissioning.signedBy.name }
      : { signed: false },
  };

  if (survey) {
    // A survey that exists but can't be checked yet must not pass the gate.
    ctx.surveyCompleteness = attempt("surveyCompleteness", () => {
      const c = surveyCompleteness(survey.data);
      return { pct: c.pct, missing: c.missing.map((m) => `${m.section}: ${m.item}`) };
    }) ?? { pct: 0, missing: ["the completeness check failed: see the server log"] };
  }

  if (design) {
    const errors = (design.variants ?? []).flatMap((v) => (v.systems ?? []).flatMap((s) => s.compatibility?.errors ?? []));
    ctx.design = {
      status: design.status,
      ...(design.approval ? { approvedBy: design.approval.name } : {}),
      compatibilityErrors: [...new Set(errors)],
    };
  }

  if (proposal) {
    ctx.proposalCheck = {
      belowMinMargin: (proposal.options ?? []).some((o) => o.pricing?.belowMinMargin === true),
      marginOverride: Boolean(proposal.marginOverride),
      taxConfirmed: !settings.tax.vatRegistered || settings.tax.accountantConfirmed,
      taxOverride: Boolean(proposal.taxOverride),
      expired: Boolean(proposal.validUntil) && proposal.validUntil.slice(0, 10) < today,
    };
  }

  if (pos.length > 0) {
    const kit = attempt("kitSummary", () => kitSummary(pos));
    if (kit) {
      ctx.kit = {
        requiredLines: kit.requiredLines,
        deliveredLines: kit.deliveredLines,
        inspectedLines: kit.inspectedLines,
        damaged: kit.damaged,
      };
    }
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

  // Money only when it can be worked out properly; otherwise the closed gate
  // honestly says it hasn't been reconciled.
  const money = attempt("money", () => {
    const contract = project.money.contractTotalPence ?? 0;
    const depositInvoices = new Set(invoices.filter((i) => i.kind === "deposit" && i.status !== "void").map((i) => i.id));
    const depositPaidPence = payments
      .filter((p) => p.status === "succeeded" && p.invoiceId && depositInvoices.has(p.invoiceId))
      .reduce((sum, p) => sum + p.amountPence, 0);
    return {
      // The deposit the customer agreed (the accepted proposal's frozen terms), not today's settings.
      depositDuePence: contract > 0 ? depositPence(contract, settingsForProposal(settings, proposal?.status === "accepted" ? proposal : null)) : 0,
      depositPaidPence,
      outstandingPence: outstandingPence(invoices),
    };
  });
  if (money) ctx.money = money;

  return ctx;
}

/** The readiness context for a project by id (null when the project doesn't exist). */
export async function loadReadinessContext(projectId: string, actor?: StaffMember): Promise<ReadinessContext | null> {
  const project = await loadProject(projectId);
  return project ? buildReadinessContext(project, actor) : null;
}

/**
 * The email is the customer's identity (§C). When a project's email changes,
 * the project moves to the customer record for the new address (found or
 * created), so links sent there sign in as that customer, never as whoever
 * owned the old address, and the old customer's sessions lose the project at
 * once (the row's customer_id decides access). Clearing the email moves
 * nothing; with no address, nothing is sent. Null when the customer record
 * couldn't be read or written: then the change mustn't be saved.
 */
async function relinkCustomer(before: Project, after: Project): Promise<Project | null> {
  const email = relinkEmail(before.customer.email, after.customer.email);
  if (!email) return after;
  try {
    const customer = await customersRepo.findOrCreate({
      email,
      name: after.customer.name || undefined,
      phone: after.customer.phone,
    });
    return { ...after, customer: { ...after.customer, customerId: customer.id } };
  } catch (err) {
    console.error(`[project] customer relink for ${after.id} failed:`, err);
    return null;
  }
}

/** Does the project's next gate have anything that actually blocks it? (The board's red flag.) */
function isBlocked(project: Project, ctx: ReadinessContext): boolean {
  const gate = nextGate(project);
  return gate ? blockersFor(project, ctx, gate).some((b) => b.severity === "block") : false;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export type DispatchResult = { project: Project } | { error: string; status: number; blockers?: Blocker[] };

const SAVE_ATTEMPTS = 3;

/**
 * Load → reduce (with the readiness context) → save → audit → notify. The
 * one way a v2 project changes. Notification is best-effort: the
 * transition has committed, so a failed email never rolls it back.
 */
export async function dispatch(projectId: string, action: ProjectAction, actorInput: ActorInput): Promise<DispatchResult> {
  if (!getServiceClient()) return { error: "No database connected (demo mode)", status: 503 };
  const actor = toServiceActor(actorInput);
  const staff = actor.kind === "staff" ? actor.staff : undefined;

  for (let i = 0; i < SAVE_ATTEMPTS; i++) {
    const row = await readRow(projectId);
    if (!row) return { error: "Project not found", status: 404 };

    const ctx = await buildReadinessContext(row.project, staff);
    const result = applyProjectAction(row.project, action, new Date().toISOString(), ctx);
    if (!result.ok) {
      return { error: result.error, status: 409, ...(result.blockers ? { blockers: result.blockers } : {}) };
    }
    const next = await relinkCustomer(row.project, result.project);
    if (!next) return { error: "Couldn't link the new email address to a customer record. Please try again.", status: 502 };
    const movedTo = next.customer.customerId !== row.project.customer.customerId ? next.customer.customerId : undefined;

    const write = await writeProject(next, {
      expectedUpdatedAt: row.updatedAt,
      blocked: isBlocked(next, ctx),
    });
    if (!write.ok && write.conflict) continue; // someone saved in between: re-read and re-apply
    if (!write.ok) {
      console.error(`[project] dispatch ${action.type} on ${projectId} failed to save:`, write.error);
      return { error: "Could not save project", status: 502 };
    }

    await audit({
      actor: auditActorOf(actor),
      action: `project.${action.type}`,
      entity: "project",
      entityId: projectId,
      detail: {
        action,
        ...(row.schemaVersion < PROJECT_SCHEMA_VERSION ? { migratedFrom: row.schemaVersion } : {}),
        ...(movedTo ? { customerId: movedTo } : {}),
      },
    });
    try {
      await notifyForAction(next, action, commsActorOf(actor));
    } catch (err) {
      console.error(`[project] notify for ${action.type} on ${projectId} failed:`, err);
    }
    return { project: next };
  }
  return { error: "The project changed while saving. Please try again.", status: 409 };
}

/**
 * Old name, new machine: dispatch as the system, with the legacy demo-mode
 * answer ({ error: "demo", status: 200 }) the old v1 callers expected.
 */
export async function applyAndSave(
  id: string,
  action: ProjectAction,
  actor?: ActorInput,
): Promise<{ project: Project } | { error: string; status: number; blockers?: Blocker[] }> {
  if (!getServiceClient()) return { error: "demo", status: 200 };
  return dispatch(id, action, actor);
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

/** A fictional home (the same one the v1 demo uses), for /p/demo and tests. */
export const DEMO_SURVEY: Survey = {
  postcode: "SW4 7AA",
  addressLine: "12 Larkhall Rise",
  archetypeId: "thirties-semi",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [
    {
      id: "demo-r1",
      name: "Main bedroom",
      type: "bedroom",
      size: "medium",
      floor: "first",
      glazing: "medium",
      orientation: "south",
      hasExternalWall: true,
      photos: [{ id: "demo-p1", kind: "room" }],
    },
    {
      id: "demo-r2",
      name: "Living room",
      type: "living-room",
      size: "large",
      floor: "ground",
      glazing: "high",
      orientation: "west",
      hasExternalWall: true,
      photos: [{ id: "demo-p2", kind: "room" }],
    },
    {
      id: "demo-r3",
      name: "Home office",
      type: "home-office",
      size: "small",
      floor: "first",
      glazing: "medium",
      orientation: "east",
      hasExternalWall: true,
      photos: [{ id: "demo-p3", kind: "room" }],
    },
  ],
  outdoor: { location: "ground-rear", photos: [{ id: "demo-p4", kind: "outdoor-location" }] },
  electrics: {
    condition: "modern-spare-ways",
    photos: [{ id: "demo-p5", kind: "fuse-board" }],
  },
};

/** A fresh v2 demo project. Playable in the browser with the same reducer; nothing persists. */
export function buildDemoProject(now: string = new Date().toISOString()): Project {
  return createProject({
    id: "demo",
    quoteId: "demo",
    createdAt: now,
    customerName: "Alex Morgan",
    survey: DEMO_SURVEY,
    quote: generateQuote(DEMO_SURVEY),
  });
}
