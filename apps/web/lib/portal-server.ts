import {
  currentStage,
  customerNextAction,
  defaultsForKind,
  isOpen,
  outstandingPence,
  STAGE_INFO,
  type Blocker,
  type DocumentRecord,
  type Issue,
  type MediaItem,
  type Project,
  type ProjectAction,
  type ProjectStageId,
  type StaffMember,
} from "@aircon/domain";
import { audit } from "./audit";
import { isPlausibleEmail, normaliseEmail } from "./auth/access";
import { issueMagicLink } from "./auth/magic";
import { getSession, requireProjectAccess, type ProjectAccess } from "./auth/server";
import { notify } from "./comms/outbox";
import { isCustomerVisible, listDocuments } from "./documents-server";
import { emailConfigured } from "./email";
import { money } from "./format";
import { signedMediaUrls } from "./media-server";
import { dispatch, loadProject, londonToday } from "./project-service";
import { isUuid, type Row } from "./repo/base";
import * as customersRepo from "./repo/customers";
import * as documentsRepo from "./repo/documents";
import * as installJobsRepo from "./repo/installJobs";
import * as invoicesRepo from "./repo/invoices";
import * as issuesRepo from "./repo/issues";
import * as mediaRepo from "./repo/media";
import * as staffRepo from "./repo/staff";
import { enforceRateLimit } from "./rate-limit";
import { getSettings } from "./settings-server";
import { getServiceClient } from "./supabase-server";
import {
  addDays,
  blockLabel,
  blockProblem,
  earliestOfferedStart,
  installBlockOptions,
  isOfferedSlot,
  londonWallClock,
  surveySlotDays,
} from "@/components/portal/schedule";
import type { HubData, HubDocument, HubInvoice, HubIssue, HubPhoto, PersonCard, PortalRequest } from "@/components/portal/types";
import { customerSafeProject, hubFacts, outstandingOf, personCard } from "@/components/portal/view";

/**
 * The customer portal on the server (contract §G F1): what the hub shows,
 * and every change a customer can make from it. Callers (pages and the
 * app/api/portal routes) check access first with requireProjectAccess;
 * everything here assumes that's been done and never trusts the browser for
 * anything but the customer's choice: slots, blocks and decisions are
 * re-checked against the database before they're dispatched.
 *
 * Writes go through `dispatch` (the reducer, gates, audit and comms) with a
 * customer actor. Two things live outside the project snapshot: variation
 * decisions and problem reports, both on the `issues` table, both audited
 * and both telling the team.
 */

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Run a read the page can live without; log and fall back on failure. */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith("not implemented")) console.error(`[portal] ${label} failed:`, err);
    return fallback;
  }
}

/** One line, trimmed and capped: for email subjects and alert titles built from customer text. */
const oneLine = (s: string, max = 120) => {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** The customer's own name for decisions and alerts, never blank. */
const customerName = (p: Project) => p.customer.name?.trim() || "The customer";

/* ------------------------------------------------------------------ */
/* Bookings other projects hold                                        */
/* ------------------------------------------------------------------ */

/** Other projects' booked survey datetimes from today on (one surveyor, so they're taken). */
export async function takenSurveySlots(excludeProjectId: string, today: string): Promise<string[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data, error } = await db
    .from("projects")
    .select("id, site_visit_at, completed")
    .not("site_visit_at", "is", null)
    .gte("site_visit_at", `${today}T00:00:00.000Z`);
  if (error) throw new Error(`taken survey slots: ${error.message}`);
  return ((data ?? []) as Row[])
    .filter((r) => String(r.id) !== excludeProjectId && r.completed !== true)
    .map((r) => String(r.site_visit_at));
}

