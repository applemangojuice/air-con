import { z } from "zod";
import {
  PD_CHECKS,
  can,
  diffSelfSurvey,
  electricsFinding,
  emptyMeasuredSurvey,
  idempotencyKey,
  isOpen,
  migrateProject,
  normaliseAddress,
  prefillFromPropertyIntel,
  surveyCompleteness,
  type Blocker,
  type Issue,
  type MeasuredSurvey,
  type MessageRecord,
  type Project,
  type SelfSurveyDiffRow,
  type StaffMember,
  type Survey,
  type SurveyCompleteness,
  type SurveyRecord,
  type TimeEntry,
} from "@aircon/domain";
import { staffCanAccessProject, type AssignmentView } from "./auth/access";
import { audit } from "./audit";
import { notify } from "./comms/outbox";
import { renderMessage, templateContext } from "./comms/templates";
import { appMode } from "./env-mode";
import { listProjectMedia, type MediaWithUrl } from "./media-server";
import { dispatch, loadProject } from "./project-service";
import { db, isUuid, must, nowIso, type Row } from "./repo/base";
import * as issuesRepo from "./repo/issues";
import * as mediaRepo from "./repo/media";
import * as messagesRepo from "./repo/messages";
import * as surveysRepo from "./repo/surveys";
import * as timeRepo from "./repo/time";
import { getSettings } from "./settings-server";

/**
 * The surveyor's visit on the server (F2): the draft measured survey, its
 * autosave with an optimistic check, starting and submitting the visit,
 * the "on my way" text, the documents-by-email consent and the stop-work
 * issues a survey can raise. Routes under app/api/field/survey call these
 * after their own guard (survey.conduct plus access to the project).
 *
 * The draft is one `surveys` row per version. Its `updated_at` is the
 * concurrency token: a save says which version it was based on, and a save
 * based on anything older is refused with the current copy, never merged
 * blindly. The phone keeps its own copy too, so a refusal never loses work.
 */

/* ------------------------------------------------------------------ */
/* The measured survey, validated                                      */
/* ------------------------------------------------------------------ */

const text = (max: number) => z.string().max(max);
const optText = (max: number) => z.string().max(max).optional();
const measure = (min: number, max: number) => z.number().min(min).max(max).optional();
const mediaId = z.string().uuid();

const ROOM_TYPES = ["bedroom", "living-room", "kitchen-diner", "home-office", "loft-room", "conservatory", "other"] as const;
const FLOORS = ["ground", "first", "second-plus", "loft"] as const;
const OUTDOOR = ["ground-rear", "ground-side", "wall-bracket", "flat-roof", "balcony", "unsure"] as const;
const WALLS = ["solid-brick", "cavity", "timber-frame", "stone", "concrete", "plasterboard", "unknown"] as const;
const ANSWER = z.enum(["yes", "no", "unsure"]);

/** Ids the client makes for rooms and outdoor positions (they key media and jump links). */
const localId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const MAX_ROOMS = 30;
export const MAX_POSITIONS = 10;
export const MAX_MEDIA_PER_ITEM = 40;

const roomSchema = z.object({
  id: localId,
  name: text(80),
  type: z.enum(ROOM_TYPES),
  floor: z.enum(FLOORS),
  include: z.boolean(),
  lengthM: measure(0, 50),
  widthM: measure(0, 50),
  areaM2: measure(0, 500),
  ceilingHeightM: measure(0, 10),
  glazing: z.enum(["low", "medium", "high"]),
  orientation: z.enum(["north", "east", "south", "west", "unsure"]),
  occupancy: z.enum(["low", "normal", "high"]).optional(),
  gainsNote: optText(500),
  hasExternalWall: z.boolean(),
  wallConstruction: z.enum(WALLS).optional(),
  pipeRunM: measure(0, 100),
  heightDropM: measure(-30, 30),
  route: z.enum(["through-wall", "external-trunking", "internal-concealed", "via-loft", "other"]).optional(),
  routeNote: optText(500),
  condensate: z.enum(["gravity", "pump", "tbc"]),
  condensateNote: optText(500),
  obstacles: optText(500),
  priority: z.enum(["quiet", "discreet", "fast-cooling", "heating"]).optional(),
  mediaIds: z.array(mediaId).max(MAX_MEDIA_PER_ITEM),
  selfSurveyRoomId: z.string().max(64).optional(),
});

const positionSchema = z.object({
  id: localId,
  label: text(120),
  location: z.enum(OUTDOOR),
  mediaId: mediaId.optional(),
  distanceToNeighbourWindowM: measure(0, 500),
  base: z.enum(["ground-feet", "wall-bracket", "slab", "roof-frame", "other"]),
  heightM: measure(0, 30),
  accessEquipment: z.enum(["none", "ladder", "tower", "scaffold"]),
  defrostDrainage: optText(500),
  chosen: z.boolean(),
  note: optText(500),
});

