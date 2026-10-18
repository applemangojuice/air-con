import {
  EARLY_START_WORDING_VERSION,
  PricingError,
  acceptanceErrors,
  blockersFor,
  buildCostLines,
  can,
  cancellationCopy,
  cancellationStatus,
  customerSafeProposal,
  defaultOptionFor,
  documentCompany,
  documentCustomer,
  draftProposal,
  earlyStartWording,
  engineListNetPence,
  guaranteeLines,
  hasCurrentQualification,
  measuredToEngineSurvey,
  pricingInputsOf,
  proposalIssueErrors,
  recomputeOption,
  reviseProposal,
  schedule2Missing,
  type AccessEquipment,
  type Blocker,
  type ContractType,
  type DesignRecord,
  type DocumentRecord,
  type DocumentSnapshots,
  type MediaItem,
  type OptionContext,
  type PilotSettings,
  type PipeRoute,
  type PricingInputs,
  type Project,
  type ProposalOption,
  type ProposalRecord,
  type StaffMember,
  type Survey,
  type SurveyRecord,
} from "@aircon/domain";
import { audit } from "./audit";
import { CANCELLATION_NOTICE_VERSION, LEGAL_REVIEW_NOTE, cancellationForm, cancellationInstructions } from "./comms/legal-text";
import { notify } from "./comms/outbox";
import { createDocument, listDocuments } from "./documents-server";
import { signedMediaUrls, updateMedia } from "./media-server";
import { buildReadinessContext, dispatch, loadProject, londonToday } from "./project-service";
import { db, isUuid } from "./repo/base";
import * as catalogueRepo from "./repo/catalogue";
import * as designsRepo from "./repo/designs";
import * as mediaRepo from "./repo/media";
import * as proposalsRepo from "./repo/proposals";
import * as staffRepo from "./repo/staff";
import * as surveysRepo from "./repo/surveys";
import { getSettings } from "./settings-server";
import { buildAcceptanceRecord, proposalDocumentHash, withoutAt, type AcceptanceForm } from "@/components/proposal/model";
import { formFromRecord } from "@/components/ops/proposal/model";

/**
 * Proposals on the server (contract §G, F4): drafting from the approved
 * design, saving, issuing, revising, and the customer's accept, change and
 * decline, in one place so every write follows the same order.
 *
 * The ordering rules, because the outbox reads the proposal record while
 * the project transition is dispatched:
 *  * Issue: the draft (with its prices) is saved first, then
 *    `proposal-issued` is dispatched (the issue email reads the options from
 *    the record), then the record is marked issued and the old version
 *    superseded. If the dispatch is refused, nothing changed.
 *  * Accept: the acceptance record is written onto the still-issued row,
 *    then `proposal-accepted` is dispatched (the confirmation email reads
 *    it), then the row is marked accepted, which the database freezes. A
 *    refused dispatch takes the acceptance back off the row.
 *  * Any step after a committed dispatch that fails (a dropped connection)
 *    is repaired on the next read by `reconcile`, which brings the record's
 *    status back in line with the project, the source of truth.
 *
 * Permissions are the caller's job (requireStaff / requireProjectAccess).
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number; errors?: string[]; blockers?: Blocker[] };

const fail = (error: string, status = 409, extra: { errors?: string[]; blockers?: Blocker[] } = {}): { ok: false; error: string; status: number; errors?: string[]; blockers?: Blocker[] } => ({
  ok: false,
  error,
  status,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Bring the records' statuses in line with the project after a write that
 * stopped half way (see the module comment). The project says which
 * version is live and what happened to it; the record follows. Never
 * touches an accepted record (it's frozen) except to finish accepting it.
 */
async function reconcile(project: Project, records: ProposalRecord[]): Promise<ProposalRecord[]> {
  const pp = project.proposal;
  if (!pp.proposalId) return records;
  const current = records.find((r) => r.id === pp.proposalId);
  if (!current) return records;
  let fixed: ProposalRecord | null = null;
  const open = pp.status === "issued" || pp.status === "changes-requested" || pp.status === "expired";
  if (open && current.status === "draft") {
    fixed = { ...current, status: "issued", issuedAt: current.issuedAt ?? pp.issuedAt ?? new Date().toISOString() };
  } else if (pp.status === "accepted" && current.status === "issued" && current.acceptance) {
    fixed = { ...current, status: "accepted" };
  } else if (pp.status === "declined" && current.status === "issued") {
    fixed = { ...current, status: "declined", ...(pp.declineReason ? { declinedReason: pp.declineReason } : {}) };
  }
  if (!fixed) return records;
  try {
    const saved = await proposalsRepo.update(fixed);
    console.warn(`[proposal] reconciled ${current.id}: ${current.status} → ${saved.status}`);
    return records.map((r) => (r.id === saved.id ? saved : r));
  } catch (err) {
    console.error(`[proposal] couldn't reconcile ${current.id}:`, err);
    return records;
  }
}

/** Every version for a project, newest first, statuses reconciled with the project. */
export async function proposalsFor(project: Project): Promise<ProposalRecord[]> {
  return reconcile(project, await proposalsRepo.listForProject(project.id));
}

/** The customer's view of the engine price behind a proposal. */
export interface EngineReference {
  netPence: number;
  source: "measured" | "self-survey" | "none";
  note: string;
}

async function quoteSurvey(quoteId: string): Promise<Survey | null> {
  if (!isUuid(quoteId)) return null;
  const { data, error } = await db().from("quote_requests").select("survey").eq("id", quoteId).maybeSingle();
  if (error) {
    console.error("[proposal] quote survey read failed:", error.message);
    return null;
  }
  const survey = (data as { survey?: unknown } | null)?.survey;
  return survey && typeof survey === "object" ? (survey as Survey) : null;
}