/** Every date other live projects are booked or installing on (one crew). */
export async function bookedInstallDates(excludeProjectId: string, today: string): Promise<string[]> {
  const db = getServiceClient();
  if (!db) return [];
  const { data, error } = await db
    .from("projects")
    .select("id, install_on, completed, project")
    .not("install_on", "is", null)
    .gte("install_on", addDays(today, -21));
  if (error) throw new Error(`booked install dates: ${error.message}`);
  const out = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    if (String(r.id) === excludeProjectId || r.completed === true) continue;
    const snap = (r.project ?? {}) as Partial<Project>;
    for (const d of snap.booking?.dates ?? []) if (typeof d === "string") out.add(d.slice(0, 10));
    for (const d of snap.install?.days ?? []) if (typeof d?.date === "string") out.add(d.date.slice(0, 10));
    if (typeof r.install_on === "string") out.add(String(r.install_on).slice(0, 10));
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* The hub                                                             */
/* ------------------------------------------------------------------ */

function toHubDocument(d: DocumentRecord): HubDocument {
  return { id: d.id, kind: d.kind, title: d.title, ref: d.ref, version: d.version, status: d.status, createdAt: d.createdAt };
}

function toHubIssue(i: Issue, photos: Map<string, HubPhoto>): HubIssue {
  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    title: i.title,
    ...(i.detail ? { detail: i.detail } : {}),
    status: i.status,
    raisedAt: i.raisedAt,
    raisedBy: i.raisedBy.kind === "customer" ? "you" : "us",
    ...(i.dueOn ? { dueOn: i.dueOn } : {}),
    ...(i.resolution && !isOpen(i) ? { resolution: i.resolution } : {}),
    ...(i.resolvedAt ? { resolvedAt: i.resolvedAt } : {}),
    photos: i.mediaIds.map((id) => photos.get(id)).filter((p): p is HubPhoto => Boolean(p)),
    ...(i.variation ? { variation: { ...i.variation } } : {}),
  };
}

const toPhoto = (m: MediaItem, url: string | null): HubPhoto => ({
  id: m.id,
  url,
  ...(m.caption ? { caption: m.caption } : {}),
  ...(m.width ? { width: m.width } : {}),
  ...(m.height ? { height: m.height } : {}),
});

/**
 * Everything the hub shows, customer-safe. `access` decides the viewer
 * strip; the content is the customer's view either way (staff see what the
 * customer sees). Null when the project can't be read.
 */