const pdShape = Object.fromEntries(PD_CHECKS.map((c) => [c.id, ANSWER.optional()])) as Record<
  (typeof PD_CHECKS)[number]["id"],
  z.ZodOptional<typeof ANSWER>
>;

export const measuredSurveySchema = z.object({
  version: z.literal(1),
  site: z.object({
    confirmedAddress: z.boolean(),
    decisionMaker: optText(120),
    ownerConfirmed: z.boolean(),
    tenure: z.enum(["owner", "leaseholder", "tenant", "unknown"]),
    accessNotes: optText(1000),
    parkingNotes: optText(1000),
    petsKids: optText(500),
    siteContactPhone: optText(40),
  }),
  wishes: z.object({
    priorities: z.array(z.enum(["quiet", "discreet", "heating", "cooling", "smart-control", "budget"])).max(6),
    heatingUse: z.enum(["main", "supplementary", "cooling-only-intent", "unsure"]),
    timing: optText(300),
    notes: optText(2000),
  }),
  house: z.object({
    type: z.enum(["detached", "semi-detached", "terraced", "flat", "bungalow"]),
    era: z.enum(["pre-1930", "1930-1950", "1950-2000", "2000+"]),
    wallConstruction: z.enum(WALLS),
    storeys: z.number().int().min(1).max(10),
    loftAccess: z.boolean(),
    listedOrConservation: z.enum(["no", "yes", "unknown"]),
    asbestosRisk: z.enum(["none-suspected", "possible", "suspected", "not-assessed"]),
    asbestosNote: optText(1000),
    notes: optText(2000),
  }),
  rooms: z.array(roomSchema).max(MAX_ROOMS),
  outdoor: z.object({ positions: z.array(positionSchema).max(MAX_POSITIONS) }),
  electrics: z.object({
    boardType: z.enum(["modern-rcbo", "modern-rcd", "older-fuse-box", "unknown"]),
    spareWays: z.number().int().min(0).max(60).optional(),
    earthing: z.enum(["TN-C-S", "TN-S", "TT", "unknown"]).optional(),
    cableRouteM: measure(0, 200),
    cableRouteNote: optText(1000),
    asbestosFlashGuard: z.enum(["no", "possible", "yes", "n/a"]),
    mediaIds: z.array(mediaId).max(MAX_MEDIA_PER_ITEM),
    notes: optText(2000),
  }),
  permissions: z.object({ pd: z.object(pdShape), notes: optText(2000) }),
  risks: z.object({
    workingAtHeight: z.boolean(),
    structuralConcern: z.boolean(),
    concealedServicesConcern: z.boolean(),
    notes: optText(2000),
    answered: z.array(z.enum(["workingAtHeight", "structuralConcern", "concealedServicesConcern"])).max(3).optional(),
  }),
  assumptions: z.array(text(300)).max(50),
  unknowns: z.array(text(300)).max(50),
});

/** Drop keys whose value is undefined, all the way down: the stored JSON stays clean. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A MeasuredSurvey from the browser, or the first problem in words. Unknown keys are dropped. */
export function parseMeasuredSurvey(input: unknown): { ok: true; data: MeasuredSurvey } | { ok: false; error: string } {
  const parsed = measuredSurveySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? issue.path.join(".") : "survey";
    return { ok: false, error: `That survey couldn't be saved: ${where} ${issue?.message ?? "is invalid"}.` };
  }
  const data = clean(parsed.data) as MeasuredSurvey;
  const roomIds = new Set<string>();
  for (const r of data.rooms) {
    if (roomIds.has(r.id)) return { ok: false, error: "Two rooms have the same id." };
    roomIds.add(r.id);
  }
  const positionIds = new Set<string>();
  for (const p of data.outdoor.positions) {
    if (positionIds.has(p.id)) return { ok: false, error: "Two outdoor positions have the same id." };
    positionIds.add(p.id);
  }
  return { ok: true, data };
}

/** Every media id the survey points at. */
export function referencedMediaIds(m: MeasuredSurvey): string[] {
  return [
    ...m.rooms.flatMap((r) => r.mediaIds),
    ...m.outdoor.positions.flatMap((p) => (p.mediaId ? [p.mediaId] : [])),
    ...m.electrics.mediaIds,
  ];
}