/**
 * The list price reference: the engine re-run on the measured survey (F2's
 * measuredToEngineSurvey), else on the customer's own survey (said plainly),
 * else none.
 */
export async function engineReference(project: Project, survey: SurveyRecord | null): Promise<EngineReference> {
  const base = await quoteSurvey(project.quoteId);
  if (survey && base) {
    try {
      // measuredToEngineSurvey turns the measured rooms into engine input (areas, runs).
      const measured = measuredToEngineSurvey(survey.data, base);
      return { netPence: engineListNetPence(measured), source: "measured", note: "The pricing engine re-run on the measured survey." };
    } catch (err) {
      console.error("[proposal] measured engine price failed:", err);
    }
  }
  if (base) {
    try {
      return {
        netPence: engineListNetPence(base),
        source: "self-survey",
        note: survey
          ? "The pricing engine on the customer's own online survey (the measured survey couldn't be re-run: see the server log)."
          : "The pricing engine on the customer's own online survey (no measured survey yet).",
      };
    } catch (err) {
      console.error("[proposal] engine price failed:", err);
    }
  }
  return { netPence: 0, source: "none", note: "No engine price: there's no survey the engine can read. Use cost-plus or a manual price." };
}

/** Is there an active, in-house Part P electrician on the team? Then electrics are labour, not subcontract. */
async function inHouseElectrician(today: string): Promise<boolean> {
  try {
    const team = await staffRepo.list({ activeOnly: true });
    return team.some((s) => !s.external && s.roles.includes("electrician") && hasCurrentQualification(s, "part-p", today));
  } catch (err) {
    console.error("[proposal] staff read failed:", err);
    return false;
  }
}

const PIPE_ROUTES: readonly PipeRoute[] = ["through-wall", "external-trunking", "internal-concealed", "via-loft", "other"];

/** The catalogue items an option can draw on: the design's kit, plus services, tools and consumables. */
async function catalogueFor(design: DesignRecord) {
  const all = await catalogueRepo.list();
  const ids = new Set<string>();
  for (const v of design.variants) {
    v.bom.forEach((b) => b.catalogueItemId && ids.add(b.catalogueItemId));
    v.roomUnits.forEach((u) => ids.add(u.indoorItemId));
    v.systems.forEach((s) => ids.add(s.outdoorItemId));
  }
  return all.filter(
    (i) => ids.has(i.id) || (i.active && (i.kind === "service" || i.kind === "tool" || (i.kind === "material" && (i.category ?? "").toLowerCase() === "consumables"))),
  );
}

/**
 * Everything an option is built from: the approved design, the catalogue,
 * settings, the engine price, who does the electrics, access equipment and
 * the outdoor photos from the survey.
 */
export async function optionContext(
  project: Project,
  design: DesignRecord,
  settings: PilotSettings,
  contractType: ContractType,
): Promise<{ ctx: OptionContext; engine: EngineReference }> {
  const today = londonToday();
  const [catalogue, survey, electrician] = await Promise.all([
    catalogueFor(design),
    surveysRepo.currentForProject(project.id),
    inHouseElectrician(today),
  ]);
  const engine = await engineReference(project, survey);

  const positions = survey?.data?.outdoor?.positions ?? [];
  const outdoorMediaBySystem: Record<string, string[]> = {};
  const access = new Set<AccessEquipment>();
  for (const v of design.variants) {
    for (const s of v.systems) {
      const pos = positions.find((p) => p.id === s.outdoorPositionId) ?? (v.systems.length === 1 ? positions.find((p) => p.chosen) : undefined);
      if (pos?.mediaId) outdoorMediaBySystem[s.id] = [pos.mediaId];
      if (pos?.accessEquipment) access.add(pos.accessEquipment);
    }
  }
  if (Object.keys(outdoorMediaBySystem).length === 0) {
    // No survey positions to go by: the project's outdoor-position photos that carry a drawing.
    const outdoor = (await mediaRepo.listForProject(project.id, { tag: "outdoor-location" })).filter((m) => m.annotations.length > 0);
    const first = design.variants[0]?.systems[0];
    if (first && outdoor[0]) outdoorMediaBySystem[first.id] = outdoor.map((m) => m.id).slice(0, 2);
  }
  const routes: OptionContext["routes"] = {};
  for (const r of survey?.data?.rooms ?? []) {
    if (r.route && PIPE_ROUTES.includes(r.route)) routes[r.id] = { route: r.route, ...(r.routeNote ? { routeNote: r.routeNote } : {}) };
  }

  return {
    ctx: {
      design,
      catalogue,
      settings,
      engineNetPence: engine.netPence,
      contractType,
      inHouseElectrician: electrician,
      accessEquipment: [...access],
      outdoorMediaBySystem,
      routes,
    },
    engine,
  };
}

/** A photo as the proposal shows it. */
export interface ProposalMedia {
  id: string;
  url: string | null;
  annotations: MediaItem["annotations"];
  width?: number;
  height?: number;
  caption?: string;
  tag: MediaItem["tag"];
}