export async function loadHub(projectId: string, access: ProjectAccess): Promise<HubData | null> {
  const raw = await loadProject(projectId);
  if (!raw) return null;
  const settings = await getSettings();
  const today = londonToday();
  const nowIso = new Date().toISOString();
  const project = customerSafeProject(raw);

  const wantsSlots = project.survey.status === "not-booked" || project.survey.status === "booked";
  const wantsBlocks = project.proposal.status === "accepted" && project.install.status === "not-started";

  const [documents, issues, invoices, crewStaff, surveyorStaff, job, taken, booked] = await Promise.all([
    safe("documents", () => listDocuments(projectId, { customerVisibleOnly: true }), [] as DocumentRecord[]),
    safe("issues", async () => (await issuesRepo.listForProject(projectId)).filter((i) => i.customerVisible), [] as Issue[]),
    safe("invoices", () => invoicesRepo.listForProject(projectId), []),
    safe("crew", () => staffRepo.listByIds(project.booking.crew.map((c) => c.staffId)), [] as StaffMember[]),
    safe(
      "surveyor",
      async () => (project.survey.surveyor && isUuid(project.survey.surveyor.staffId) ? staffRepo.get(project.survey.surveyor.staffId) : null),
      null as StaffMember | null,
    ),
    safe("install job", () => installJobsRepo.getForProject(projectId), null),
    wantsSlots ? safe("survey slots", () => takenSurveySlots(projectId, today), [] as string[]) : Promise.resolve([] as string[]),
    wantsBlocks ? safe("install dates", () => bookedInstallDates(projectId, today), [] as string[]) : Promise.resolve([] as string[]),
  ]);

  // Photos: staff faces, the end-of-day updates, and pictures on customer-visible issues.
  const people = [surveyorStaff, ...crewStaff].filter((s): s is StaffMember => Boolean(s));
  const staffPhotoIds = new Set(people.map((s) => s.photoMediaId).filter((id): id is string => Boolean(id)));
  const projectPhotoIds = new Set<string>([
    ...project.install.days.flatMap((d) => d.customerUpdate?.mediaIds ?? []),
    ...issues.flatMap((i) => i.mediaIds),
  ]);
  const media = await safe("media", () => mediaRepo.listByIds([...staffPhotoIds, ...projectPhotoIds]), [] as MediaItem[]);
  // Only this project's own files (or a staff member's portrait), whatever an id list claims.
  const allowed = media.filter((m) => (staffPhotoIds.has(m.id) && !m.projectId) || (projectPhotoIds.has(m.id) && m.projectId === projectId));
  const urls = await safe("media urls", () => signedMediaUrls(allowed, 4 * 3600), new Map<string, string>());
  const photoById = new Map(allowed.map((m) => [m.id, toPhoto(m, urls.get(m.id) ?? null)]));
  const photoUrl = (s: StaffMember | null | undefined) => (s?.photoMediaId ? (photoById.get(s.photoMediaId)?.url ?? null) : null);

  const surveyor: PersonCard | null = project.survey.surveyor
    ? surveyorStaff
      ? personCard(surveyorStaff, today, { role: "surveyor", photoUrl: photoUrl(surveyorStaff) })
      : { name: project.survey.surveyor.name, role: "Surveyor", photoUrl: null, qualifications: [] }
    : null;
  const crew = project.booking.crew.map((m) => {
    const staff = crewStaff.find((s) => s.id === m.staffId);
    return staff
      ? personCard(staff, today, { role: m.role, photoUrl: photoUrl(staff) })
      : { name: m.name, role: m.role === "tech-lead" ? "Technical lead" : m.role.charAt(0).toUpperCase() + m.role.slice(1), photoUrl: null, qualifications: [] };
  });

  const liveInvoices: HubInvoice[] = invoices
    .filter((i) => i.status !== "draft" && i.status !== "void")
    .map((i) => ({
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: i.status,
      totalPence: i.totalPence,
      paidPence: i.paidPence,
      ...(i.dueOn ? { dueOn: i.dueOn } : {}),
      ...(i.issuedAt ? { issuedAt: i.issuedAt } : {}),
      ...(i.documentId ? { documentId: i.documentId } : {}),
    }));
  // F5's outstandingPence when it exists; the same sum otherwise.
  const outstanding = liveInvoices.length
    ? ((await safe("outstanding", async () => outstandingPence(invoices), null as number | null)) ?? outstandingOf(liveInvoices))
    : Math.max(0, project.money.invoicedPence - project.money.paidPence);
  const moneyView = liveInvoices.length
    ? {
        invoicedPence: liveInvoices.reduce((s, i) => s + i.totalPence, 0),
        paidPence: liveInvoices.reduce((s, i) => s + i.paidPence, 0),
        outstandingPence: outstanding,
      }
    : { invoicedPence: project.money.invoicedPence, paidPence: project.money.paidPence, outstandingPence: outstanding };

  const commissioning = job?.commissioning
    ? {
        at: job.commissioning.at,
        by: job.commissioning.signedBy.name,
        ...(job.commissioning.signedBy.qualificationRef ? { qualificationRef: job.commissioning.signedBy.qualificationRef } : {}),
        systems: job.commissioning.results.length,
      }
    : null;

  const viewer: HubData["viewer"] =
    access.kind === "staff" ? { kind: "staff", name: access.staff.name } : { kind: "customer" };

  return {
    ...hubFacts(project, settings, today),
    project,
    today,
    nowIso,
    viewer,
    surveyor,
    crew,
    surveySlots: wantsSlots ? surveySlotDays({ settings, nowWall: londonWallClock(), taken }) : [],
    installBlocks: wantsBlocks ? installBlockOptions({ project: raw, settings, today, booked }) : [],
    earliestStart: earliestOfferedStart(raw, today, settings),
    documents: documents.map(toHubDocument),
    issues: issues.map((i) => toHubIssue(i, photoById)),
    invoices: liveInvoices,
    money: moneyView,
    photos: Object.fromEntries([...projectPhotoIds].map((id) => [id, photoById.get(id) ?? { id, url: null }])),
    commissioning,
  };
}

/* ------------------------------------------------------------------ */
/* "Your homes" on /portal                                             */
/* ------------------------------------------------------------------ */

export interface HomeSummary {
  id: string;
  addressLine: string;
  postcode: string;
  stage: ProjectStageId;
  stageTitle: string;
  next: { label: string; href?: string } | null;
  closed: boolean;
}

