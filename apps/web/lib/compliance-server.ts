import {
  COMPLIANCE_TEMPLATE,
  addComplianceEvidence,
  complianceTemplateFor,
  createIssue,
  instantiateCompliance,
  reviewCompliance,
  syncCompliance,
  transitionIssue,
  type ComplianceItem,
  type ComplianceStatus,
  type Issue,
  type Project,
  type StaffMember,
} from "@aircon/domain";
import { audit } from "./audit";
import { loadProject } from "./project-service";
import { fail, mutateRow, projectMediaIds, type Outcome } from "./purchasing-server";
import * as complianceRepo from "./repo/compliance";
import * as designsRepo from "./repo/designs";
import * as issuesRepo from "./repo/issues";

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
  const [items, design] = await Promise.all([
    complianceRepo.listForProject(project.id),
    project.design.status === "approved" ? designsRepo.approvedForProject(project.id).catch(() => null) : Promise.resolve(null),
  ]);
  const changed = syncCompliance(items, project, new Date().toISOString(), design);
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
  input: { to: ComplianceStatus; note?: string; overrideReason?: string },
  staff: StaffMember,
): Promise<Outcome<ComplianceItem>> {
  const res = await mutateRow<ComplianceItem>("compliance_items", itemId, complianceRepo, (current) => {
    if (current.projectId !== projectId) return { ok: false, error: "That item isn't on this project's checklist." };
    const r = reviewCompliance(current, input.to, staff, input.note, input.overrideReason, new Date().toISOString());
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