/** Signed, read-only URLs for the photos a proposal uses, from this project only. */
export async function proposalMedia(projectId: string, records: ProposalRecord[], extraIds: string[] = []): Promise<Record<string, ProposalMedia>> {
  const ids = new Set<string>(extraIds);
  for (const r of records) {
    for (const o of r.options) {
      o.roomCards.forEach((c) => c.mediaIds.forEach((m) => ids.add(m)));
      o.outdoorMediaIds.forEach((m) => ids.add(m));
    }
  }
  const items = (await mediaRepo.listByIds([...ids])).filter((m) => m.projectId === projectId);
  // Four hours: long enough for a customer to read at their own pace.
  const urls = await signedMediaUrls(items, 4 * 60 * 60);
  const out: Record<string, ProposalMedia> = {};
  for (const m of items) {
    out[m.id] = {
      id: m.id,
      url: urls.get(m.id) ?? null,
      annotations: m.annotations,
      ...(m.width ? { width: m.width } : {}),
      ...(m.height ? { height: m.height } : {}),
      ...(m.caption ? { caption: m.caption } : {}),
      tag: m.tag,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ops: the builder                                                    */
/* ------------------------------------------------------------------ */

export interface BuilderData {
  project: Project;
  settings: PilotSettings;
  today: string;
  /** The design the proposal is built on (the newest approved one), or null. */
  design: DesignRecord | null;
  /** The newest design whatever its status, for the empty state. */
  latestDesign: DesignRecord | null;
  proposals: ProposalRecord[];
  /** The newest version, whatever its status. */
  current: ProposalRecord | null;
  ctx: OptionContext | null;
  engine: EngineReference | null;
  media: Record<string, ProposalMedia>;
  /** The project's proposal-issue gate, as the reducer will check it. */
  blockers: Blocker[];
  schedule2Missing: string[];
  documents: DocumentRecord[];
}

export async function loadBuilder(projectId: string, staff: StaffMember): Promise<BuilderData | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [settings, design, latestDesign, proposals, documents] = await Promise.all([
    getSettings(),
    designsRepo.approvedForProject(projectId),
    designsRepo.latestForProject(projectId),
    proposalsFor(project),
    listDocuments(projectId, { includeSuperseded: true }),
  ]);
  const current = proposals[0] ?? null;
  const contractType: ContractType = current?.contractType ?? project.proposal.contractType ?? "supply-and-install";
  const built = design ? await optionContext(project, design, settings, contractType) : null;
  const ctx = await buildReadinessContext(project, staff);
  const media = await proposalMedia(projectId, current ? [current] : [], built ? Object.values(built.ctx.outdoorMediaBySystem ?? {}).flat() : []);
  return {
    project,
    settings,
    today: ctx.today,
    design,
    latestDesign,
    proposals,
    current,
    ctx: built?.ctx ?? null,
    engine: built?.engine ?? null,
    media,
    blockers: blockersFor(project, ctx, "proposal-issue"),
    schedule2Missing: schedule2Missing(settings),
    documents: documents.filter((d) => d.kind === "proposal" || d.kind === "contract"),
  };
}

/** Start the first draft (or a fresh one) from the approved design. Idempotent while a draft exists. */
export async function startDraft(projectId: string, staff: StaffMember): Promise<Result<{ proposalId: string }>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found", 404);
  if (project.proposal.status === "accepted") return fail("The proposal is accepted. Changes now go through a variation.");
  const existing = await proposalsFor(project);
  const design = await designsRepo.approvedForProject(projectId);
  if (!design) return fail("The design needs a technical lead's sign-off before a proposal can be drafted.");
  const draft = existing.find((p) => p.status === "draft");
  if (draft && draft.designId === design.id) return { ok: true, proposalId: draft.id };
  if (draft) {
    // Drafted on a design that's since been replaced: close it, and start again from the approved one.
    await proposalsRepo.update({ ...draft, status: "superseded" });
  }
  const settings = await getSettings();
  const { ctx } = await optionContext(project, design, settings, project.proposal.contractType ?? "supply-and-install");
  const today = londonToday();
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await proposalsRepo.nextVersion(projectId);
    const record = draftProposal(ctx, {
      id: crypto.randomUUID(),
      projectId,
      version,
      instantPriceGbp: project.quoteSummary.totalGbp,
      today,
      now: new Date().toISOString(),
    });
    try {
      const saved = await proposalsRepo.insert(record);
      await audit({ actor: staff, action: "proposal.draft", entity: "proposal", entityId: saved.id, detail: { projectId, version, designId: design.id } });
      return { ok: true, proposalId: saved.id };
    } catch (err) {
      if (attempt === 2) throw err; // a concurrent draft took the version: re-read and try the next one
    }
  }
  return fail("Couldn't start the draft. Please try again.", 502);
}