/** The signed-in customer's projects, newest first, each re-checked against the access rules. */
export async function customerHomes(): Promise<{ name: string; email: string; homes: HomeSummary[] } | null> {
  const session = await getSession();
  if (!session || session.kind !== "customer" || !getServiceClient()) return null;
  const fresh = await safe("homes", () => customersRepo.projectIdsFor(session.customerId), [] as string[]);
  const ids = [...new Set([...fresh, ...session.projectIds])];
  const homes: HomeSummary[] = [];
  for (const id of ids) {
    const access = await requireProjectAccess(id, { allowCustomer: true });
    if (!access || access.kind !== "customer") continue;
    const p = await loadProject(id);
    if (!p) continue;
    const stage = currentStage(p);
    homes.push({
      id,
      addressLine: p.customer.addressLine,
      postcode: p.customer.postcode,
      stage,
      stageTitle: STAGE_INFO[stage].title,
      next: customerNextAction(p),
      closed: p.closure.closed,
    });
  }
  return { name: session.name, email: session.email, homes };
}

/* ------------------------------------------------------------------ */
/* Sign-in links                                                       */
/* ------------------------------------------------------------------ */

export type LinkTarget = { kind: "project"; projectId: string } | { kind: "document"; documentId: string } | { kind: "email"; email: string };

export interface LinkResult {
  /** Development only: the link itself, since nothing was emailed. */
  devLink?: string;
  emailLive: boolean;
}

/**
 * The address a project's sign-in link goes to, with the customer record
 * made (and attached to the project) on first use: a v1 project or one
 * created before its customer existed. Null when there's no usable address.
 */
async function customerEmailForProject(projectId: string): Promise<string | null> {
  const db = getServiceClient();
  if (!db || !isUuid(projectId)) return null;
  const { data: row } = await db.from("projects").select("id, customer_id").eq("id", projectId).maybeSingle();
  if (!row) return null;
  if (row.customer_id) {
    const customer = await customersRepo.get(String(row.customer_id));
    if (customer && isPlausibleEmail(customer.email)) return customer.email;
  }
  const project = await loadProject(projectId);
  const email = normaliseEmail(project?.customer.email ?? "");
  if (!project || !isPlausibleEmail(email)) return null;
  const customer = await customersRepo.findOrCreate({
    email,
    name: project.customer.name || undefined,
    phone: project.customer.phone,
  });
  await db.from("projects").update({ customer_id: customer.id }).eq("id", projectId).is("customer_id", null);
  return customer.email;
}

/**
 * Email a sign-in link for a project, a document or an address. The
 * answer is the same whether or not anything matched (no hints about who's
 * a customer or what exists); the address is never shown back. Failures
 * are logged, never surfaced.
 */
export async function sendSignInLink(target: LinkTarget): Promise<LinkResult> {
  const emailLive = emailConfigured();
  try {
    let email: string | null = null;
    let next = "/portal";
    if (target.kind === "email") {
      email = normaliseEmail(target.email);
    } else if (target.kind === "project") {
      email = await customerEmailForProject(target.projectId);
      next = `/p/${target.projectId}`;
    } else {
      const doc = isUuid(target.documentId) ? await documentsRepo.get(target.documentId) : null;
      if (doc && isCustomerVisible(doc)) {
        email = await customerEmailForProject(doc.projectId);
        next = `/d/${doc.id}`;
      }
    }
    if (!email || !isPlausibleEmail(email)) return { emailLive };
    const result = await issueMagicLink({ email, kind: "customer", next });
    return { emailLive, ...(result.devLink ? { devLink: result.devLink } : {}) };
  } catch (err) {
    console.error("[portal] sign-in link failed:", err);
    return { emailLive };
  }
}

/* ------------------------------------------------------------------ */
/* Customer actions                                                    */
/* ------------------------------------------------------------------ */

export interface CustomerActor {
  customerId: string;
}

export type ActResult = { ok: true; message?: string } | { ok: false; error: string; status: number; blockers?: Blocker[] };

