import {
  COMPLIANCE_TEMPLATE,
  addComplianceEvidence,
  asbestosSuspectedAtSurvey,
  companyFgasCertProblem,
  higherRiskBuilding,
  isFlat,
  complianceTemplateFor,
  createIssue,
  instantiateCompliance,
  listedOnRecord,
  reviewCompliance,
  syncCompliance,
  transitionIssue,
  type BlockContext,
  type BuildingRegsRoute,
  type CdmRoles,
  type ComplianceItem,
  type ComplianceStatus,
  type Issue,
  type ListingFacts,
  type MeasuredSurvey,
  type PlanningOutcome,
  type Project,
  type StaffMember,
} from "@aircon/domain";
import { audit } from "./audit";
import { loadProject, londonToday } from "./project-service";
import { fail, mutateRow, projectMediaIds, type Outcome } from "./purchasing-server";
import * as complianceRepo from "./repo/compliance";
import * as designsRepo from "./repo/designs";
import * as issuesRepo from "./repo/issues";
import * as surveysRepo from "./repo/surveys";
import { getSettings } from "./settings-server";

/**
 * The survey's and the property record's word on listing: the survey's
 * permitted development answers, and the latest design's property record
 * (listedOnRecord reads them with the checklist's designations answer).
 */
export async function listingFacts(projectId: string): Promise<ListingFacts> {
  return (await surveyFacts(projectId)).listing;
}

/** What the survey says that a review needs: the listing facts, the tenure and whether asbestos is suspected. */
async function surveyFacts(projectId: string): Promise<{ listing: ListingFacts; tenure?: MeasuredSurvey["site"]["tenure"]; asbestosSuspected: boolean; builtFrom2000: boolean; block?: BlockContext }> {
  const [survey, design] = await Promise.all([
    surveysRepo.currentForProject(projectId).catch(() => null),
    designsRepo.latestForProject(projectId).catch(() => null),
  ]);
  return {
    listing: {
      ...(survey?.data?.permissions?.pd ? { pd: survey.data.permissions.pd } : {}),
      ...(design?.site?.planning?.intel?.listedBuilding ? { intelListed: true } : {}),
    },
    ...(survey?.data?.site?.tenure ? { tenure: survey.data.site.tenure } : {}),
    asbestosSuspected: asbestosSuspectedAtSurvey(survey?.data),
    builtFrom2000: survey?.data?.house?.era === "2000+",
    // A flat in a block (and a higher-risk one): which Building Regulations routes fit.
    ...(survey?.data ? { block: { flat: isFlat(survey.data), higherRisk: higherRiskBuilding(survey.data) } } : {}),
  };
}

/**
 * What a review needs beyond the item: the company F-gas certificate's
 * standing for this job (the fgas-company item rests on it unless the
 * subcontractor's is attached), and whether a listed building is on record.
 */
async function reviewContext(project: Project) {
  const [settings, facts, items] = await Promise.all([getSettings(), surveyFacts(project.id), complianceRepo.listForProject(project.id)]);
  return {
    companyFgasProblem: companyFgasCertProblem(settings.company.fgasCompanyCert, project, londonToday()),
    listing: facts.listing,
    listed: listedOnRecord(items, facts.listing),
    ...(facts.tenure ? { tenure: facts.tenure } : {}),
    asbestosSuspected: facts.asbestosSuspected,
    builtFrom2000: facts.builtFrom2000,
    ...(facts.block ? { block: facts.block } : {}),
    installComplete: project.install.status === "complete",
  };
}

/** Install day 1 hasn't started and the job is open: the checklist can still gain the template's newer items by itself. */
const beforeDay1 = (project: Project) => project.install.status === "not-started" && !project.closure.closed;

/** Items the template gained after this checklist was made, and that must hold day 1 on their own (planning consent). */
const SELF_ADDED_KEYS = ["planning-consent"];

/**
 * The compliance checklist on the server (F5). Every status change goes
 * through reviewCompliance (who may approve what, and on what evidence),
 * is saved with an optimistic check, and audited. A rejection raises a
 * blocking issue so it shows on the board and holds its gate; approving the
 * item again resolves that issue.
 *
 * The automatic items (design approval, commissioning, warranty) and the
 * move of the planning check to review are synced from the project each
 * time the checklist is read.
 *
 * Permissions are the caller's job; this module checks the item belongs to
 * the project it was asked about.
 */