/** What the builder sends on save. Validated by the action's zod schema first. */
export interface DraftPatch {
  revision: number;
  contractType: ContractType;
  validUntil: string;
  increaseReason?: string;
  internalNotes?: string;
  inclusions: string[];
  exclusions: string[];
  assumptions: string[];
  options: {
    designVariantId: string;
    label: string;
    summary: string;
    highlights: string[];
    roomCards: { roomId: string; unitName: string; why: string; highlights: string[]; pipeNote?: string }[];
    installDays: number;
    labour: ProposalOption["labour"];
    pricingInputs: PricingInputs;
  }[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cleanList = (xs: string[]) => xs.map(clean).filter(Boolean);

/** An option that can't be priced as given: the build-up stays, the price waits (issue then refuses). */
function unpriced(ctx: OptionContext, option: ProposalOption): ProposalOption {
  const variant = ctx.design.variants.find((v) => v.id === option.designVariantId)!;
  const inputs = option.pricingInputs;
  const costLines = buildCostLines({
    variant,
    catalogue: ctx.catalogue,
    labour: option.labour,
    settings: ctx.settings,
    contractType: ctx.contractType,
    ...(inputs?.extras ? { extras: inputs.extras } : {}),
    ...(ctx.inHouseElectrician ? { inHouseElectrician: true } : {}),
    ...(ctx.accessEquipment ? { accessEquipment: ctx.accessEquipment } : {}),
    ...(inputs?.costOverrides ? { overrides: inputs.costOverrides } : {}),
  });
  const costPence = costLines.reduce((a, l) => a + (l.totalPence ?? 0), 0);
  return {
    ...option,
    costLines,
    priceLines: [],
    pricing: {
      pricingBasis: inputs?.basis ?? "manual",
      listNetPence: 0,
      netPence: 0,
      taxCode: option.pricing.taxCode,
      taxPence: 0,
      totalPence: 0,
      costPence,
      unpricedCostLines: costLines.filter((l) => l.totalPence === null).length,
      grossMarginPct: 0,
      grossMarginPctBeforeDiscount: 0,
      contributionPence: 0,
      belowMinMargin: true,
    },
  };
}

/**
 * Apply the builder's edits to a draft and reprice every option on the
 * server (the browser's preview is never trusted). Staff who can't see
 * margins can change the wording but not the pricing. An option whose
 * pricing inputs are incomplete still saves (so typing is never lost); its
 * price waits, and `pricingErrors` says why.
 */
export async function saveDraft(
  projectId: string,
  proposalId: string,
  patch: DraftPatch,
  staff: StaffMember,
): Promise<Result<{ revision: number; pricingErrors: Record<string, string>; proposal: ProposalRecord }>> {
  const stored = await proposalsRepo.get(proposalId);
  if (!stored || stored.projectId !== projectId) return fail("Proposal not found", 404);
  if (stored.status !== "draft") {
    return fail(
      stored.status === "superseded"
        ? "This draft has been closed (the customer accepted, or a fresh draft replaced it). Reload to see where things stand."
        : "This version has been issued, so it can't change. Revise it to make a new version.",
    );
  }
  if ((stored.draftRevision ?? 0) !== patch.revision) {
    return fail("Someone else saved this draft since you opened it. Reload to see their changes (yours weren't saved).", 409);
  }
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found", 404);
  const design = await designsRepo.get(stored.designId);
  if (!design || design.status !== "approved") return fail("The design this draft was built on is no longer approved. Start a new draft from the approved design.");
  const seen = new Set<string>();
  for (const o of patch.options) {
    if (!design.variants.some((v) => v.id === o.designVariantId)) return fail(`The design has no variant ${o.designVariantId}.`, 422);
    if (seen.has(o.designVariantId)) return fail("Each design variant can only be one option.", 422);
    seen.add(o.designVariantId);
  }
  const settings = await getSettings();
  const { ctx } = await optionContext(project, design, settings, patch.contractType);
  const canPrice = can(staff, "finance.view-margin");

  const pricingErrors: Record<string, string> = {};
  const options = patch.options.map((o) => {
    const variant = design.variants.find((v) => v.id === o.designVariantId)!;
    const base = defaultOptionFor(ctx, variant);
    const before = stored.options.find((s) => s.designVariantId === o.designVariantId);
    const cards = base.roomCards.map((card) => {
      const edit = o.roomCards.find((c) => c.roomId === card.roomId);
      return edit
        ? {
            ...card,
            unitName: clean(edit.unitName) || card.unitName,
            why: clean(edit.why) || card.why,
            highlights: cleanList(edit.highlights),
            ...(edit.pipeNote !== undefined ? { pipeNote: clean(edit.pipeNote) } : {}),
          }
        : card;
    });
    const option: ProposalOption = {
      ...base,
      label: clean(o.label) || base.label,
      summary: clean(o.summary),
      highlights: cleanList(o.highlights),
      roomCards: cards,
      installDays: o.installDays,
      labour: canPrice ? o.labour : (before?.labour ?? base.labour),
      pricingInputs: canPrice ? o.pricingInputs : before ? pricingInputsOf(before) : base.pricingInputs,
    };
    try {
      return recomputeOption(ctx, option);
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
      pricingErrors[o.designVariantId] = err.message;
      return unpriced(ctx, option);
    }
  });

  const next: ProposalRecord = {
    ...stored,
    options,
    contractType: patch.contractType,
    validUntil: patch.validUntil,
    inclusions: cleanList(patch.inclusions),
    exclusions: cleanList(patch.exclusions),
    assumptions: cleanList(patch.assumptions),
    // Settings-derived wording follows settings until the version is issued.
    warranty: settings.warranty.manufacturerSummary?.trim() || null,
    guarantees: guaranteeLines(settings),
    termsVersion: settings.legal.termsVersion,
    instantPriceGbp: project.quoteSummary.totalGbp,
    draftRevision: (stored.draftRevision ?? 0) + 1,
  };
  const reason = patch.increaseReason?.trim();
  if (reason) next.increaseReason = reason;
  else delete next.increaseReason;
  const notes = patch.internalNotes?.trim();
  if (notes) next.internalNotes = notes;
  else delete next.internalNotes;

  // Optimistic: only if nobody saved in between (the revision is in the record).
  const latest = await proposalsRepo.get(proposalId);
  if (!latest || latest.status !== "draft" || (latest.draftRevision ?? 0) !== patch.revision) {
    return fail("Someone else saved this draft a moment ago. Reload to see their changes (yours weren't saved).", 409);
  }
  const saved = await proposalsRepo.update(next);
  return { ok: true, revision: saved.draftRevision ?? 0, pricingErrors, proposal: saved };
}

/** An admin's margin or tax override on a draft, with a reason (or null to clear it). */
export async function setOverride(
  projectId: string,
  proposalId: string,
  kind: "margin" | "tax",
  reason: string | null,
  staff: StaffMember,
): Promise<Result> {
  if (!staff.roles.includes("admin")) return fail("Only an admin can record an override.", 403);
  const stored = await proposalsRepo.get(proposalId);
  if (!stored || stored.projectId !== projectId) return fail("Proposal not found", 404);
  if (stored.status !== "draft") return fail("Overrides can only be set on a draft.");
  const next: ProposalRecord = { ...stored };
  const value = reason?.trim() ? { reason: reason.trim(), by: staff.name, at: new Date().toISOString() } : null;
  if (kind === "margin") {
    if (value) next.marginOverride = value;
    else delete next.marginOverride;
  } else if (value) next.taxOverride = value;
  else delete next.taxOverride;
  await proposalsRepo.update(next);
  await audit({ actor: staff, action: `proposal.${kind}-override`, entity: "proposal", entityId: proposalId, detail: { reason: value?.reason ?? null } });
  return { ok: true };
}

/** Make sure the photos a customer is about to see are marked customer-visible. Best-effort. */
async function showProposalMedia(record: ProposalRecord): Promise<void> {
  const ids = new Set<string>();
  for (const o of record.options) {
    o.roomCards.forEach((c) => c.mediaIds.forEach((m) => ids.add(m)));
    o.outdoorMediaIds.forEach((m) => ids.add(m));
  }
  const items = (await mediaRepo.listByIds([...ids])).filter((m) => m.projectId === record.projectId && !m.customerVisible);
  for (const m of items) {
    const res = await updateMedia(m.id, { customerVisible: true });
    if (!res.ok) console.warn(`[proposal] couldn't show photo ${m.id} to the customer:`, res.error);
  }
}

/**
 * Issue a draft: the proposal's own checks, the project's gate (via
 * dispatch, which sends the issue email with the pre-contract information),
 * then the record is marked issued, the older live version superseded and
 * the proposal document frozen.
 */
export async function issueDraft(projectId: string, proposalId: string, staff: StaffMember): Promise<Result<{ version: number }>> {
  const record = await proposalsRepo.get(proposalId);
  if (!record || record.projectId !== projectId) return fail("Proposal not found", 404);
  if (record.status !== "draft") return fail("This version has already been issued.");
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found", 404);
  if (project.proposal.status === "accepted") return fail("The proposal is accepted. Changes now go through a variation.");
  const settings = await getSettings();
  const today = londonToday();
  const errors = proposalIssueErrors(record, settings, today);
  if (errors.length) return fail("The proposal isn't ready to issue yet.", 422, { errors });

  // The gate first, without writing anything: the same check the reducer makes.
  const ctx = await buildReadinessContext(project, staff);
  const gate = blockersFor(project, ctx, "proposal-issue");
  if (gate.some((b) => b.severity === "block")) return fail("The project isn't ready for a proposal yet.", 409, { blockers: gate });

  const contractType = record.contractType ?? "supply-and-install";
  const result = await dispatch(
    projectId,
    { type: "proposal-issued", proposalId, version: record.version, validUntil: record.validUntil, optionCount: record.options.length, contractType },
    staff,
  );
  if ("error" in result) return fail(result.error, result.status, result.blockers ? { blockers: result.blockers } : {});

  const issuedAt = result.project.proposal.issuedAt ?? new Date().toISOString();
  let issued: ProposalRecord = { ...record, status: "issued", issuedAt, issuedBy: staff.name };
  try {
    issued = await proposalsRepo.update(issued);
  } catch (err) {
    console.error(`[proposal] issued ${proposalId} but couldn't mark the record (reconcile will):`, err);
  }

  // The new version replaces every older one still in play (never an accepted one: that's refused above).
  for (const old of await proposalsRepo.listForProject(projectId)) {
    if (old.id === proposalId || (old.status !== "issued" && old.status !== "draft" && old.status !== "expired")) continue;
    try {
      await proposalsRepo.update({ ...old, status: "superseded", supersededBy: proposalId });
    } catch (err) {
      console.error(`[proposal] couldn't supersede ${old.id}:`, err);
    }
  }

  try {
    const snapshot: DocumentSnapshots["proposal"] = {
      company: documentCompany(settings),
      customer: documentCustomer(result.project),
      issuedAt,
      proposal: customerSafeProposal(issued),
    };
    await createDocument(projectId, "proposal", snapshot, { title: `Your proposal (version ${issued.version})`, customerVisible: true, createdBy: staff.name });
  } catch (err) {
    console.error(`[proposal] issued ${proposalId} but the proposal document failed:`, err);
  }
  await showProposalMedia(issued).catch((err) => console.error("[proposal] showing photos failed:", err));
  await audit({ actor: staff, action: "proposal.issue", entity: "proposal", entityId: proposalId, detail: { projectId, version: issued.version } });
  return { ok: true, version: issued.version };
}

/** A new draft from an issued (or declined, expired) version. */
export async function reviseFrom(projectId: string, proposalId: string, staff: StaffMember): Promise<Result<{ proposalId: string }>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found", 404);
  if (project.proposal.status === "accepted") return fail("The proposal is accepted. Changes now go through a variation.");
  const all = await proposalsFor(project);
  const draft = all.find((p) => p.status === "draft");
  if (draft) return { ok: true, proposalId: draft.id };
  const source = all.find((p) => p.id === proposalId);
  if (!source) return fail("Proposal not found", 404);
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await proposalsRepo.nextVersion(projectId);
    const next = { ...reviseProposal(source, crypto.randomUUID(), new Date().toISOString()), version };
    let saved: ProposalRecord;
    try {
      saved = await proposalsRepo.insert(next);
    } catch (err) {
      if (attempt === 2) throw err;
      continue; // a concurrent revision took the version: try the next one
    }
    // The copy goes through the same rebuild a save does, so the new draft is
    // on today's settings, catalogue and wording rules from the start.
    try {
      const rebuilt = await saveDraft(projectId, saved.id, formFromRecord(saved), staff);
      if (!rebuilt.ok) console.warn(`[proposal] revision ${saved.id} kept as copied:`, rebuilt.error);
    } catch (err) {
      console.error(`[proposal] rebuilding revision ${saved.id} failed (kept as copied):`, err);
    }
    await audit({ actor: staff, action: "proposal.revise", entity: "proposal", entityId: saved.id, detail: { projectId, from: source.id, version } });
    return { ok: true, proposalId: saved.id };
  }
  return fail("Couldn't start the revision. Please try again.", 502);
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export type CustomerState = "open" | "changes-requested" | "expired" | "declined" | "accepted";

export interface CustomerProposalData {
  project: Project;
  /** Customer-safe. */
  proposal: ProposalRecord;
  state: CustomerState;
  preview: boolean;
  documentHash: string;
  media: Record<string, ProposalMedia>;
  approvedBy?: string;
  foundingPilot: boolean;
  documents: { proposal?: { id: string; ref: string }; contract?: { id: string; ref: string } };
  today: string;
  settings: PilotSettings;
}

/**
 * The proposal in front of the customer: the project's current version
 * (issued, accepted, declined or past its date), or, for a staff preview,
 * any version of this project. Null when there's nothing to show yet.
 */
export async function loadCustomerProposal(projectId: string, opts: { previewId?: string } = {}): Promise<CustomerProposalData | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [settings, records] = await Promise.all([getSettings(), proposalsFor(project)]);
  const today = londonToday();
  let record: ProposalRecord | undefined;
  if (opts.previewId) {
    record = records.find((r) => r.id === opts.previewId);
  } else {
    const pp = project.proposal;
    const current = records.find((r) => r.id === pp.proposalId && r.status !== "draft" && r.status !== "superseded");
    record = current ?? records.find((r) => r.status === "issued" || r.status === "accepted");
  }
  if (!record) return null;