/** Only the blockers that are the customer's to act on: the rest are ours, and internal. */
const customerBlockers = (blockers: Blocker[] | undefined) => (blockers ?? []).filter((b) => b.owner === "customer");

async function act(projectId: string, actor: CustomerActor, name: string, action: ProjectAction): Promise<ActResult> {
  const result = await dispatch(projectId, action, { kind: "customer", customerId: actor.customerId, name });
  if ("error" in result) {
    const blockers = customerBlockers(result.blockers);
    return { ok: false, error: result.error, status: result.status, ...(blockers.length ? { blockers } : {}) };
  }
  return { ok: true };
}

/** Best-effort heads-up to the team inbox; never fails the customer's action. */
async function tellTeam(projectId: string, title: string, lines: string[], discriminator: string, urgent = false): Promise<void> {
  try {
    await notify("team-alert", { projectId, data: { title: oneLine(title, 140), lines, ...(urgent ? { urgent: true } : {}) }, discriminator });
  } catch (err) {
    console.error("[portal] team alert failed:", err);
  }
}

/**
 * Do what the customer asked on the hub. Everything they pick is checked
 * against what we'd offer them right now; the reducer then applies its own
 * rules on top.
 */
export async function customerAct(projectId: string, actor: CustomerActor, req: PortalRequest): Promise<ActResult> {
  const project = await loadProject(projectId);
  if (!project) return { ok: false, error: "Project not found", status: 404 };
  const settings = await getSettings();
  const today = londonToday();
  const name = customerName(project);

  switch (req.kind) {
    case "book-survey":
    case "reschedule-survey": {
      const taken = await takenSurveySlots(projectId, today);
      const days = surveySlotDays({ settings, nowWall: londonWallClock(), taken });
      if (!isOfferedSlot(days, req.scheduledFor)) {
        return { ok: false, error: "That slot isn't available any more. Please pick another.", status: 409 };
      }
      if (req.kind === "reschedule-survey") return act(projectId, actor, name, { type: "reschedule-survey", scheduledFor: req.scheduledFor });
      const booked = await act(projectId, actor, name, { type: "book-survey", scheduledFor: req.scheduledFor, mode: req.mode });
      if (!booked.ok || !req.documentsConsent || project.proposal.documentsByEmailConsent) return booked;
      const consent = await act(projectId, actor, name, { type: "documents-consent-recorded", channel: "portal" });
      return consent.ok
        ? booked
        : { ok: true, message: "Your survey is booked, but we couldn't save your email preference. Please tick it again under Proposal." };
    }

    case "documents-consent":
      return act(projectId, actor, name, { type: "documents-consent-recorded", channel: "portal" });

    case "install-dates": {
      const dates = req.dates.map((d) => d.slice(0, 10));
      const booked = await bookedInstallDates(projectId, today);
      const problem = blockProblem({ project, settings, today, booked, dates });
      if (problem) return { ok: false, error: problem, status: 409 };
      const moving = project.booking.dates.length > 0;
      const result = await act(projectId, actor, name, { type: "install-dates-set", startDate: dates[0]!, dates });
      if (result.ok) {
        await tellTeam(
          projectId,
          `Install dates ${moving ? "moved" : "chosen"}: ${name}, ${blockLabel(dates)}`,
          [
            moving && project.booking.dates.length ? `Was ${blockLabel(project.booking.dates)}.` : "Chosen on the portal.",
            "Next: assign a qualified crew and confirm the booking.",
          ],
          `install-dates:${dates.join(",")}`,
        );
      }
      return result;
    }

    case "prep":
      return act(projectId, actor, name, { type: "prep-toggled", itemId: req.itemId, done: req.done });

    case "feedback": {
      const result = await act(projectId, actor, name, {
        type: "feedback-submitted",
        score: req.score,
        ...(req.comments?.trim() ? { comments: req.comments.trim() } : {}),
      });
      if (result.ok) {
        await tellTeam(
          projectId,
          `Feedback from ${name}: ${req.score}/10`,
          req.comments?.trim() ? [`"${req.comments.trim().slice(0, 1000)}"`] : ["No comments."],
          `feedback:${new Date().toISOString()}`,
          req.score <= 6,
        );
      }
      return result;
    }

    case "early-start": {
      const result = await act(projectId, actor, name, { type: "early-start-requested", channel: "portal" });
      if (result.ok) {
        await tellTeam(
          projectId,
          `Early start asked for on the portal: ${name}`,
          [
            "It only counts once their own email (or a signed form) with the early-start wording is on file.",
            "When it arrives, record it as evidence on the project.",
          ],
          "early-start-requested",
        );
      }
      return result;
    }

    case "follow-ups":
      return act(projectId, actor, name, { type: "aftercare-opt-out", optedOut: req.optedOut });

    case "variation":
      return decideVariation(projectId, actor, req.issueId, req.decision);

    case "problem":
      return reportProblem(projectId, actor, req);
  }
}

