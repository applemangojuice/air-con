import {
  CAPACITY_OPTIONS_KW,
  QUALIFICATION_LABEL,
  applyDesignEdits,
  approveDesign,
  can,
  canonicalJson,
  designApprovalErrors,
  designInputsKey,
  draftDesign,
  hasCurrentQualification,
  hydrateDesign,
  layoutMediaIdsOf,
  meetsRequirement,
  recomputeVariant,
  type Annotation,
  type Blocker,
  type CatalogueItem,
  type CompatibilityRule,
  type DesignEdits,
  type DesignRecord,
  type MediaItem,
  type Project,
  type PropertyIntel,
  type StaffMember,
  type Survey,
  type SurveyRecord,
} from "@aircon/domain";
import { z } from "zod";
import { audit } from "./audit";
import { withoutCosts } from "./catalogue-server";
import { loadChecklist } from "./compliance-server";
import { signedMediaUrls } from "./media-server";
import { dispatch, loadProject, londonToday } from "./project-service";
import { db, isUuid } from "./repo/base";
import * as catalogueRepo from "./repo/catalogue";
import * as compatibilityRepo from "./repo/compatibility";
import * as designsRepo from "./repo/designs";
import * as mediaRepo from "./repo/media";
import * as surveysRepo from "./repo/surveys";

/**
 * The design studio on the server (F3). The browser previews with the same
 * pure functions; this module is the authority:
 *
 *   load → draft (v1 from the measured survey) → save (a new version only
 *   when something changed) → submit for review → approve (tech lead with
 *   current F-gas; locks the layout photos; dispatches design-approved).
 *
 * Every write re-reads the latest version first and refuses a stale one, so
 * two people editing can't overwrite each other, and a retried save whose
 * first attempt did land is recognised instead of doubling up. Permissions
 * are checked by the caller (requireStaff + requireProjectAccess); this
 * module re-checks the qualification rules that the reducer relies on.
 */

export type DesignResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number; blockers?: Blocker[]; conflict?: boolean };