  const pp = project.proposal;
  const isCurrent = pp.proposalId === record.id;
  let state: CustomerState = "open";
  if (record.status === "accepted" || (isCurrent && pp.status === "accepted")) state = "accepted";
  else if (record.status === "declined" || (isCurrent && pp.status === "declined")) state = "declined";
  else if (record.validUntil && record.validUntil.slice(0, 10) < today) state = "expired";
  else if (isCurrent && pp.status === "expired") state = "expired";
  else if (isCurrent && pp.status === "changes-requested") state = "changes-requested";

  const [media, design, docs] = await Promise.all([
    proposalMedia(projectId, [record]),
    designsRepo.get(record.designId).catch(() => null),
    listDocuments(projectId, { customerVisibleOnly: true }),
  ]);
  const proposalDoc = docs.find((d) => d.kind === "proposal");
  const contractDoc = docs.find((d) => d.kind === "contract");
  const foundingPilot = record.options.some((o) => (o.pricing.discount?.amountPence ?? 0) > 0);
  return {
    project,
    proposal: customerSafeProposal(record),
    state,
    preview: Boolean(opts.previewId),
    documentHash: await proposalDocumentHash(record),
    media,
    ...(design?.approval?.name ? { approvedBy: design.approval.name } : {}),
    foundingPilot,
    documents: {
      ...(proposalDoc ? { proposal: { id: proposalDoc.id, ref: proposalDoc.ref } } : {}),
      ...(contractDoc ? { contract: { id: contractDoc.id, ref: contractDoc.ref } } : {}),
    },
    today,
    settings,
  };
}

