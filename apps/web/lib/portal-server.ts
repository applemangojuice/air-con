import {
  can,
  documentsConsentCovers,
  canonicalJson,
  currentStage,
  customerNextAction,
  defaultsForKind,
  documentCompany,
  documentCustomer,
  earliestKitArrival,
  isFullName,
  isOpen,
  variationAgreeWording,
  variationContent,
  transitionIssue,
  outstandingPence,
  STAGE_INFO,
  type Blocker,
  type DocumentRecord,
  type HandoverPackSnapshot,
  type Issue,
  type MediaItem,
  type PilotSettings,
  type Project,
  type ProjectAction,
  type ProjectStageId,
  type StaffMember,
  type VariationAcceptance,
} from "@aircon/domain";
import { audit } from "./audit";
import { isPlausibleEmail, normaliseEmail } from "./auth/access";
import { demoModeAllowed } from "./auth/demo-guard";
import { issueMagicLink } from "./auth/magic";
import type { EmailPool } from "./email-budget";
import { getSession, requireProjectAccess, type ProjectAccess } from "./auth/server";
import { notify } from "./comms/outbox";
import { onTheWayChannel } from "./comms/on-the-way";
import { createDocument, isCustomerVisible, listDocuments } from "./documents-server";
import { emailConfigured } from "./email";
import { money } from "./format";
import { signedMediaUrls } from "./media-server";
import { cardAvailability } from "./money-server";
import { dispatch, loadProject, londonToday } from "./project-service";
import { isUuid, type Row } from "./repo/base";
import * as customersRepo from "./repo/customers";
import * as documentsRepo from "./repo/documents";
import * as installJobsRepo from "./repo/installJobs";
import * as invoicesRepo from "./repo/invoices";
import * as issuesRepo from "./repo/issues";
import * as mediaRepo from "./repo/media";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import * as staffRepo from "./repo/staff";
import { smsConfigured } from "./providers/sms";
import { enforceRateLimit } from "./rate-limit";
import { SETTINGS_UNAVAILABLE, getSettings, settingsForWrite } from "./settings-server";
import { getServiceClient } from "./supabase-server";
import {
  addDays,
  blockLabel,
  blockProblem,
  earliestOfferedStart,
  installBlockOptions,
  isOfferedSlot,
  datesWithNoSurveyor,
  londonWallClock,
  surveySlotDays,
} from "@/components/portal/schedule";
import type { HubData, HubDocument, HubInvoice, HubIssue, HubPack, HubPhoto, PersonCard, PortalRequest } from "@/components/portal/types";
import { customerSafeProject, hubFacts, personCard } from "@/components/portal/view";

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
    console.error(`[portal] ${label} failed:`, err);
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

/**
 * The days nobody can survey, from today on: every active surveyor-capable
 * person is on another live project's install crew that day.
 */
export async function noSurveyorDates(excludeProjectId: string, today: string): Promise<string[]> {
  const db = getServiceClient();
  if (!db) return [];
  const [staff, rows] = await Promise.all([
    staffRepo.list({ activeOnly: true, ...((await demoModeAllowed()) ? {} : { includeDemo: false }) }),
    db.from("projects").select("id, completed, project").not("install_on", "is", null).gte("install_on", addDays(today, -21)),
  ]);
  if (rows.error) throw new Error(`no-surveyor dates: ${rows.error.message}`);
  const surveyors = staff.filter((s) => can(s, "survey.conduct")).map((s) => s.id);
  const installs: { dates: string[]; crewIds: string[] }[] = [];
  for (const r of (rows.data ?? []) as Row[]) {
    if (String(r.id) === excludeProjectId || r.completed === true) continue;
    const snap = (r.project ?? {}) as Partial<Project>;
    if (snap.closure?.closed || snap.install?.status === "complete") continue;
    const crewIds = (snap.booking?.crew ?? []).map((c) => c.staffId).filter(Boolean);
    const dates = (snap.booking?.dates ?? []).filter((d): d is string => typeof d === "string" && d.slice(0, 10) >= today);
    if (crewIds.length && dates.length) installs.push({ dates, crewIds });
  }
  return datesWithNoSurveyor(installs, surveyors);
}