const fail = (error: string, status = 409, extra: { blockers?: Blocker[]; conflict?: boolean } = {}): { ok: false; error: string; status: number; blockers?: Blocker[]; conflict?: boolean } => ({
  ok: false,
  error,
  status,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Who's looking                                                       */
/* ------------------------------------------------------------------ */

export interface DesignViewer {
  staffId: string;
  name: string;
  canEdit: boolean;
  canApprove: boolean;
  /** Why "Approve" isn't offered, in plain words (when it isn't). */
  approveBlockedReason?: string;
  canSeeCosts: boolean;
  /** The approver's current F-gas reference, which goes on the signature. */
  qualificationRef?: string;
  qualificationLabel?: string;
}

export function viewerFor(staff: StaffMember, todayIso: string): DesignViewer {
  const fgas = staff.qualifications.find((q) => q.kind === "fgas-cat1" && hasCurrentQualification({ qualifications: [q] }, "fgas-cat1", todayIso));
  const approve = can(staff, "design.approve") && meetsRequirement(staff, "tech-lead", todayIso);
  return {
    staffId: staff.id,
    name: staff.name,
    canEdit: can(staff, "design.edit"),
    canApprove: approve,
    ...(approve
      ? {}
      : {
          approveBlockedReason: !can(staff, "design.approve")
            ? "Approving needs a technical lead."
            : "Approving needs a current F-gas Category I certificate on your staff record.",
        }),
    canSeeCosts: can(staff, "finance.view-margin"),
    ...(fgas ? { qualificationRef: fgas.reference, qualificationLabel: QUALIFICATION_LABEL["fgas-cat1"] } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/** What a photo needs in the browser: no storage paths, a short-lived URL. */
export interface StudioMedia {
  id: string;
  url: string | null;
  annotations: Annotation[];
  width?: number;
  height?: number;
  caption?: string;
  tag: MediaItem["tag"];
  roomId?: string;
  locked: boolean;
  /** For the annotation editor's optimistic save (PATCH /api/media/<id>). */
  annotationsVersion: number;
}

export interface DesignHistoryEntry {
  id: string;
  version: number;
  status: DesignRecord["status"];
  createdAt: string;
  createdBy?: string;
  approvedBy?: string;
}

export interface DesignPageData {
  project: Project;
  survey: SurveyRecord | null;
  /** A newer survey version is being filled in (a re-survey). */
  surveyInProgress: boolean;
  design: DesignRecord | null;
  history: DesignHistoryEntry[];
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  media: StudioMedia[];
  hasIntel: boolean;
  /** The latest version, recomputed against today's catalogue, comes out different. */
  catalogueChanged: boolean;
  /** Layout photos of an approved design that aren't locked yet (a lock that failed). */
  unlockedLayout: string[];
}

/** Everything a design is checked against, recomputed on today's catalogue. */
export function designContentKey(d: Pick<DesignRecord, "rooms" | "variants" | "overrides" | "notes">): string {
  // Canonical (sorted keys): the stored side comes back from jsonb, which
  // reorders keys, while the recomputed side is in the order the code builds.
  return canonicalJson({ rooms: d.rooms, variants: d.variants, overrides: d.overrides, notes: d.notes ?? "" });
}

function recomputed(design: DesignRecord, catalogue: CatalogueItem[], compatibility: CompatibilityRule[]): DesignRecord {
  return { ...design, variants: design.variants.map((v) => recomputeVariant(design, v.id, catalogue, compatibility)) };
}

/** The customer's own survey, from the quote (null when there's none or it can't be read). */
async function baseSurveyFor(project: Project): Promise<Survey | null> {
  if (!isUuid(project.quoteId)) return null;
  try {
    const { data } = await db().from("quote_requests").select("survey").eq("id", project.quoteId).maybeSingle();
    const survey = (data as { survey?: unknown } | null)?.survey;
    return survey && typeof survey === "object" ? (survey as Survey) : null;
  } catch (err) {
    console.error(`[design] base survey for ${project.id} unreadable:`, err);
    return null;
  }
}

/** The property record, when the intelligence book holds this address. Optional: designs work without it. */
async function intelFor(project: Project): Promise<PropertyIntel | null> {
  const postcode = project.customer.postcode?.trim();
  const line = project.customer.addressLine?.trim();
  if (!postcode || !line) return null;
  try {
    const { data } = await db().from("properties").select("intel, address_line").eq("postcode", postcode.toUpperCase()).limit(50);
    const match = ((data ?? []) as { intel?: unknown; address_line?: string }[]).find(
      (r) => (r.address_line ?? "").trim().toLowerCase() === line.toLowerCase(),
    );
    return match?.intel && typeof match.intel === "object" ? (match.intel as PropertyIntel) : null;
  } catch {
    return null; // no intelligence table in this deployment: fine
  }
}

/** The survey a design is drawn from: the newest submitted version. */
async function submittedSurvey(projectId: string): Promise<{ survey: SurveyRecord | null; inProgress: boolean }> {
  const all = await surveysRepo.listForProject(projectId);
  const survey = all.find((s) => s.status === "submitted") ?? null;
  return { survey, inProgress: Boolean(all[0] && all[0].status !== "submitted" && survey && all[0].version > survey.version) };
}

/**
 * A record as the studio needs it: older ones (and the demo seed's) don't
 * carry the site facts or the survey baseline, so they're filled in from
 * the survey the design was drawn from. Never written back by itself: the
 * next save stores it, with checks recomputed.
 */
async function hydrated(design: DesignRecord, catalogue: CatalogueItem[], project?: Project | null): Promise<DesignRecord> {
  const complete = design.site && design.rooms.every((r) => r.survey) && design.variants.every((v) => v.manufacturer && v.systems.every((s) => s.layoutMediaIds));
  if (complete) return design;
  const survey = (design.surveyRecordId ? await surveysRepo.get(design.surveyRecordId) : null) ?? (await submittedSurvey(design.projectId)).survey;
  const intel = project && !design.site ? await intelFor(project) : null;
  return hydrateDesign(design, survey?.data, { catalogue, ...(intel ? { intel } : {}) });
}

/** The catalogue the browser gets: what designs pick from, plus anything the design already uses. Costs only for those who may see them. */
function catalogueForViewer(all: CatalogueItem[], design: DesignRecord | null, viewer: DesignViewer): CatalogueItem[] {
  const used = new Set(design ? design.variants.flatMap((v) => [...v.roomUnits.map((u) => u.indoorItemId), ...v.systems.map((s) => s.outdoorItemId), ...v.bom.map((b) => b.catalogueItemId ?? "")]) : []);
  return all
    .filter((i) => (i.kind === "indoor" || i.kind === "outdoor" || i.kind === "material") && (i.active || used.has(i.id)))
    .map((i) => {
      // The browser never needs the long provenance notes or the warranty text here.
      const { notes: _n, warranty: _w, sources: _s, ...slim } = i;
      const light = { ...slim, sources: [] } as CatalogueItem;
      return viewer.canSeeCosts ? light : withoutCosts(light);
    });
}

export async function loadDesignPage(projectId: string, viewer: DesignViewer): Promise<DesignPageData | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [{ survey, inProgress }, history, catalogue, compatibility] = await Promise.all([
    submittedSurvey(projectId),
    designsRepo.listForProject(projectId),
    catalogueRepo.list(),
    compatibilityRepo.list(),
  ]);
  const stored = history[0] ?? null;
  const design = stored ? await hydrated(stored, catalogue, project) : null;
  const active = design ? catalogue.filter((i) => i.active || designUses(design, i.id)) : catalogue.filter((i) => i.active);

  const mediaIds = new Set<string>();
  for (const r of survey?.data.rooms ?? []) for (const id of r.mediaIds) mediaIds.add(id);
  for (const p of survey?.data.outdoor.positions ?? []) if (p.mediaId) mediaIds.add(p.mediaId);
  if (design) for (const id of layoutMediaIdsOf(design)) mediaIds.add(id);
  const items = await mediaRepo.listByIds([...mediaIds]);
  const urls = await signedMediaUrls(items, 4 * 3600);
  const media: StudioMedia[] = items.map((m) => ({
    id: m.id,
    url: urls.get(m.id) ?? null,
    annotations: m.annotations,
    ...(m.width ? { width: m.width } : {}),
    ...(m.height ? { height: m.height } : {}),
    ...(m.caption ? { caption: m.caption } : {}),
    tag: m.tag,
    ...(m.roomId ? { roomId: m.roomId } : {}),
    locked: m.locked,
    annotationsVersion: m.annotationsVersion ?? 0,
  }));

  let catalogueChanged = false;
  if (design && design.status !== "approved" && design.status !== "superseded" && design.variants.length) {
    try {
      catalogueChanged = designContentKey(recomputed(design, active, compatibility)) !== designContentKey(stored!);
    } catch (err) {
      console.error(`[design] recompute check for ${projectId} failed:`, err);
    }
  }
  const unlockedLayout = design?.status === "approved" ? layoutMediaIdsOf(design).filter((id) => items.find((m) => m.id === id && !m.locked)) : [];

  return {
    project,
    survey,
    surveyInProgress: inProgress,
    design,
    history: history.map((d) => ({
      id: d.id,
      version: d.version,
      status: d.status,
      createdAt: d.createdAt,
      ...(d.createdBy ? { createdBy: d.createdBy } : {}),
      ...(d.approval ? { approvedBy: d.approval.name } : {}),
    })),
    catalogue: catalogueForViewer(catalogue, design, viewer),
    compatibility,
    media,
    hasIntel: Boolean(await intelFor(project)),
    catalogueChanged,
    unlockedLayout,
  };
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

const id = z.string().trim().min(1).max(120);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Unknown design");

export const designEditsSchema = z
  .object({
    rooms: z
      .array(
        z.object({
          roomId: id,
          chosenKw: z.number().refine((n) => (CAPACITY_OPTIONS_KW as readonly number[]).includes(n), "Pick one of the listed sizes"),
          pipeRunM: z.number().finite().min(0.5, "A pipe run is at least half a metre").max(100, "Pipe runs over 100 m aren't possible"),
          heightDiffM: z.number().finite().min(0).max(50),
          condensate: z.enum(["gravity", "pump"]),
          layoutMediaIds: z.array(id).max(20),
        }),
      )
      .max(20),
    variants: z
      .array(
        z.object({
          id,
          manufacturer: z.string().trim().max(80).optional(),
          roomUnits: z.array(z.object({ roomId: id, indoorItemId: z.string().trim().max(120) })).max(20),
          systems: z
            .array(
              z.object({
                id: id.optional(),
                outdoorItemId: z.string().trim().max(120),
                roomIds: z.array(id).max(20),
                outdoorPositionId: id.optional(),
                layoutMediaIds: z.array(id).max(20).optional(),
              }),
            )
            .max(20),
        }),
      )
      .min(1, "Keep at least one design option")
      .max(4),
    reasons: z.record(z.string().max(200), z.string().max(2000)),
    notes: z.string().max(8000).optional(),
  })
  .strict();

export const saveInputSchema = z
  .object({
    baseId: uuid,
    baseVersion: z.number().int().min(1),
    edits: designEditsSchema,
    submit: z.boolean().optional(),
  })
  .strict();

export const approveInputSchema = z
  .object({
    designId: uuid,
    version: z.number().int().min(1),
    combinationTableChecked: z.boolean(),
  })
  .strict();

const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "That didn't look right.";
};

/* ------------------------------------------------------------------ */
/* Drafting                                                            */
/* ------------------------------------------------------------------ */

/** Room photos with a drawing on them make the layout; without any, every room photo does (the reviewer can untick). */
async function preferAnnotated(design: DesignRecord): Promise<DesignRecord> {
  const items = await mediaRepo.listByIds(layoutMediaIdsOf(design));
  const drawn = new Set(items.filter((m) => m.annotations.length > 0).map((m) => m.id));
  const existing = new Set(items.map((m) => m.id));
  const pick = (ids: string[]) => {
    const real = ids.filter((m) => existing.has(m));
    const annotated = real.filter((m) => drawn.has(m));
    return annotated.length ? annotated : real;
  };
  return {
    ...design,
    rooms: design.rooms.map((r) => ({ ...r, layoutMediaIds: pick(r.layoutMediaIds) })),
    variants: design.variants.map((v) => ({ ...v, systems: v.systems.map((s) => ({ ...s, layoutMediaIds: pick(s.layoutMediaIds ?? []) })) })),
  };
}

/** Point the project at this version (design-updated). The reducer needs the survey submitted. */
async function pointProjectAt(projectId: string, design: DesignRecord, staff: StaffMember): Promise<DesignResult<Project>> {
  const status = design.status === "in-review" ? "in-review" : "draft";
  const result = await dispatch(projectId, { type: "design-updated", designId: design.id, version: design.version, status }, staff);
  if ("error" in result) return fail(result.error, result.status, result.blockers ? { blockers: result.blockers } : {});
  return { ok: true, value: result.project };
}

/** Mark older live versions superseded, so exactly one version is current. */
async function supersedeOlder(projectId: string, keepId: string): Promise<void> {
  for (const d of await designsRepo.listForProject(projectId)) {
    if (d.id === keepId || d.status === "superseded") continue;
    try {
      await designsRepo.update({ ...d, status: "superseded" });
    } catch (err) {
      console.error(`[design] couldn't supersede ${d.id}:`, err);
    }
  }
}

/**
 * Version 1 (or a fresh re-draft) from the newest submitted survey and the
 * active catalogue. Refuses when there's nothing to design from.
 */
export async function draftNewDesign(projectId: string, staff: StaffMember, opts: { manufacturer?: string } = {}): Promise<DesignResult<DesignRecord>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found", 404);
  if (project.proposal.status === "accepted") return fail("The proposal is accepted. Changes now go through a variation.");
  const { survey } = await submittedSurvey(projectId);
  if (!survey || project.survey.status !== "submitted") return fail("The survey needs submitting before there's anything to design from.");
  const [catalogue, compatibility, baseSurvey, intel, latest] = await Promise.all([
    catalogueRepo.listActive(),
    compatibilityRepo.list(),
    baseSurveyFor(project),
    intelFor(project),
    designsRepo.latestForProject(projectId),
  ]);
  if (!catalogue.some((i) => i.kind === "indoor")) return fail("The catalogue has no indoor units yet. Load the researched catalogue (or add units) first.");
  const manufacturer = opts.manufacturer?.trim() || undefined;
  const now = new Date().toISOString();
  const version = (latest?.version ?? 0) + 1;
  let record = draftDesign({
    projectId,
    id: crypto.randomUUID(),
    version,
    measured: survey.data,
    baseSurvey: baseSurvey ?? emptyBaseSurvey(project),
    catalogue,
    compatibility,
    ...(intel ? { intel } : {}),
    now,
    ...(manufacturer ? { manufacturer } : {}),
    surveyRecordId: survey.id,
    createdBy: staff.name,
  });
  record = await preferAnnotated(record);
  try {
    record = await designsRepo.insert(record);
  } catch (err) {
    console.error(`[design] draft insert for ${projectId} failed:`, err);
    return fail("Someone else started a design at the same moment. Reload to see it.", 409, { conflict: true });
  }
  await supersedeOlder(projectId, record.id);
  await audit({ actor: staff, action: "design.draft", entity: "design", entityId: record.id, detail: { projectId, version, surveyRecordId: survey.id, manufacturer: manufacturer ?? null } });
  const pointed = await pointProjectAt(projectId, record, staff);
  if (!pointed.ok) return fail(`Design v${version} is saved, but the project couldn't be updated: ${pointed.error}`, pointed.status);
  return { ok: true, value: record };
}

function emptyBaseSurvey(project: Project): Survey {
  return {
    postcode: project.customer.postcode,
    addressLine: project.customer.addressLine,
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 2, ownership: "owner" },
    rooms: [],
    outdoor: { location: "unsure", photos: [] },
    electrics: { condition: "unsure", photos: [] },
  };
}

/* ------------------------------------------------------------------ */
/* Saving and submitting                                               */
/* ------------------------------------------------------------------ */

/**
 * Save the studio's edits as the next version (only when something
 * changed, including a catalogue change that moves the checks), optionally
 * submitting it for review. Refuses a stale base; recognises a retry whose
 * first attempt landed.
 */
export async function saveDesign(projectId: string, staff: StaffMember, input: unknown): Promise<DesignResult<{ design: DesignRecord; unchanged: boolean }>> {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error), 400);
  const { baseId, baseVersion, edits, submit } = parsed.data;
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found", 404);
  if (project.proposal.status === "accepted") return fail("The proposal is accepted. Changes now go through a variation.");

  const [stored, latest, catalogue, compatibility] = await Promise.all([
    designsRepo.get(baseId),
    designsRepo.latestForProject(projectId),
    catalogueRepo.list(),
    compatibilityRepo.list(),
  ]);
  if (!stored || stored.projectId !== projectId || stored.version !== baseVersion) return fail("That design version isn't on this project.", 404);
  const base = await hydrated(stored, catalogue, project);
  const active = catalogue.filter((i) => i.active || designUses(base, i.id));
  const now = new Date().toISOString();
  const next = applyDesignEdits(base, edits as DesignEdits, { catalogue: active, compatibility, by: staff.name, at: now, id: crypto.randomUUID(), version: base.version + 1 });

  if (latest && latest.id !== base.id) {
    // A retry of a save that already landed: same content, one version on.
    if (latest.version === base.version + 1 && designInputsKey(latest) === designInputsKey(next)) {
      return finishSave(projectId, staff, latest, Boolean(submit), true);
    }
    return fail(`Someone saved a newer version (v${latest.version}) while you were working. Reload to see it; your changes are kept on this device until you do.`, 409, { conflict: true });
  }

  const changed = designContentKey(next) !== designContentKey(stored);
  if (!changed) return finishSave(projectId, staff, stored, Boolean(submit), true);

  // A design already in review stays in review when it's corrected; a draft stays a draft until submitted.
  const toInsert: DesignRecord = { ...next, status: submit || base.status === "in-review" ? "in-review" : "draft" };
  let saved: DesignRecord;
  try {
    saved = await designsRepo.insert(toInsert);
  } catch (err) {
    console.error(`[design] save for ${projectId} failed:`, err);
    return fail("Someone saved a newer version at the same moment. Reload to see it; your changes are kept on this device.", 409, { conflict: true });
  }
  await supersedeOlder(projectId, saved.id);
  // A proposal already issued from the superseded version keeps pointing at it (designId/designVersion): once this
  // version is approved, F4's builder flags it and "Revise" drafts afresh from the approved design.
  await audit({ actor: staff, action: submit ? "design.submit" : "design.save", entity: "design", entityId: saved.id, detail: { projectId, version: saved.version, from: base.version } });
  const pointed = await pointProjectAt(projectId, saved, staff);
  if (!pointed.ok) return fail(`Version ${saved.version} is saved, but the project couldn't be updated: ${pointed.error}`, pointed.status);
  return { ok: true, value: { design: saved, unchanged: false } };
}