/** The survey with only the media ids in `allowed` (others' photos never ride along into a proposal). */
export function keepMedia(m: MeasuredSurvey, allowed: ReadonlySet<string>): MeasuredSurvey {
  const ok = (id: string) => allowed.has(id.toLowerCase()) || allowed.has(id);
  return {
    ...m,
    rooms: m.rooms.map((r) => ({ ...r, mediaIds: [...new Set(r.mediaIds.filter(ok))] })),
    outdoor: {
      positions: m.outdoor.positions.map((p) => {
        if (!p.mediaId || ok(p.mediaId)) return p;
        const { mediaId: _drop, ...rest } = p;
        return rest;
      }),
    },
    electrics: { ...m.electrics, mediaIds: [...new Set(m.electrics.mediaIds.filter(ok))] },
  };
}

async function onlyThisProjectsMedia(projectId: string, m: MeasuredSurvey): Promise<MeasuredSurvey> {
  const ids = referencedMediaIds(m);
  if (ids.length === 0) return m;
  const items = await mediaRepo.listByIds(ids);
  const allowed = new Set(items.filter((i) => i.projectId.toLowerCase() === projectId.toLowerCase()).map((i) => i.id.toLowerCase()));
  return keepMedia(m, allowed);
}

/* ------------------------------------------------------------------ */
/* Draft rows                                                          */
/* ------------------------------------------------------------------ */

export interface DraftState {
  record: SurveyRecord;
  /** The row's updated_at exactly as stored: the token the next save must quote. */
  updatedAt: string;
}

/** The project's live survey record (highest version) with its concurrency token. */
export async function loadDraft(projectId: string): Promise<DraftState | null> {
  if (!isUuid(projectId)) return null;
  const row = must(
    await db().from("surveys").select("*").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle(),
    "survey draft",
  ) as Row | null;
  if (!row) return null;
  return { record: surveysRepo.fromRow(row), updatedAt: String(row.updated_at ?? row.created_at ?? "") };
}

/** A fresh token, strictly after the one being replaced (two saves in one millisecond can't share it). */
export function nextToken(previous: string, now: Date = new Date()): string {
  const prev = Date.parse(previous);
  const ms = Number.isFinite(prev) ? Math.max(now.getTime(), prev + 1) : now.getTime();
  return new Date(ms).toISOString();
}

type Fail = { ok: false; status: number; error: string; blockers?: Blocker[] };
const fail = (status: number, error: string, blockers?: Blocker[]): Fail => ({ ok: false, status, error, ...(blockers ? { blockers } : {}) });

export type SaveResult =
  | { ok: true; updatedAt: string; completeness: SurveyCompleteness; record: SurveyRecord }
  | { ok: false; status: 409; error: string; conflict: true; current: DraftState }
  | Fail;

/**
 * Autosave. Writes only when the row is still the one the phone last saw
 * (`expectedUpdatedAt`); otherwise answers 409 with the current copy so the
 * phone can decide (its own copy is kept). A submitted survey is frozen.
 */
export async function saveDraft(
  projectId: string,
  input: unknown,
  expectedUpdatedAt: string,
  actor: StaffMember,
): Promise<SaveResult> {
  const parsed = parseMeasuredSurvey(input);
  if (!parsed.ok) return fail(400, parsed.error);
  const current = await loadDraft(projectId);
  if (!current) return fail(404, "There's no survey to save yet. Start the survey first.");
  if (current.record.status === "submitted") return fail(409, "This survey has been submitted, so it can't be changed.");
  if (current.updatedAt !== expectedUpdatedAt) {
    return { ok: false, status: 409, error: "The survey was changed somewhere else since this phone last saved.", conflict: true, current };
  }
  const data = await onlyThisProjectsMedia(projectId, parsed.data);
  const token = nextToken(current.updatedAt);
  const next: SurveyRecord = { ...current.record, data };
  const { data: rows, error } = await db()
    .from("surveys")
    .update({ ...surveysRepo.toRow(next), updated_at: token })
    .eq("id", current.record.id)
    .eq("updated_at", current.updatedAt)
    .select("*");
  if (error) return fail(502, "Couldn't save the survey. It's kept on this phone; we'll try again.");
  const saved = (rows ?? [])[0] as Row | undefined;
  if (!saved) {
    const latest = await loadDraft(projectId);
    if (latest) return { ok: false, status: 409, error: "The survey was changed somewhere else since this phone last saved.", conflict: true, current: latest };
    return fail(404, "The survey record has gone.");
  }
  await audit({ actor, action: "survey.save", entity: "survey", entityId: current.record.id, detail: { projectId } });
  return {
    ok: true,
    updatedAt: String(saved.updated_at ?? token),
    completeness: surveyCompleteness(data),
    record: surveysRepo.fromRow(saved),
  };
}