/** Create any template items the project doesn't have yet (safe to repeat). */
export async function ensureChecklist(projectId: string, staff: StaffMember | null): Promise<number> {
  const existing = await complianceRepo.listForProject(projectId);
  const have = new Set(existing.map((i) => i.key));
  const missing = instantiateCompliance(projectId, () => crypto.randomUUID()).filter((i) => !have.has(i.key));
  if (missing.length === 0) return 0;
  await complianceRepo.insertMany(missing);
  await audit({ actor: staff, action: "compliance.create", entity: "project", entityId: projectId, detail: { keys: missing.map((i) => i.key) } });
  return missing.length;
}

/**
 * The checklist, with the automatic items brought up to date first:
 * design approval, commissioning and warranty from the project, and
 * "equipment combination verified" from the approved design (F3). A sync
 * write that loses a race is simply left for the next read.
 */
export async function loadChecklist(project: Project): Promise<ComplianceItem[]> {
  let [items, design] = await Promise.all([
    complianceRepo.listForProject(project.id),
    project.design.status === "approved" ? designsRepo.approvedForProject(project.id).catch(() => null) : Promise.resolve(null),
  ]);
  // A checklist made before the planning consent item existed gains it before day 1, so it can hold the job.
  if (items.length > 0 && beforeDay1(project)) {
    const have = new Set(items.map((i) => i.key));
    const missing = instantiateCompliance(project.id, () => crypto.randomUUID()).filter((i) => SELF_ADDED_KEYS.includes(i.key) && !have.has(i.key));
    if (missing.length) {
      try {
        await complianceRepo.insertMany(missing);
        await audit({ actor: { kind: "system", name: "compliance sync" }, action: "compliance.create", entity: "project", entityId: project.id, detail: { keys: missing.map((i) => i.key) } });
        items = await complianceRepo.listForProject(project.id);
      } catch (err) {
        console.error(`[compliance] adding ${missing.map((i) => i.key).join(", ")} to ${project.id} failed:`, err);
      }
    }
  }
  const changed = syncCompliance(items, project, new Date().toISOString(), design, await reviewContext(project));
  for (const c of changed) {
    try {
      await complianceRepo.update(c);
      await audit({ actor: { kind: "system", name: "compliance sync" }, action: "compliance.sync", entity: "compliance_item", entityId: c.id, detail: { projectId: project.id, key: c.key, status: c.status } });
    } catch (err) {
      console.error(`[compliance] sync of ${c.key} on ${project.id} failed:`, err);
    }
  }
  const byId = new Map(changed.map((c) => [c.id, c]));
  const order = new Map(COMPLIANCE_TEMPLATE.map((t, i) => [t.key, i]));
  return items
    .map((i) => byId.get(i.id) ?? i)
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

/** Review an item (approve, reject, not applicable, reopen). */
export async function reviewItem(
  projectId: string,
  itemId: string,
  input: { to: ComplianceStatus; note?: string; overrideReason?: string; planningOutcome?: PlanningOutcome; listedBuilding?: "yes" | "no"; buildingRegsRoute?: BuildingRegsRoute; cdmRoles?: Partial<CdmRoles> },
  staff: StaffMember,
): Promise<Outcome<ComplianceItem>> {
  const project = await loadProject(projectId);
  const context = {
    ...(project ? await reviewContext(project) : {}),
    ...(input.planningOutcome ? { planningOutcome: input.planningOutcome } : {}),
    ...(input.listedBuilding ? { listedBuilding: input.listedBuilding } : {}),
    ...(input.buildingRegsRoute ? { buildingRegsRoute: input.buildingRegsRoute } : {}),
    ...(input.cdmRoles ? { cdmRoles: input.cdmRoles } : {}),
  };
  const res = await mutateRow<ComplianceItem>("compliance_items", itemId, complianceRepo, (current) => {
    if (current.projectId !== projectId) return { ok: false, error: "That item isn't on this project's checklist." };
    const r = reviewCompliance(current, input.to, staff, input.note, input.overrideReason, new Date().toISOString(), context);
    return r.ok ? { ok: true, value: r.item } : r;
  });
  if (!res.ok) return res;
  let item = res.value;
  await audit({
    actor: staff,
    action: `compliance.${input.to}`,
    entity: "compliance_item",
    entityId: itemId,
    detail: { projectId, key: item.key, ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}) },
  });

  let warning: string | undefined;
  try {
    if (input.to === "rejected") item = await raiseBlocker(item, staff);
    else if ((input.to === "approved" || input.to === "not-applicable") && item.blockerIssueId) item = await resolveBlocker(item, staff, input.to);
  } catch (err) {
    console.error(`[compliance] blocker issue for ${item.key} on ${projectId} failed:`, err);
    warning =
      input.to === "rejected"
        ? "Saved, but the blocking issue couldn't be raised. Raise it by hand so the board shows it."
        : "Saved, but the linked blocking issue couldn't be resolved. Resolve it on the issues list.";
  }
  // The planning outcome or the listing answer decides the planning consent item: bring it in line now,
  // so the board and the day-1 gate read the new state without waiting for the page to be opened again.
  if (project && (item.key === "planning-pd" || item.key === "designations")) {
    try {
      await loadChecklist(project);
    } catch (err) {
      console.error(`[compliance] planning consent sync on ${projectId} failed:`, err);
    }
  }
  return { ok: true, value: item, ...(warning ? { warning } : {}) };
}