const designUses = (d: DesignRecord, itemId: string) =>
  d.variants.some((v) => v.roomUnits.some((u) => u.indoorItemId === itemId) || v.systems.some((s) => s.outdoorItemId === itemId) || v.bom.some((b) => b.catalogueItemId === itemId));

/** Nothing new to store: maybe a status change (submit), and make sure the project points at this version. */
async function finishSave(projectId: string, staff: StaffMember, design: DesignRecord, submit: boolean, unchanged: boolean): Promise<DesignResult<{ design: DesignRecord; unchanged: boolean }>> {
  let current = design;
  if (submit && design.status === "draft") {
    current = await designsRepo.update({ ...design, status: "in-review" });
    await audit({ actor: staff, action: "design.submit", entity: "design", entityId: design.id, detail: { projectId, version: design.version } });
  }
  if (current.status === "approved") return { ok: true, value: { design: current, unchanged } };
  const project = await loadProject(projectId);
  if (project && (project.design.designId !== current.id || project.design.version !== current.version || project.design.status !== current.status)) {
    const pointed = await pointProjectAt(projectId, current, staff);
    if (!pointed.ok) return fail(`Saved, but the project couldn't be updated: ${pointed.error}`, pointed.status);
  }
  return { ok: true, value: { design: current, unchanged } };
}

