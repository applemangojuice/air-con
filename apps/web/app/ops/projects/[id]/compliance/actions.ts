"use server";

import { z } from "zod";
import { BUILDING_REGS_ROUTES, COMPLIANCE_STATUSES, PLANNING_OUTCOMES, can, type BuildingRegsRoute, type ComplianceStatus, type PlanningOutcome, type StaffMember } from "@aircon/domain";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { addEvidence, ensureChecklist, reviewItem } from "@/lib/compliance-server";
import { isUuid } from "@/lib/repo/base";
import { invalid, text, toState, type ActionState } from "../booking/_f5/action-state";

/**
 * Compliance actions. Anyone working the job (projects.edit, install.work or
 * compliance.review) may add evidence; who may approve, reject or mark not
 * applicable is reviewCompliance's call (compliance.review, and admins for
 * internal overrides), checked again on the server.
 */

async function guard(projectId: string): Promise<StaffMember | null> {
  const staff = await requireStaff();
  if (!isUuid(projectId)) return null;
  const access = await requireProjectAccess(projectId);
  if (access?.kind !== "staff") return null;
  const works = ["projects.edit", "install.work", "compliance.review"] as const;
  return works.some((p) => can(staff, p)) ? staff : null;
}

const NOT_ALLOWED: ActionState = { error: "You can't change this project's checklist." };

export async function createChecklistAction(projectId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_ALLOWED;
  const added = await ensureChecklist(projectId, staff);
  return { ok: true, message: added ? `Checklist created: ${added} items.` : "The checklist is already complete." };
}

export async function evidenceAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_ALLOWED;
  const itemId = z.string().uuid().safeParse(form.get("itemId"));
  if (!itemId.success) return invalid();
  const mediaIds = form.getAll("mediaId").map(String).filter(isUuid).slice(0, 20);
  const note = text(form, "note", 2000);
  if (mediaIds.length === 0 && !note) return invalid("Add a file or write a note first.");
  return toState(await addEvidence(projectId, itemId.data, { mediaIds, ...(note ? { note } : {}) }, staff), "Evidence added.");
}

export async function reviewAction(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await guard(projectId);
  if (!staff) return NOT_ALLOWED;
  const itemId = z.string().uuid().safeParse(form.get("itemId"));
  const to = z.enum(COMPLIANCE_STATUSES as [ComplianceStatus, ...ComplianceStatus[]]).safeParse(form.get("to"));
  if (!itemId.success || !to.success) return invalid("Pick what to do with it.");
  const note = text(form, "note", 2000);
  const override = text(form, "overrideReason", 500);
  // The questions an approval asks (planning-pd's outcome, designations' "listed?"); the domain says when one is missing.
  const outcome = z.enum(PLANNING_OUTCOMES as [PlanningOutcome, ...PlanningOutcome[]]).safeParse(form.get("planningOutcome"));
  const listed = z.enum(["yes", "no"]).safeParse(form.get("listedBuilding"));
  const route = z.enum(BUILDING_REGS_ROUTES as [BuildingRegsRoute, ...BuildingRegsRoute[]]).safeParse(form.get("buildingRegsRoute"));
  const done: Record<ComplianceStatus, string> = {
    approved: "Approved.",
    "not-applicable": "Marked not applicable.",
    rejected: "Rejected: a blocking issue is on the board until it's fixed.",
    "under-review": "Back to review.",
    "evidence-required": "Marked as needing evidence.",
    "not-started": "Reset.",
  };
  return toState(
    await reviewItem(
      projectId,
      itemId.data,
      {
        to: to.data,
        ...(note ? { note } : {}),
        ...(override ? { overrideReason: override } : {}),
        ...(outcome.success ? { planningOutcome: outcome.data } : {}),
        ...(listed.success ? { listedBuilding: listed.data } : {}),
        ...(route.success ? { buildingRegsRoute: route.data } : {}),
      },
      staff,
    ),
    done[to.data],
  );
}