/** Who's acting on the customer side. */
export interface CustomerActor {
  customerId: string;
}

/** The project and record for a customer action, checked to be the current, open version. */
async function openForCustomer(proposalId: string): Promise<Result<{ project: Project; record: ProposalRecord }>> {
  const record = await proposalsRepo.get(proposalId);
  if (!record) return fail("Not found", 404);
  const project = await loadProject(record.projectId);
  if (!project) return fail("Not found", 404);
  const [fixed] = (await reconcile(project, [record])).filter((r) => r.id === record.id);
  return { ok: true, project, record: fixed ?? record };
}

/** The proposal's project id, for the route's access check (null when there's no such proposal). */
export async function projectIdOfProposal(proposalId: string): Promise<string | null> {
  if (!isUuid(proposalId)) return null;
  const record = await proposalsRepo.get(proposalId);
  return record?.projectId ?? null;
}

export interface AcceptedSummary {
  optionLabel: string;
  totalPence: number;
  at: string;
  name: string;
  earlyStartRequested: boolean;
  contractType: ContractType;
  cancellation: string;
  /** The words to reply with, when they asked to start early. */
  earlyStartWording?: string;
  email?: string;
  contractDocumentId?: string;
  alreadyAccepted?: boolean;
}

function acceptedSummary(project: Project, record: ProposalRecord, settings: PilotSettings, today: string, extra: Partial<AcceptedSummary> = {}): AcceptedSummary {
  const a = record.acceptance!;
  const contractType = record.contractType ?? project.proposal.contractType ?? "supply-and-install";
  return {
    optionLabel: a.optionLabel,
    totalPence: a.totalPence,
    at: a.at,
    name: a.name,
    earlyStartRequested: a.earlyStartRequested,
    contractType,
    cancellation: cancellationCopy(project, { settings, today }),
    ...(a.earlyStartRequested && !project.proposal.earlyStart?.evidencedAt ? { earlyStartWording: earlyStartWording(contractType) } : {}),
    ...(project.customer.email ? { email: project.customer.email } : {}),
    ...extra,
  };
}