/* ------------------------------------------------------------------ */
/* Variations                                                          */
/* ------------------------------------------------------------------ */

/**
 * The customer's yes or no to a priced variation. Only a customer-visible
 * variation on this project, still waiting for them, can be decided, once.
 * Records the decision and its history, tells the team, and nothing else:
 * invoicing an accepted variation is ours to do (F5).
 */
export async function decideVariation(
  projectId: string,
  actor: CustomerActor,
  issueId: string,
  decision: "accept" | "decline",
): Promise<ActResult> {
  const issue = isUuid(issueId) ? await issuesRepo.get(issueId) : null;
  if (!issue || issue.projectId !== projectId || issue.kind !== "variation" || !issue.customerVisible || !issue.variation) {
    return { ok: false, error: "Not found", status: 404 };
  }
  if (issue.variation.status !== "proposed") {
    return { ok: false, error: `You already ${issue.variation.status} this change.`, status: 409 };
  }
  if (!isOpen(issue)) return { ok: false, error: "This change has been withdrawn.", status: 409 };

  const project = await loadProject(projectId);
  const name = project ? customerName(project) : "The customer";
  const now = new Date().toISOString();
  const status = decision === "accept" ? "accepted" : "declined";
  const delta = money(issue.variation.totalDeltaPence);
  const next: Issue = {
    ...issue,
    variation: { ...issue.variation, status, decidedAt: now, decidedBy: name },
    history: [
      ...issue.history,
      {
        at: now,
        by: name,
        note: decision === "accept" ? `Accepted on the portal (${issue.variation.totalDeltaPence >= 0 ? "+" : ""}${delta}).` : "Declined on the portal.",
      },
    ],
  };
  try {
    await issuesRepo.update(next);
  } catch (err) {
    console.error(`[portal] variation ${issueId} decision failed to save:`, err);
    return { ok: false, error: "We couldn't save that just now. Please try again.", status: 502 };
  }
  await audit({
    actor: { kind: "customer", id: actor.customerId, name },
    action: `issue.variation-${status}`,
    entity: "issue",
    entityId: issueId,
    detail: { projectId, totalDeltaPence: issue.variation.totalDeltaPence },
  });
  await tellTeam(
    projectId,
    `Variation #${issue.number} ${status} by ${name}: ${issue.title}`,
    [
      `${issue.variation.description}`,
      `Price change: ${issue.variation.totalDeltaPence >= 0 ? "+" : ""}${delta} (including any VAT).`,
      decision === "accept" ? "Next: invoice the variation and let the crew know it's a go." : "Next: let the crew know it's a no, and carry on as agreed.",
    ],
    `variation:${issueId}:${status}`,
    true,
  );
  return { ok: true, message: decision === "accept" ? "Thanks. We've told the team it's a yes." : "Thanks. We've told the team it's a no, and we'll carry on as agreed." };
}

/* ------------------------------------------------------------------ */
/* Problems                                                            */
/* ------------------------------------------------------------------ */

/** The fields a portal-reported fault starts with: F6's defaults when they exist, else these. */
function faultDefaults(): ReturnType<typeof defaultsForKind> {
  try {
    return { ...defaultsForKind("fault"), customerVisible: true };
  } catch {
    // INTEGRATION(F6): defaultsForKind("fault") is a stub in this tree; these are the conservative defaults.
    return { severity: "medium", blocking: false, ownerRole: "ops", customerVisible: true };
  }
}