async function raiseBlocker(item: ComplianceItem, staff: StaffMember): Promise<ComplianceItem> {
  if (item.blockerIssueId) {
    const open = await issuesRepo.get(item.blockerIssueId);
    if (open && ["open", "in-progress", "awaiting-customer"].includes(open.status)) return item;
  }
  const now = new Date().toISOString();
  const t = complianceTemplateFor(item.key);
  const raised = createIssue({
    id: crypto.randomUUID(),
    projectId: item.projectId,
    number: await issuesRepo.nextNumber(item.projectId),
    kind: "blocker",
    title: `Compliance rejected: ${item.label}`,
    ...(item.note ? { detail: item.note } : {}),
    severity: item.statutory ? "high" : "medium",
    blocking: true,
    gate: item.gate,
    ownerRole: t?.ownerRole ?? "ops",
    nextAction: "Fix what the reviewer found, add the evidence, and send it for review again",
    raisedBy: { kind: "staff", id: staff.id, name: staff.name },
    raisedAt: now,
    customerVisible: false,
  });
  const issue: Issue = {
    ...raised,
    history: [{ at: now, by: staff.name, note: `Raised when the compliance item was rejected${item.note ? `: ${item.note}` : "."}`, status: "open" }],
  };
  const saved = await issuesRepo.insert(issue);
  await audit({ actor: staff, action: "issue.raise", entity: "issue", entityId: saved.id, detail: { projectId: item.projectId, kind: "blocker", complianceKey: item.key } });
  const updated = await complianceRepo.update({ ...item, blockerIssueId: saved.id });
  return updated;
}

async function resolveBlocker(item: ComplianceItem, staff: StaffMember, to: ComplianceStatus): Promise<ComplianceItem> {
  const issue = await issuesRepo.get(item.blockerIssueId!);
  if (issue && ["open", "in-progress", "awaiting-customer"].includes(issue.status)) {
    const resolution = `The compliance item was ${to === "approved" ? "approved" : "marked not applicable"} by ${staff.name}.`;
    await issuesRepo.update(transitionIssue(issue, "resolved", staff.name, resolution, new Date().toISOString()));
    await audit({ actor: staff, action: "issue.resolve", entity: "issue", entityId: issue.id, detail: { projectId: item.projectId, complianceKey: item.key } });
  }
  const { blockerIssueId: _drop, ...rest } = item;
  void _drop;
  return complianceRepo.update(rest as ComplianceItem);
}

/** Add files (already uploaded to the project) and/or a note to an item. */
export async function addEvidence(
  projectId: string,
  itemId: string,
  input: { mediaIds?: string[]; note?: string },
  staff: StaffMember,
): Promise<Outcome<ComplianceItem>> {
  const mediaIds = await projectMediaIds(projectId, input.mediaIds);
  if ((input.mediaIds?.length ?? 0) > 0 && mediaIds.length === 0) return fail("Those files aren't on this project.");
  const res = await mutateRow<ComplianceItem>("compliance_items", itemId, complianceRepo, (current) => {
    if (current.projectId !== projectId) return { ok: false, error: "That item isn't on this project's checklist." };
    const r = addComplianceEvidence(current, { mediaIds, ...(input.note ? { note: input.note } : {}) }, { name: staff.name, staffId: staff.id }, new Date().toISOString());
    return r.ok ? { ok: true, value: r.item } : r;
  });
  if (!res.ok) return res;
  await audit({ actor: staff, action: "compliance.evidence", entity: "compliance_item", entityId: itemId, detail: { projectId, key: res.value.key, mediaIds } });
  return res;
}

/** For the project loaders: the checklist for an id, or null when the project doesn't exist. */
export async function loadChecklistFor(projectId: string): Promise<{ project: Project; items: ComplianceItem[] } | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  return { project, items: await loadChecklist(project) };
}