/** The contract document: the acceptance record, the accepted option and the terms, frozen. Best-effort. */
async function createContractDocument(project: Project, record: ProposalRecord, settings: PilotSettings, today: string): Promise<string | undefined> {
  const a = record.acceptance!;
  const contractType = record.contractType ?? "supply-and-install";
  const safe = customerSafeProposal(record);
  const option = safe.options.find((o) => o.id === a.optionId)!;
  const cs = cancellationStatus(project, today, settings);
  const company = settings.company;
  const trader = {
    legalName: company.legalName,
    tradingName: company.tradingName,
    geographicAddress: company.geographicAddress,
    ...(company.registeredAddress ? { registeredAddress: company.registeredAddress } : {}),
    phone: company.phone,
    email: company.email,
  };
  const proposalDoc = (await listDocuments(project.id, { kind: "proposal" }))[0];
  const base: DocumentSnapshots["contract"] = {
    company: documentCompany(settings),
    customer: documentCustomer(project),
    issuedAt: a.at,
    proposalId: record.id,
    proposalVersion: record.version,
    ...(proposalDoc ? { proposalRef: proposalDoc.ref } : {}),
    option,
    acceptance: a,
    contractType,
    inclusions: record.inclusions,
    exclusions: record.exclusions,
    assumptions: record.assumptions,
    warranty: record.warranty,
    termsVersion: record.termsVersion,
    cancellation: { text: cancellationCopy(project, { settings, today }), ...(cs.endsOn ? { endsOn: cs.endsOn } : {}), earlyStartRequested: a.earlyStartRequested },
  };
  // The Schedule 2 particulars and Schedule 3 wording as given, beside the contract type's fields.
  const snapshot = {
    ...base,
    documentHash: a.documentHash,
    guarantees: record.guarantees ?? guaranteeLines(settings, record.warranty),
    increaseReason: record.increaseReason,
    payments: {
      depositPct: settings.payments.depositPct,
      depositTiming: settings.payments.depositTiming,
      balanceDueDays: settings.payments.balanceDueDays,
      methods: settings.payments.methods,
    },
    complaints: { process: company.complaintsProcess, ...(company.adr ? { adr: company.adr } : {}) },
    cancellationNoticeVersion: a.cancellationNoticeVersion,
    cancellationInstructions: cancellationInstructions(trader, { contractType, days: settings.scheduling.cancellationDays }),
    cancellationForm: cancellationForm(trader),
    earlyStart: { requested: a.earlyStartRequested, wording: earlyStartWording(contractType), wordingVersion: a.earlyStartWordingVersion ?? EARLY_START_WORDING_VERSION },
    legalReview: settings.legal.cancellationReviewed ? null : LEGAL_REVIEW_NOTE,
  };
  try {
    const doc = await createDocument(project.id, "contract", snapshot, { title: "Your contract confirmation", customerVisible: true, createdBy: a.name });
    return doc.id;
  } catch (err) {
    console.error(`[proposal] accepted ${record.id} but the contract document failed:`, err);
    return undefined;
  }
}

/**
 * The customer accepts. Idempotent: a retry after a lost response finds the
 * acceptance already recorded and answers with it.
 */
export async function acceptProposal(
  proposalId: string,
  form: AcceptanceForm,
  actor: CustomerActor,
  meta: { ip?: string; userAgent?: string },
): Promise<Result<{ summary: AcceptedSummary }>> {
  const opened = await openForCustomer(proposalId);
  if (!opened.ok) return opened;
  let { project, record } = opened;
  const settings = await getSettings();
  const today = londonToday();

  if (project.proposal.status === "accepted") {
    if (project.proposal.proposalId === record.id && record.acceptance) {
      const contract = (await listDocuments(project.id, { kind: "contract", customerVisibleOnly: true }))[0];
      return { ok: true, summary: acceptedSummary(project, record, settings, today, { alreadyAccepted: true, ...(contract ? { contractDocumentId: contract.id } : {}) }) };
    }
    return fail("This home already has an accepted proposal.");
  }
  if (project.proposal.proposalId !== record.id) return fail("This isn't your current proposal. Please reload the page.", 409);

  const hash = await proposalDocumentHash(record);
  if (form.documentHash !== hash) {
    return fail("Your proposal has been updated since you opened it. Please reload the page to see the latest version.", 409, { errors: ["changed"] });
  }
  const acceptance = buildAcceptanceRecord({
    proposal: record,
    form,
    at: new Date().toISOString(),
    ...(project.customer.email ? { email: project.customer.email } : {}),
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    cancellationNoticeVersion: CANCELLATION_NOTICE_VERSION,
    earlyStartWordingVersion: EARLY_START_WORDING_VERSION,
    ...(project.proposal.documentsByEmailConsent ? { documentsByEmailConsentAt: project.proposal.documentsByEmailConsent.at } : {}),
  });
  const errors = acceptanceErrors(record, withoutAt(acceptance), today);
  if (errors.length) return fail(errors[0]!, 422, { errors });

  // 1. The acceptance onto the still-issued row (the confirmation email reads it).
  record = await proposalsRepo.update({ ...record, acceptance });
  // 2. The contract itself: the reducer's gate, then the confirmation email and team alert.
  const result = await dispatch(
    project.id,
    {
      type: "proposal-accepted",
      proposalId: record.id,
      version: record.version,
      optionLabel: acceptance.optionLabel,
      contractTotalPence: acceptance.totalPence,
      earlyStartRequested: acceptance.earlyStartRequested,
      earlyStartWordingVersion: EARLY_START_WORDING_VERSION,
    },
    { kind: "customer", customerId: actor.customerId, name: acceptance.name },
  );
  if ("error" in result) {
    try {
      const { acceptance: _taken, ...rest } = record;
      await proposalsRepo.update(rest as ProposalRecord);
    } catch (err) {
      console.error(`[proposal] couldn't take the refused acceptance off ${record.id}:`, err);
    }
    return fail(result.error, result.status, result.blockers ? { blockers: result.blockers } : {});
  }
  project = result.project;
  // 3. Frozen from here on (the database refuses any change but superseding).
  try {
    record = await proposalsRepo.update({ ...record, status: "accepted" });
  } catch (err) {
    console.error(`[proposal] accepted ${record.id} but couldn't mark the record (reconcile will):`, err);
  }
  // A draft revision someone had started is moot now: changes go through variations.
  for (const other of await proposalsRepo.listForProject(project.id)) {
    if (other.id === record.id || other.status !== "draft") continue;
    await proposalsRepo.update({ ...other, status: "superseded", supersededBy: record.id }).catch((err) => console.error(`[proposal] superseding draft ${other.id}:`, err));
  }
  const contractDocumentId = await createContractDocument(project, record, settings, today);
  await audit({
    actor: { kind: "customer", id: actor.customerId, name: acceptance.name },
    action: "proposal.accept",
    entity: "proposal",
    entityId: record.id,
    detail: { projectId: project.id, optionId: acceptance.optionId, totalPence: acceptance.totalPence, documentHash: acceptance.documentHash },
  });
  return { ok: true, summary: acceptedSummary(project, { ...record, acceptance }, settings, today, contractDocumentId ? { contractDocumentId } : {}) };
}