/* ------------------------------------------------------------------ */
/* Approval                                                            */
/* ------------------------------------------------------------------ */

/**
 * Sign the latest version: a technical lead with current F-gas, approval
 * errors clear, checks current against today's catalogue. Records the
 * signature (name and F-gas reference from the staff record, never typed),
 * dispatches design-approved, then locks the layout photos.
 */
export async function approveDesignRecord(projectId: string, staff: StaffMember, input: unknown): Promise<DesignResult<{ design: DesignRecord; lockFailures: number }>> {
  const parsed = approveInputSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error), 400);
  const today = londonToday();
  const viewer = viewerFor(staff, today);
  if (!viewer.canApprove || !viewer.qualificationRef) return fail(viewer.approveBlockedReason ?? "Approving needs a technical lead with current F-gas certification.", 403);

  const [project, latest, catalogue, compatibility] = await Promise.all([
    loadProject(projectId),
    designsRepo.latestForProject(projectId),
    catalogueRepo.list(),
    compatibilityRepo.list(),
  ]);
  if (!project) return fail("Project not found", 404);
  if (!latest || latest.id !== parsed.data.designId || latest.version !== parsed.data.version) {
    return fail("That isn't the latest version any more. Reload to see the newest.", 409, { conflict: true });
  }
  if (latest.status === "approved") return { ok: true, value: { design: latest, lockFailures: await lockLayout(latest) } };
  if (latest.status === "superseded") return fail("A newer version of this design exists.", 409, { conflict: true });

  const active = catalogue.filter((i) => i.active || designUses(latest, i.id));
  if (designContentKey(recomputed(await hydrated(latest, catalogue, project), active, compatibility)) !== designContentKey(latest)) {
    return fail(`The checks have moved on since v${latest.version} was saved (the catalogue or the survey data changed). Save the design again to bring them up to date, then approve.`);
  }
  const now = new Date().toISOString();
  const signed = approveDesign(latest, { staffId: staff.id, name: staff.name, qualificationRef: viewer.qualificationRef }, now, {
    combinationTableChecked: parsed.data.combinationTableChecked,
  });
  if (!signed.ok) return fail(signed.errors[0] ?? "This design can't be approved yet.", 409);

  // The project must point at this version before the reducer will approve it.
  if (project.design.designId !== latest.id || project.design.version !== latest.version) {
    const pointed = await pointProjectAt(projectId, latest, staff);
    if (!pointed.ok) return fail(pointed.error, pointed.status, pointed.blockers ? { blockers: pointed.blockers } : {});
  }

  const approved = await designsRepo.update(signed.design);
  const result = await dispatch(projectId, { type: "design-approved", designId: approved.id, version: approved.version, by: staff.name }, staff);
  if ("error" in result) {
    // The project refused: put the record back as it was, so the two never disagree.
    try {
      await designsRepo.update(latest);
    } catch (err) {
      console.error(`[design] rollback of ${latest.id} after a refused approval failed:`, err);
    }
    return fail(result.error, result.status, result.blockers ? { blockers: result.blockers } : {});
  }
  const lockFailures = await lockLayout(approved);
  await audit({
    actor: staff,
    action: "design.approve",
    entity: "design",
    entityId: approved.id,
    detail: { projectId, version: approved.version, qualificationRef: viewer.qualificationRef, acknowledged: Boolean(approved.acknowledgements?.combinationTable), lockFailures },
  });
  // F5's checklist follows at once: "design-approval" from the project, "equipment-compatibility" from this design.
  try {
    await loadChecklist(result.project);
  } catch (err) {
    console.error(`[design] compliance sync after approving ${approved.id} failed (the compliance page retries):`, err);
  }
  return { ok: true, value: { design: approved, lockFailures } };
}

/** Lock every layout photo of an approved design. Returns how many couldn't be locked (retry from the page). */
export async function lockLayout(design: DesignRecord): Promise<number> {
  if (design.status !== "approved") return 0;
  const ids = (await mediaRepo.listByIds(layoutMediaIdsOf(design))).filter((m) => !m.locked).map((m) => m.id);
  if (ids.length === 0) return 0;
  // Only the lock column: a whole-row write could undo a drawing saved a moment earlier.
  const { error } = await db().from("media").update({ locked: true, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) {
    console.error(`[design] couldn't lock ${ids.length} layout photo(s):`, error.message);
    return ids.length;
  }
  return 0;
}

/** Retry the photo lock on the project's approved design. */
export async function relockLayout(projectId: string): Promise<DesignResult<number>> {
  const approved = await designsRepo.approvedForProject(projectId);
  if (!approved) return fail("There's no approved design on this project.", 404);
  return { ok: true, value: await lockLayout(approved) };
}

/** For the page: what still blocks approval of the latest version, as stored. */
export function approvalErrorsFor(design: DesignRecord | null): string[] {
  return design ? designApprovalErrors(design) : [];
}