/* ------------------------------------------------------------------ */
/* What the customer said, and what the property record knows          */
/* ------------------------------------------------------------------ */

/** The customer's own survey from their quote, if it's readable. */
export async function loadSelfSurvey(quoteId: string): Promise<Survey | null> {
  if (!isUuid(quoteId)) return null;
  const row = must(await db().from("quote_requests").select("survey").eq("id", quoteId).maybeSingle(), "self survey") as Row | null;
  const survey = row?.survey as Survey | undefined;
  return survey && typeof survey === "object" && Array.isArray(survey.rooms) ? survey : null;
}

/** The property record's planning constraints for this address, when one exists. */
export async function loadPropertyConstraints(
  addressLine: string,
  postcode: string,
): Promise<{ conservationArea: boolean; listedBuilding: boolean; article4: boolean } | null> {
  if (!addressLine.trim() || !postcode.trim()) return null;
  const key = `${normaliseAddress(addressLine)} ${postcode.replace(/\s+/g, "").toUpperCase()}`;
  try {
    const { data } = await db().from("properties").select("intel").eq("address_key", key).limit(1).maybeSingle();
    const constraints = (data as Row | null)?.intel as { constraints?: Record<string, unknown> } | undefined;
    const c = constraints?.constraints;
    if (!c) return null;
    return { conservationArea: c.conservationArea === true, listedBuilding: c.listedBuilding === true, article4: c.article4 === true };
  } catch (err) {
    console.warn("[survey] property record lookup failed (continuing without):", (err as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Time log                                                            */
/* ------------------------------------------------------------------ */

async function openSurveyClock(projectId: string, staff: StaffMember): Promise<TimeEntry | null> {
  const open = await timeRepo.openForStaff(staff.id);
  if (open && open.projectId === projectId && open.kind === "survey") return open;
  const all = await timeRepo.listForProject(projectId);
  return all.find((e) => e.kind === "survey" && !e.endedAt && e.staffId === staff.id) ?? null;
}

async function startSurveyClock(projectId: string, staff: StaffMember, at: string): Promise<void> {
  try {
    if (await openSurveyClock(projectId, staff)) return;
    await timeRepo.insert({ id: crypto.randomUUID(), projectId, staffId: staff.id, staffName: staff.name, kind: "survey", startedAt: at });
  } catch (err) {
    console.error(`[survey] couldn't start the survey clock on ${projectId}:`, err);
  }
}

async function stopSurveyClock(projectId: string, staff: StaffMember, at: string): Promise<void> {
  try {
    const open = await openSurveyClock(projectId, staff);
    if (!open) return;
    const minutes = Math.max(0, Math.round((Date.parse(at) - Date.parse(open.startedAt)) / 60_000));
    await timeRepo.update({ ...open, endedAt: at, minutes });
  } catch (err) {
    console.error(`[survey] couldn't stop the survey clock on ${projectId}:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

export type StartResult = { ok: true; draft: DraftState; created: boolean } | Fail;

/**
 * "Start survey": tells the project (survey-started, which the customer
 * sees), creates the draft from the customer's own answers (and the
 * property record's designations), and starts the survey clock. Safe to
 * press twice or retry after a dropped connection: an in-progress survey
 * resumes its draft.
 */
export async function startSurvey(projectId: string, staff: StaffMember): Promise<StartResult> {
  const project = await loadProject(projectId);
  if (!project) return fail(404, "Not found");
  if (project.survey.status === "not-booked") return fail(409, "This survey isn't booked yet, so it can't start. Ask the office to book it.");
  if (project.survey.status === "submitted") return fail(409, "This survey has already been submitted.");

  if (!project.survey.surveyor) {
    const assigned = await dispatch(projectId, { type: "assign-surveyor", staffId: staff.id, name: staff.name }, staff);
    if ("error" in assigned) console.warn(`[survey] couldn't assign ${staff.id} as surveyor on ${projectId}:`, assigned.error);
  }
  if (project.survey.status === "booked") {
    const started = await dispatch(projectId, { type: "survey-started", by: staff.name }, staff);
    if ("error" in started) {
      // Lost a race with another start: carry on if it's now under way.
      const again = await loadProject(projectId);
      if (again?.survey.status !== "in-progress") return fail(started.status, started.error, started.blockers);
    }
  }

  const now = nowIso();
  const existing = await loadDraft(projectId);
  let draft: DraftState;
  let created = false;
  if (existing && existing.record.status === "draft") {
    draft = existing;
  } else {
    const self = await loadSelfSurvey(project.quoteId).catch(() => null);
    const constraints = await loadPropertyConstraints(project.customer.addressLine, project.customer.postcode);
    let data = emptyMeasuredSurvey(self ?? undefined);
    data = prefillFromPropertyIntel(data, constraints);
    // The office may already hold access and parking notes: start from them.
    if (project.customer.accessNotes) data.site.accessNotes = project.customer.accessNotes;
    if (project.customer.parkingNotes) data.site.parkingNotes = project.customer.parkingNotes;
    if (project.customer.phone) data.site.siteContactPhone = project.customer.phone;
    const record: SurveyRecord = {
      id: crypto.randomUUID(),
      projectId,
      version: (existing?.record.version ?? 0) + 1,
      status: "draft",
      data,
      surveyor: { staffId: staff.id, name: staff.name },
      startedAt: now,
    };
    const result = await surveysRepo.insertOrReuse(record);
    created = result.created;
    const loaded = await loadDraft(projectId);
    if (!loaded) return fail(502, "Couldn't create the survey record. Try again.");
    draft = loaded;
    if (created) await audit({ actor: staff, action: "survey.start", entity: "survey", entityId: record.id, detail: { projectId } });
  }
  await startSurveyClock(projectId, staff, draft.record.startedAt ?? now);
  return { ok: true, draft, created };
}

/* ------------------------------------------------------------------ */
/* On my way                                                           */
/* ------------------------------------------------------------------ */

export const ETA_CHOICES = [10, 20, 30, 45, 60] as const;
export const MAX_ETA_MINUTES = 240;

export type TextStatus =
  | { state: "sent"; to: string; at: string }
  | { state: "demo"; to: string; at: string }
  | { state: "queued"; to: string; at: string }
  | { state: "failed"; to: string; at: string; error?: string }
  | { state: "not-sent"; reason: string };

function statusOf(message: MessageRecord | null, reason: string): TextStatus {
  if (!message) return { state: "not-sent", reason };
  const at = message.sentAt ?? message.createdAt;
  switch (message.status) {
    case "sent":
      return { state: "sent", to: message.to, at };
    case "demo":
      return { state: "demo", to: message.to, at };
    case "queued":
      return { state: "queued", to: message.to, at };
    case "skipped":
      return { state: "not-sent", reason: "The text was switched off before it went." };
    default:
      return { state: "failed", to: message.to, at, ...(message.error ? { error: message.error } : {}) };
  }
}

/** Why no text exists for an on-my-way, in words. */
async function whyNoText(project: Project): Promise<string> {
  const settings = await getSettings();
  if (settings.comms.disabledEvents.includes("surveyor-on-my-way")) return "On-my-way texts are switched off in settings.";
  if (!project.customer.phone?.trim()) return "There's no mobile number on file for the customer, so no text went.";
  return "No text has been recorded for this.";
}

/** The text the customer gets for this ETA, exactly as the template writes it (sent from now). */
export async function onMyWayPreview(project: Project, etaMinutes: number, by: string, now: Date = new Date()): Promise<string> {
  const settings = await getSettings();
  const ctx = templateContext({ settings, portalUrl: "", project });
  const rendered = renderMessage("surveyor-on-my-way", ctx, { etaMinutes, at: now.toISOString(), name: by });
  return rendered.sms ?? rendered.text;
}

/** The latest on-my-way text for this survey slot, if one was sent. */
export async function onMyWayStatus(project: Project): Promise<{ etaMinutes: number; at: string; text: TextStatus } | null> {
  const omw = project.survey.onMyWay;
  if (!omw) return null;
  const key = idempotencyKey("surveyor-on-my-way", project.id, `${project.survey.scheduledFor ?? "-"}:${omw.etaMinutes}`, "sms");
  const message = await messagesRepo.findByKey(key).catch(() => null);
  return { etaMinutes: omw.etaMinutes, at: omw.at, text: statusOf(message, await whyNoText(project)) };
}

export type OnMyWayResult = { ok: true; etaMinutes: number; at: string; text: TextStatus; smsMode: "live" | "demo" } | Fail;

/** Record that the surveyor's on the way and text the customer (via the outbox), then say honestly what happened. */
export async function sendOnMyWay(projectId: string, etaMinutes: number, staff: StaffMember): Promise<OnMyWayResult> {
  const eta = Math.round(etaMinutes);
  if (!(eta >= 1 && eta <= MAX_ETA_MINUTES)) return fail(400, `Pick an ETA between 1 and ${MAX_ETA_MINUTES} minutes.`);
  const result = await dispatch(projectId, { type: "surveyor-on-my-way", etaMinutes: eta, by: staff.name }, staff);
  if ("error" in result) return fail(result.status, result.error, result.blockers);
  const status = await onMyWayStatus(result.project);
  return {
    ok: true,
    etaMinutes: eta,
    at: result.project.survey.onMyWay?.at ?? nowIso(),
    text: status?.text ?? { state: "not-sent", reason: "No text has been recorded for this." },
    smsMode: appMode().sms,
  };
}

/* ------------------------------------------------------------------ */
/* Documents by email                                                  */
/* ------------------------------------------------------------------ */

export type ConsentResult = { ok: true; consent: { at: string; channel: string }; email?: string } | Fail;

/**
 * The customer told the surveyor, in person, that they're happy to get the
 * proposal and contract documents by email. Optionally records the email
 * address they gave when none is on file. Never a contract signature: the
 * proposal comes later, by email, and is accepted online (CCR reg 5, P6).
 */
export async function recordDocumentsConsent(projectId: string, staff: StaffMember, email?: string): Promise<ConsentResult> {
  const project = await loadProject(projectId);
  if (!project) return fail(404, "Not found");
  if (email && !project.customer.email) {
    const contact = await dispatch(projectId, { type: "set-customer-contact", email }, staff);
    if ("error" in contact) return fail(contact.status, contact.error);
  }
  const result = await dispatch(projectId, { type: "documents-consent-recorded", channel: "in-person" }, staff);
  if ("error" in result) return fail(result.status, result.error, result.blockers);
  const consent = result.project.proposal.documentsByEmailConsent;
  if (!consent) return fail(502, "The consent wasn't recorded. Try again.");
  return { ok: true, consent, ...(result.project.customer.email ? { email: result.project.customer.email } : {}) };
}

/* ------------------------------------------------------------------ */
/* Stop-work issues                                                    */
/* ------------------------------------------------------------------ */

export const SURVEY_ISSUE_TOPICS = {
  asbestos: {
    title: "Suspected asbestos found at the survey",
    nextAction: "Arrange an asbestos survey and test before any drilling or electrical work.",
  },
  "flash-guard": {
    title: "Fuse board may have an asbestos flash guard",
    nextAction: "Have the board checked by a specialist before any electrical work.",
  },
  structural: {
    title: "Structural concern found at the survey",
    nextAction: "Technical lead to review fixings and the wall before design sign-off.",
  },
} as const;
export type SurveyIssueTopic = keyof typeof SURVEY_ISSUE_TOPICS;

export type IssueResult = { ok: true; issue: Pick<Issue, "id" | "number" | "title" | "status">; created: boolean } | Fail;

/**
 * Raise a stop-work issue from the survey: blocking for the install, owned
 * by the technical lead, never closed by the surveyor. Raising the same
 * topic again while it's open returns the open one. The team gets an alert.
 */
export async function raiseSurveyIssue(projectId: string, topic: SurveyIssueTopic, note: string, staff: StaffMember): Promise<IssueResult> {
  const spec = SURVEY_ISSUE_TOPICS[topic];
  if (!spec) return fail(400, "Unknown issue.");
  const project = await loadProject(projectId);
  if (!project) return fail(404, "Not found");
  const open = (await issuesRepo.listForProject(projectId)).find((i) => isOpen(i) && i.title === spec.title);
  if (open) return { ok: true, issue: { id: open.id, number: open.number, title: open.title, status: open.status }, created: false };
  const now = nowIso();
  const detail = note.trim().slice(0, 2000);
  // INTEGRATION(F6): take severity/blocking/owner from defaultsForKind("safety") once issues.ts lands.
  const issue: Issue = {
    id: crypto.randomUUID(),
    projectId,
    number: await issuesRepo.nextNumber(projectId),
    kind: "safety",
    title: spec.title,
    ...(detail ? { detail } : {}),
    severity: "critical",
    status: "open",
    blocking: true,
    gate: "ready-to-install",
    ownerRole: "tech-lead",
    nextAction: spec.nextAction,
    raisedBy: { kind: "staff", id: staff.id, name: staff.name },
    raisedAt: now,
    mediaIds: [],
    customerVisible: false,
    history: [{ at: now, by: staff.name, note: "Raised from the survey.", status: "open" }],
  };
  const saved = await issuesRepo.insert(issue);
  await audit({ actor: staff, action: "issue.raise", entity: "issue", entityId: saved.id, detail: { projectId, topic } });
  try {
    await notify("team-alert", {
      projectId,
      data: {
        title: `Stop work: ${spec.title.toLowerCase()} (${project.customer.name || "customer"})`,
        lines: [detail || "No detail given.", `Raised by ${staff.name} during the survey.`, `Next: ${spec.nextAction}`],
      },
      discriminator: `survey-issue:${saved.id}`,
    });
  } catch (err) {
    console.error("[survey] team alert for a stop-work issue failed:", err);
  }
  return { ok: true, issue: { id: saved.id, number: saved.number, title: saved.title, status: saved.status }, created: true };
}

/** Open stop-work issues raised from surveys on this project, by topic. */
export async function openSurveyIssues(projectId: string): Promise<Partial<Record<SurveyIssueTopic, { id: string; number: number }>>> {
  const titles = new Map(Object.entries(SURVEY_ISSUE_TOPICS).map(([k, v]) => [v.title as string, k as SurveyIssueTopic]));
  const out: Partial<Record<SurveyIssueTopic, { id: string; number: number }>> = {};
  try {
    for (const i of await issuesRepo.listForProject(projectId)) {
      const topic = titles.get(i.title);
      if (topic && isOpen(i)) out[topic] = { id: i.id, number: i.number };
    }
  } catch (err) {
    console.error("[survey] couldn't read issues:", err);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export type SubmitResult =
  | { ok: true; project: Project; record: SurveyRecord }
  | (Fail & { completeness?: SurveyCompleteness })
  | { ok: false; status: 409; error: string; conflict: true; current: DraftState };

/**
 * Submit: save the final copy, check it's complete, tell the project
 * (survey-submitted, which runs the survey-complete gate and emails the
 * customer), then freeze the record and stop the clock. The project goes
 * first so a refused gate leaves the draft editable; a retry after a
 * dropped connection finishes the job instead of failing.
 */
export async function submitSurvey(projectId: string, input: unknown, expectedUpdatedAt: string, staff: StaffMember): Promise<SubmitResult> {
  const project = await loadProject(projectId);
  if (!project) return fail(404, "Not found");
  let draft = await loadDraft(projectId);
  if (!draft) return fail(404, "There's no survey to submit.");

  const alreadyDone = project.survey.status === "submitted";
  if (alreadyDone && project.survey.surveyRecordId && project.survey.surveyRecordId !== draft.record.id) {
    return fail(409, "A different survey has already been submitted for this project.");
  }

  if (!alreadyDone && draft.record.status === "draft" && input !== undefined) {
    const saved = await saveDraft(projectId, input, expectedUpdatedAt, staff);
    if (!saved.ok) return saved;
    draft = { record: saved.record, updatedAt: saved.updatedAt };
  }

  const completeness = surveyCompleteness(draft.record.data);
  if (!alreadyDone && completeness.missing.length > 0) {
    return { ...fail(409, `The survey isn't finished: ${completeness.missing.length} thing${completeness.missing.length === 1 ? "" : "s"} still to do.`), completeness };
  }

  let latest = project;
  if (!alreadyDone) {
    const finding = electricsFinding(draft.record.data);
    const result = await dispatch(
      projectId,
      { type: "survey-submitted", surveyRecordId: draft.record.id, ...(finding ? { electrics: finding } : {}) },
      staff,
    );
    if ("error" in result) return fail(result.status, result.error, result.blockers);
    latest = result.project;
    // What the crew needs on the day, from the survey to the project.
    const site = draft.record.data.site;
    const contact: { accessNotes?: string; parkingNotes?: string } = {};
    if (site.accessNotes?.trim() && site.accessNotes.trim() !== (latest.customer.accessNotes ?? "")) contact.accessNotes = site.accessNotes.trim();
    if (site.parkingNotes?.trim() && site.parkingNotes.trim() !== (latest.customer.parkingNotes ?? "")) contact.parkingNotes = site.parkingNotes.trim();
    if (contact.accessNotes || contact.parkingNotes) {
      const updated = await dispatch(projectId, { type: "set-customer-contact", ...contact }, staff);
      if ("error" in updated) console.warn(`[survey] access notes not copied to ${projectId}:`, updated.error);
      else latest = updated.project;
    }
  }

  const now = nowIso();
  let record = draft.record;
  if (record.status !== "submitted") {
    const started = Date.parse(record.startedAt ?? project.survey.startedAt ?? now);
    const minutes = Number.isFinite(started) ? Math.max(0, Math.round((Date.parse(now) - started) / 60_000)) : undefined;
    record = await surveysRepo.update({
      ...record,
      status: "submitted",
      submittedAt: latest.survey.submittedAt ?? now,
      ...(minutes !== undefined ? { minutes } : {}),
      surveyor: record.surveyor ?? { staffId: staff.id, name: staff.name },
    });
    await audit({ actor: staff, action: "survey.submit", entity: "survey", entityId: record.id, detail: { projectId, minutes: record.minutes } });
  }
  await stopSurveyClock(projectId, staff, now);
  return { ok: true, project: latest, record };
}

/* ------------------------------------------------------------------ */
/* Page data                                                           */
/* ------------------------------------------------------------------ */

/** A media item as the survey screens use it: a read URL and the drawing. */
export interface SurveyMedia {
  id: string;
  url: string | null;
  tag: MediaWithUrl["tag"];
  roomId?: string;
  caption?: string;
  contentType: string;
  width?: number;
  height?: number;
  annotations: MediaWithUrl["annotations"];
  annotationsVersion: number;
  locked: boolean;
  takenAt: string;
  source: MediaWithUrl["source"];
}

export function toSurveyMedia(m: MediaWithUrl): SurveyMedia {
  return {
    id: m.id,
    url: m.url,
    tag: m.tag,
    ...(m.roomId ? { roomId: m.roomId } : {}),
    ...(m.caption ? { caption: m.caption } : {}),
    contentType: m.contentType,
    ...(m.width ? { width: m.width } : {}),
    ...(m.height ? { height: m.height } : {}),
    annotations: m.annotations,
    annotationsVersion: m.annotationsVersion,
    locked: m.locked,
    takenAt: m.takenAt,
    source: m.source,
  };
}

/** Read URLs last a working day: a long survey shouldn't see its thumbnails expire. */
export const SURVEY_MEDIA_URL_SECONDS = 8 * 60 * 60;

export interface SurveyVisit {
  project: Project;
  draft: DraftState | null;
  self: Survey | null;
  diff: SelfSurveyDiffRow[] | null;
  media: SurveyMedia[];
  onMyWay: Awaited<ReturnType<typeof onMyWayStatus>>;
  issues: Awaited<ReturnType<typeof openSurveyIssues>>;
  smsMode: "live" | "demo";
  canOpenOps: boolean;
}

/** Everything the visit screen needs, in one read. Null when the project doesn't exist. */
export async function loadSurveyVisit(projectId: string, staff: StaffMember): Promise<SurveyVisit | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [draft, self, media, onMyWay, issues] = await Promise.all([
    loadDraft(projectId),
    loadSelfSurvey(project.quoteId).catch(() => null),
    listProjectMedia(projectId, { expiresSec: SURVEY_MEDIA_URL_SECONDS }).catch((err) => {
      console.error("[survey] media list failed:", err);
      return [] as MediaWithUrl[];
    }),
    onMyWayStatus(project).catch(() => null),
    openSurveyIssues(projectId),
  ]);
  const diff = self && draft ? diffSelfSurvey(self, draft.record.data) : null;
  return {
    project,
    draft,
    self,
    diff,
    media: media.filter((m) => m.contentType.startsWith("image/")).map(toSurveyMedia),
    onMyWay,
    issues,
    smsMode: appMode().sms,
    canOpenOps: can(staff, "projects.view-all"),
  };
}

/** A row on the surveyor's list. */
export interface SurveyListItem {
  projectId: string;
  customerName: string;
  addressLine: string;
  postcode: string;
  status: Project["survey"]["status"];
  scheduledFor?: string;
  surveyorName?: string;
  mine: boolean;
  pilotLabel?: string;
}

/**
 * Surveys this person can work on: booked or under way, theirs first, then
 * by time. Staff with the board-wide view see every survey; everyone else
 * (subcontractors) only the ones they're assigned to.
 */
export async function listSurveysFor(staff: StaffMember): Promise<SurveyListItem[]> {
  const rows = must(
    await db().from("projects").select("id, project").eq("current_stage", "survey").eq("completed", false).limit(200),
    "survey list",
  ) as Row[] | null;
  const out: SurveyListItem[] = [];
  for (const row of rows ?? []) {
    let p: Project;
    try {
      p = migrateProject(row.project);
    } catch {
      continue;
    }
    if (p.survey.status !== "booked" && p.survey.status !== "in-progress") continue;
    if (!staffCanAccessProject(staff, p as AssignmentView, "survey.conduct")) continue;
    out.push({
      projectId: String(row.id),
      customerName: p.customer.name || "Customer",
      addressLine: p.customer.addressLine,
      postcode: p.customer.postcode,
      status: p.survey.status,
      ...(p.survey.scheduledFor ? { scheduledFor: p.survey.scheduledFor } : {}),
      ...(p.survey.surveyor?.name ? { surveyorName: p.survey.surveyor.name } : {}),
      mine: p.survey.surveyor?.staffId === staff.id,
      ...(p.pilot?.label ? { pilotLabel: p.pilot.label } : {}),
    });
  }
  const rank = (s: SurveyListItem) => (s.status === "in-progress" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || Number(b.mine) - Number(a.mine) || (a.scheduledFor ?? "~").localeCompare(b.scheduledFor ?? "~"));
}