/** The customer asks for changes (the team hears through the outbox). */
export async function requestChanges(proposalId: string, text: string, actor: CustomerActor): Promise<Result> {
  const opened = await openForCustomer(proposalId);
  if (!opened.ok) return opened;
  const { project, record } = opened;
  if (project.proposal.proposalId !== record.id) return fail("This isn't your current proposal. Please reload the page.");
  const said = text.trim();
  if (project.proposal.status === "changes-requested") {
    // Asked already: a retry changes nothing; something new reaches the team as a note on the same request.
    if (project.proposal.changeRequest === said || record.changeRequest?.endsWith(said)) return { ok: true };
    await notify("team-alert", {
      projectId: project.id,
      data: { title: `More changes asked for: ${project.customer.name || "Customer"}`, lines: [said] },
      discriminator: `proposal-changes-more:${record.id}:${said.length}:${said.slice(0, 40)}`,
    });
    await proposalsRepo
      .update({ ...record, changeRequest: [record.changeRequest, said].filter(Boolean).join("\n\n") })
      .catch((err) => console.error(`[proposal] couldn't note the change request on ${record.id}:`, err));
    return { ok: true };
  }
  const result = await dispatch(project.id, { type: "proposal-changes-requested", text: said }, { kind: "customer", customerId: actor.customerId, name: project.customer.name });
  if ("error" in result) return fail(result.error, result.status);
  try {
    await proposalsRepo.update({ ...record, changeRequest: said });
  } catch (err) {
    console.error(`[proposal] couldn't note the change request on ${record.id}:`, err);
  }
  return { ok: true };
}

/** The customer declines (with an optional reason); the team gets an alert. */
export async function declineProposal(proposalId: string, reason: string, actor: CustomerActor): Promise<Result> {
  const opened = await openForCustomer(proposalId);
  if (!opened.ok) return opened;
  const { project, record } = opened;
  if (project.proposal.proposalId !== record.id) return fail("This isn't your current proposal. Please reload the page.");
  if (project.proposal.status === "declined") return { ok: true };
  const result = await dispatch(project.id, { type: "proposal-declined", reason }, { kind: "customer", customerId: actor.customerId, name: project.customer.name });
  if ("error" in result) return fail(result.error, result.status);
  try {
    await proposalsRepo.update({ ...record, status: "declined", ...(reason.trim() ? { declinedReason: reason.trim() } : {}) });
  } catch (err) {
    console.error(`[proposal] couldn't mark ${record.id} declined (reconcile will):`, err);
  }
  await notify("team-alert", {
    projectId: project.id,
    data: {
      title: `Proposal declined: ${project.customer.name || "Customer"}`,
      lines: [reason.trim() ? `Their reason: ${reason.trim()}` : "They didn't give a reason.", "Next: call them, and revise the proposal if there's something to change."],
    },
    discriminator: `proposal-declined:${record.id}`,
  });
  return { ok: true };
}

/** The customer opened their proposal: recorded once (staff previews never count). */
export async function recordView(proposalId: string, actor: CustomerActor): Promise<Result> {
  const opened = await openForCustomer(proposalId);
  if (!opened.ok) return opened;
  const { project, record } = opened;
  if (project.proposal.proposalId !== record.id || project.proposal.viewedAt) return { ok: true };
  if (project.proposal.status !== "issued" && project.proposal.status !== "changes-requested") return { ok: true };
  const result = await dispatch(project.id, { type: "proposal-viewed", proposalId }, { kind: "customer", customerId: actor.customerId, name: project.customer.name });
  if ("error" in result) return fail(result.error, result.status);
  if (record.status === "issued" && !record.viewedAt) {
    await proposalsRepo.update({ ...record, viewedAt: new Date().toISOString() }).catch((err) => console.error("[proposal] viewedAt:", err));
  }
  return { ok: true };
}