/**
 * "Report a problem": a fault issue the customer can see, with any photos
 * they uploaded through the portal (their own, on this project), and a
 * heads-up to the team.
 */
export async function reportProblem(
  projectId: string,
  actor: CustomerActor,
  input: { title: string; detail: string; mediaIds: string[] },
): Promise<ActResult> {
  const project = await loadProject(projectId);
  if (!project) return { ok: false, error: "Project not found", status: 404 };
  const name = customerName(project);
  const title = oneLine(input.title, 120);
  if (!title) return { ok: false, error: "Tell us briefly what's wrong.", status: 400 };

  const media = await mediaRepo.listByIds(input.mediaIds);
  const mine = media.filter((m) => m.projectId === projectId && m.source === "customer" && m.takenBy?.id === actor.customerId);
  if (mine.length !== new Set(input.mediaIds).size) {
    return { ok: false, error: "One of those photos didn't finish uploading. Remove it and try again.", status: 400 };
  }

  const now = new Date().toISOString();
  const d = faultDefaults();
  const issue: Issue = {
    id: crypto.randomUUID(),
    projectId,
    number: await issuesRepo.nextNumber(projectId),
    kind: "fault",
    title,
    ...(input.detail.trim() ? { detail: input.detail.trim().slice(0, 4000) } : {}),
    severity: d.severity,
    status: "open",
    blocking: d.blocking,
    ownerRole: d.ownerRole,
    nextAction: "Call the customer back and arrange a visit if needed",
    raisedBy: { kind: "customer", id: actor.customerId, name },
    raisedAt: now,
    mediaIds: mine.map((m) => m.id),
    customerVisible: true,
    history: [{ at: now, by: name, note: "Reported on the portal.", status: "open" }],
  };
  try {
    await issuesRepo.insert(issue);
  } catch (err) {
    console.error(`[portal] problem report on ${projectId} failed to save:`, err);
    return { ok: false, error: "We couldn't send that just now. Please try again, or call us.", status: 502 };
  }
  await audit({
    actor: { kind: "customer", id: actor.customerId, name },
    action: "issue.reported",
    entity: "issue",
    entityId: issue.id,
    detail: { projectId, kind: "fault", photos: issue.mediaIds.length },
  });
  await tellTeam(
    projectId,
    `Problem reported by ${name}: ${title}`,
    [
      ...(issue.detail ? [issue.detail.slice(0, 1000)] : []),
      `${issue.mediaIds.length} photo${issue.mediaIds.length === 1 ? "" : "s"} attached.`,
      "Next: call them back today.",
    ],
    `problem:${issue.id}`,
    true,
  );
  return { ok: true, message: "Thanks. It's with the team, and we'll call you back." };
}

/* ------------------------------------------------------------------ */
/* Route guard                                                         */
/* ------------------------------------------------------------------ */

export const portalJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * For app/api/portal/[projectId]/** routes: a JSON body, inside the rate
 * limit, from the project's own signed-in customer. Anyone else gets a 404
 * (never a hint the project exists); staff get a 403 saying where to make
 * changes instead, because these screens are the customer's own.
 */
export async function requirePortalCustomer(
  request: Request,
  projectId: string,
  scope: string,
  limit = 30,
  windowMs = 10 * 60_000,
): Promise<CustomerActor | Response> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return portalJson({ error: "Send JSON" }, 415);
  }
  const limited = enforceRateLimit(request, `portal-${scope}`, limit, windowMs);
  if (limited) return limited;
  if (!isUuid(projectId)) return portalJson({ error: "Not found" }, 404);
  const access = await requireProjectAccess(projectId, { allowCustomer: true });
  if (!access) return portalJson({ error: "Not found" }, 404);
  if (access.kind === "staff") {
    return portalJson({ error: "This is the customer's own screen. Make changes from the project's command centre." }, 403);
  }
  return { customerId: access.customerId };
}

/** An ActResult as the route's JSON answer. */
export function actResponse(result: ActResult): Response {
  if (result.ok) return portalJson({ ok: true, ...(result.message ? { message: result.message } : {}) });
  return portalJson({ ok: false, error: result.error, ...(result.blockers ? { blockers: result.blockers } : {}) }, result.status);
}