/** What the customer may book: other surveys' slots taken, and the days no surveyor is free. */
async function surveyLimits(projectId: string, today: string): Promise<{ taken: string[]; unavailableDates: string[] }> {
  const [taken, unavailableDates] = await Promise.all([
    takenSurveySlots(projectId, today),
    noSurveyorDates(projectId, today).catch((err: unknown) => {
      console.error("[portal] no-surveyor dates failed:", err);
      return [] as string[];
    }),
  ]);
  return { taken, unavailableDates };
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

/** The earliest the kit can all be at the customer's home, from the orders (purchasing's earliestKitArrival). */
async function kitArrival(projectId: string, today: string, settings: PilotSettings): Promise<string> {
  return earliestKitArrival(await purchaseOrdersRepo.listForProject(projectId), today, settings.scheduling.workingDays);
}

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

  const [documents, issues, invoices, crewStaff, surveyorStaff, job, slotLimits, booked, kitArrivesOn] = await Promise.all([
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
    wantsSlots
      ? safe("survey slots", () => surveyLimits(projectId, today), { taken: [] as string[], unavailableDates: [] as string[] })
      : Promise.resolve({ taken: [] as string[], unavailableDates: [] as string[] }),
    wantsBlocks ? safe("install dates", () => bookedInstallDates(projectId, today), [] as string[]) : Promise.resolve([] as string[]),
    wantsBlocks ? safe("kit arrival", () => kitArrival(projectId, today, settings), undefined as string | undefined) : Promise.resolve(undefined),
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

  const counted = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  // An invoice nothing is owed on because credit notes cover it: refunded (the refund's own
  // credit note) or credited. It reads as that, never as a bill "due" on its old date.
  const settledBy = (i: (typeof invoices)[number]): HubInvoice["settled"] => {
    if (i.kind === "credit-note" || i.status === "paid") return undefined;
    const against = counted.filter((c) => c.kind === "credit-note" && c.creditsInvoiceId === i.id);
    const credited = -against.reduce((sum, c) => sum + c.totalPence, 0);
    if (!against.length || credited < i.totalPence - Math.max(0, i.paidPence)) return undefined;
    return against.some((c) => /^Refunded:/.test(c.reason ?? "")) ? "refunded" : "credited";
  };
  const liveInvoices: HubInvoice[] = counted
    .map((i) => ({
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: i.status,
      totalPence: i.totalPence,
      paidPence: i.paidPence,
      ...(settledBy(i) ? { settled: settledBy(i) } : {}),
      ...(i.dueOn ? { dueOn: i.dueOn } : {}),
      ...(i.issuedAt ? { issuedAt: i.issuedAt } : {}),
      ...(i.documentId ? { documentId: i.documentId } : {}),
    }));
  // F5's outstandingPence: what's still owed on live invoices, net of credit notes.
  const outstanding = liveInvoices.length ? outstandingPence(invoices) : Math.max(0, project.money.invoicedPence - project.money.paidPence);
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

  const packDoc = documents.find((d) => d.kind === "handover-pack" && d.id === project.handover.packDocumentId) ??
    documents.find((d) => d.kind === "handover-pack");
  const packSnap = packDoc?.snapshot as Partial<HandoverPackSnapshot> | undefined;
  const pack: HubPack | null =
    packDoc && packSnap?.electricalCert && packSnap.maintenanceInfo && packSnap.warranty
      ? {
          documentId: packDoc.id,
          completedOn: String(packSnap.completedOn ?? ""),
          electricalCert: { ...packSnap.electricalCert, status: project.handover.electricalCert },
          maintenanceInfo: { ...packSnap.maintenanceInfo },
          warranty: {
            ...packSnap.warranty,
            registered: project.handover.warrantyRegistered,
            ...(project.handover.warrantyDueOn ? { dueOn: project.handover.warrantyDueOn } : {}),
          },
        }
      : null;

  const viewer: HubData["viewer"] =
    access.kind === "staff" ? { kind: "staff", name: access.staff.name } : { kind: "customer" };

  return {
    // How "on the way" will reach them: the same rule the outbox sends by (lib/comms/on-the-way.ts).
    ...hubFacts(project, settings, today, onTheWayChannel(raw.customer, { sms: smsConfigured(), email: emailConfigured() }), await cardAvailability()),
    project,
    today,
    nowIso,
    viewer,
    surveyor,
    crew,
    surveySlots: wantsSlots ? surveySlotDays({ settings, nowWall: londonWallClock(), ...slotLimits }) : [],
    installBlocks: wantsBlocks ? installBlockOptions({ project: raw, settings, today, booked, ...(kitArrivesOn ? { kitArrivesOn } : {}) }) : [],
    earliestStart: earliestOfferedStart(raw, today, settings, kitArrivesOn),
    documents: documents.map(toHubDocument),
    issues: issues.map((i) => toHubIssue(i, photoById)),
    invoices: liveInvoices,
    money: moneyView,
    photos: Object.fromEntries([...projectPhotoIds].map((id) => [id, photoById.get(id) ?? { id, url: null }])),
    commissioning,
    pack,
  };
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/** Every photo a document's snapshot refers to (proposal rooms, survey rooms and outdoor spots). */
export function documentMediaIds(doc: Pick<DocumentRecord, "kind" | "snapshot">): string[] {
  const s = (doc.snapshot ?? {}) as Record<string, unknown>;
  const ids: string[] = [];
  if (doc.kind === "proposal") {
    const options = ((s.proposal as { options?: unknown[] } | undefined)?.options ?? []) as {
      roomCards?: { mediaIds?: string[] }[];
      outdoorMediaIds?: string[];
    }[];
    for (const o of options) {
      for (const r of o.roomCards ?? []) ids.push(...(r.mediaIds ?? []));
      ids.push(...(o.outdoorMediaIds ?? []));
    }
  }
  if (doc.kind === "survey-report") {
    const data = ((s.survey as { data?: unknown } | undefined)?.data ?? {}) as {
      rooms?: { mediaIds?: string[] }[];
      outdoor?: { positions?: { mediaId?: string }[] };
    };
    for (const r of data.rooms ?? []) ids.push(...(r.mediaIds ?? []));
    for (const p of data.outdoor?.positions ?? []) if (p.mediaId) ids.push(p.mediaId);
  }
  if (doc.kind === "handover-pack") {
    for (const a of (s.asBuilt as { mediaId?: string }[] | undefined) ?? []) if (a?.mediaId) ids.push(a.mediaId);
  }
  if (doc.kind === "certificate") {
    ids.push(...(((s.certificate as { mediaIds?: string[] } | undefined)?.mediaIds ?? []) as string[]));
  }
  return [...new Set(ids.filter((id) => typeof id === "string"))];
}

export interface DocPhotoView {
  url: string | null;
  /** image/… or application/pdf (a certificate's file). */
  contentType?: string;
  annotations: MediaItem["annotations"];
  width?: number;
  height?: number;
  caption?: string;
}

/**
 * Signed photos for a document: only this project's own files. The
 * handover pack's as-built photos are the ones frozen into it at publish
 * (snapshot.asBuilt); a pack from before that was recorded falls back to the
 * customer-visible "finished" photos.
 */
export async function documentPhotos(doc: DocumentRecord): Promise<{ photos: Map<string, DocPhotoView>; asBuilt: DocPhotoView[] }> {
  const ids = documentMediaIds(doc);
  const frozen = doc.kind === "handover-pack" ? ((doc.snapshot as { asBuilt?: { mediaId: string }[] } | null)?.asBuilt ?? null) : null;
  const [referenced, live] = await Promise.all([
    safe("document media", () => mediaRepo.listByIds(ids), [] as MediaItem[]),
    doc.kind === "handover-pack" && !frozen
      ? safe("as-built media", () => mediaRepo.listForProject(doc.projectId, { tag: "completed", customerVisibleOnly: true }), [] as MediaItem[])
      : Promise.resolve([] as MediaItem[]),
  ]);
  const finished = frozen
    ? frozen.map((a) => referenced.find((m) => m.id === a.mediaId)).filter((m): m is MediaItem => Boolean(m))
    : live;
  const own = [...referenced, ...finished].filter((m) => m.projectId === doc.projectId);
  const urls = await safe("document media urls", () => signedMediaUrls(own, 4 * 3600), new Map<string, string>());
  const view = (m: MediaItem): DocPhotoView => ({
    url: urls.get(m.id) ?? null,
    contentType: m.contentType,
    annotations: m.annotations,
    ...(m.width ? { width: m.width } : {}),
    ...(m.height ? { height: m.height } : {}),
    ...(m.caption ? { caption: m.caption } : {}),
  });
  return {
    photos: new Map(own.filter((m) => ids.includes(m.id)).map((m) => [m.id, view(m)])),
    asBuilt: finished.filter((m) => m.projectId === doc.projectId).slice(0, 12).map(view),
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
    // A change waiting for their OK is an issue, not on the snapshot: the same next step as the hub's.
    const issues = await safe("homes issues", async () => (await issuesRepo.listForProject(id)).filter((i) => i.customerVisible), [] as Issue[]);
    homes.push({
      id,
      addressLine: p.customer.addressLine,
      postcode: p.customer.postcode,
      stage,
      stageTitle: STAGE_INFO[stage].title,
      next: customerNextAction(p, issues),
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
  /** Development, or a DEMO address on a demo deployment: the link itself, since nothing was emailed. */
  devLink?: string;
  emailLive: boolean;
  /** The shared email budget for links asked for from the website was used up: nothing went. */
  heldBack?: boolean;
}

/**
 * The address a project's sign-in link goes to: the project's own email,
 * exactly, and nothing else. An empty one means staff removed it (maybe a
 * wrong address someone else owns), so no link goes anywhere, whoever is
 * still attached. The customer record is made (and attached to the project)
 * on first use: a v1 project or one created before its customer existed. An
 * address that already has a record attaches nothing here: the project joins
 * that customer when they use the link (claimProjectOnSignIn). Null when
 * there's no usable address.
 */
async function customerEmailForProject(projectId: string): Promise<string | null> {
  const db = getServiceClient();
  if (!db || !isUuid(projectId)) return null;
  const { data: row } = await db.from("projects").select("id, customer_id").eq("id", projectId).maybeSingle();
  if (!row) return null;
  const project = await loadProject(projectId);
  const email = normaliseEmail(project?.customer.email ?? "");
  if (!project || !isPlausibleEmail(email)) return null;
  if (row.customer_id) return email;
  if (await customersRepo.getByEmail(email)) return email;
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
export async function sendSignInLink(target: LinkTarget, opts: { budget?: EmailPool } = {}): Promise<LinkResult> {
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
    const result = await issueMagicLink({ email, kind: "customer", next, ...(opts.budget ? { budget: opts.budget } : {}) });
    return { emailLive, ...(result.devLink ? { devLink: result.devLink } : {}), ...(result.heldBack ? { heldBack: true } : {}) };
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
  // Slots, install days and the cancellation period are worked out on settings: never on the fallback defaults.
  const settings = await settingsForWrite();
  if (!settings) return { ok: false, error: SETTINGS_UNAVAILABLE, status: 503 };
  const today = londonToday();
  const name = customerName(project);

  switch (req.kind) {
    case "book-survey":
    case "reschedule-survey": {
      const limits = await surveyLimits(projectId, today);
      const days = surveySlotDays({ settings, nowWall: londonWallClock(), ...limits });
      if (!isOfferedSlot(days, req.scheduledFor)) {
        return { ok: false, error: "That slot isn't available any more. Please pick another.", status: 409 };
      }
      if (req.kind === "reschedule-survey") return act(projectId, actor, name, { type: "reschedule-survey", scheduledFor: req.scheduledFor });
      const booked = await act(projectId, actor, name, { type: "book-survey", scheduledFor: req.scheduledFor, mode: req.mode });
      if (!booked.ok || !req.documentsConsent || documentsConsentCovers(project)) return booked;
      const consent = await act(projectId, actor, name, { type: "documents-consent-recorded", channel: "portal" });
      return consent.ok
        ? booked
        : { ok: true, message: "Your survey is booked, but we couldn't save your email preference. Please tick it again under Proposal." };
    }

    case "documents-consent":
      return act(projectId, actor, name, { type: "documents-consent-recorded", channel: "portal" });

    case "install-dates": {
      const dates = req.dates.map((d) => d.slice(0, 10));
      const [booked, kitArrivesOn] = await Promise.all([bookedInstallDates(projectId, today), kitArrival(projectId, today, settings)]);
      const problem = blockProblem({ project, settings, today, booked, dates, ...(kitArrivesOn ? { kitArrivesOn } : {}) });
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
      return decideVariation(projectId, actor, req.issueId, req.decision, {
        ...(req.name !== undefined ? { name: req.name } : {}),
        ...(req.agreed !== undefined ? { agreed: req.agreed } : {}),
      });

    case "problem":
      return reportProblem(projectId, actor, req);
  }
}

/* ------------------------------------------------------------------ */
/* Variations                                                          */
/* ------------------------------------------------------------------ */

/** sha256 hex of a string (Web Crypto: the same in Node and the browser). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface VariationAnswer {
  /** Accepting: the customer's full name, typed. */
  name?: string;
  /** Accepting: they pressed the "I agree to pay …" button (variationAgreeWording). */
  agreed?: boolean;
  ip?: string;
  userAgent?: string;
}

/**
 * The customer's yes or no to a priced variation. Only a customer-visible
 * variation on this project, still waiting for them, can be decided, once.
 *
 * A yes is an agreement to pay for extra work, so it's made like the
 * contract: their typed full name and the "I agree to pay £X more" button
 * (reg 14), recorded with when, from where, the words they agreed to and a
 * fingerprint of the change as shown. It then gets its own customer-visible
 * variation document and an email copy (their durable record), and the team
 * hears. Invoicing an accepted variation is ours to do (F5). A no is one tap.
 */
export async function decideVariation(
  projectId: string,
  actor: CustomerActor,
  issueId: string,
  decision: "accept" | "decline",
  answer: VariationAnswer = {},
): Promise<ActResult> {
  const issue = isUuid(issueId) ? await issuesRepo.get(issueId) : null;
  if (!issue || issue.projectId !== projectId || issue.kind !== "variation" || !issue.customerVisible || !issue.variation) {
    return { ok: false, error: "Not found", status: 404 };
  }
  if (issue.variation.status !== "proposed") {
    // The same answer again (a retry after a lost reply, or a page that hadn't caught up): it's saved, say so.
    const same = (decision === "accept" && issue.variation.status === "accepted") || (decision === "decline" && issue.variation.status === "declined");
    if (same) return { ok: true, message: decision === "accept" ? "You've already said yes to this change: it's saved." : "You've already said no to this change: it's saved." };
    return { ok: false, error: `You already ${issue.variation.status} this change.`, status: 409 };
  }
  if (!isOpen(issue)) return { ok: false, error: "This change has been withdrawn.", status: 409 };
  const typedName = answer.name?.trim().replace(/\s+/g, " ") ?? "";
  if (decision === "accept") {
    if (!isFullName(typedName)) return { ok: false, error: "Type your first name and surname to agree to this change.", status: 422 };
    if (answer.agreed !== true) return { ok: false, error: `Press "${variationAgreeWording(issue.variation)}" to agree to this change.`, status: 422 };
  }

  const project = await loadProject(projectId);
  // A yes gets its document, which freezes the company's details: read them before anything is saved.
  const settings = decision === "accept" ? await settingsForWrite() : null;
  if (decision === "accept" && !settings) return { ok: false, error: SETTINGS_UNAVAILABLE, status: 503 };
  const name = project ? customerName(project) : "The customer";
  const now = new Date().toISOString();
  const status = decision === "accept" ? "accepted" : "declined";
  const acceptance: VariationAcceptance | undefined =
    decision === "accept"
      ? {
          at: now,
          name: typedName,
          wording: variationAgreeWording(issue.variation),
          contentHash: await sha256Hex(canonicalJson(variationContent(issue))),
          priceDeltaNetPence: issue.variation.priceDeltaNetPence,
          taxPence: issue.variation.taxPence,
          totalDeltaPence: issue.variation.totalDeltaPence,
          ...(answer.ip ? { ip: answer.ip } : {}),
          ...(answer.userAgent ? { userAgent: answer.userAgent.slice(0, 300) } : {}),
        }
      : undefined;
  const delta = money(issue.variation.totalDeltaPence);
  // The decision moves the issue on (F6's transitionIssue): accepted is work to do, declined is settled.
  const moved = transitionIssue(
    issue,
    decision === "accept" ? "in-progress" : "resolved",
    name,
    decision === "accept"
      ? `Accepted on the portal (${issue.variation.totalDeltaPence >= 0 ? "+" : ""}${delta}). Go ahead with the change.`
      : "Declined on the portal. Carry on as agreed.",
    now,
  );
  const next: Issue = {
    ...moved,
    variation: { ...issue.variation, status, decidedAt: now, decidedBy: acceptance ? typedName : name, ...(acceptance ? { acceptance } : {}) },
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
    detail: {
      projectId,
      totalDeltaPence: issue.variation.totalDeltaPence,
      ...(acceptance ? { typedName: acceptance.name, wording: acceptance.wording, contentHash: acceptance.contentHash, ip: acceptance.ip ?? null } : {}),
    },
  });
  if (acceptance && project && settings) await recordAcceptedVariation(project, next, acceptance, settings);
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
  return {
    ok: true,
    message:
      decision === "accept"
        ? "Thanks. We've told the team it's a yes. Your copy of the change is in your documents, and we've emailed it to you."
        : "Thanks. We've told the team it's a no, and we'll carry on as agreed.",
  };
}

/**
 * The accepted change's durable record: a customer-visible variation
 * document (the agreement as made, frozen) and the customer's email copy.
 * Best-effort, like the contract document: the decision is already saved,
 * and a failure here is logged for ops to put right.
 */
async function recordAcceptedVariation(project: Project, issue: Issue, acceptance: VariationAcceptance, settings: PilotSettings): Promise<void> {
  const v = issue.variation!;
  const contract = (await listDocuments(project.id, { kind: "contract", customerVisibleOnly: true }).catch(() => []))[0];
  const contractTotal = project.proposal.contractTotalPence ?? project.money.contractTotalPence;
  let documentId: string | undefined;
  try {
    const doc = await createDocument(
      project.id,
      "variation",
      {
        company: documentCompany(settings),
        customer: documentCustomer(project),
        issuedAt: acceptance.at,
        issue: { id: issue.id, number: issue.number, kind: issue.kind, title: issue.title, ...(issue.detail ? { detail: issue.detail } : {}), raisedAt: issue.raisedAt, mediaIds: issue.mediaIds, variation: v },
        ...(contract ? { contractRef: contract.ref } : {}),
        ...(contractTotal !== undefined ? { contractTotalPence: contractTotal } : {}),
      },
      { title: `Change #${issue.number}: ${issue.title}`, customerVisible: true, createdBy: acceptance.name },
    );
    documentId = doc.id;
  } catch (err) {
    console.error(`[portal] variation ${issue.id} accepted, but its document failed:`, err);
  }
  try {
    await notify("variation-accepted", {
      projectId: project.id,
      data: {
        title: issue.title,
        description: v.description,
        issueNumber: issue.number,
        priceDeltaNetPence: v.priceDeltaNetPence,
        taxPence: v.taxPence,
        totalDeltaPence: v.totalDeltaPence,
        acceptedAt: acceptance.at,
        name: acceptance.name,
        wording: acceptance.wording,
        ...(contractTotal !== undefined ? { newContractTotalPence: contractTotal + v.totalDeltaPence } : {}),
      },
      discriminator: issue.id,
      ...(documentId ? { path: `/d/${documentId}` } : {}),
    });
  } catch (err) {
    console.error(`[portal] variation ${issue.id} accepted, but its confirmation email failed:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Problems                                                            */
/* ------------------------------------------------------------------ */

/** The fields a portal-reported fault starts with: the domain's fault defaults, always visible to the customer who reported it. */
function faultDefaults(): ReturnType<typeof defaultsForKind> {
  return { ...defaultsForKind("fault"), customerVisible: true };
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
  const access = await requireProjectAccess(projectId, { allowCustomer: true, customerSide: true });
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
