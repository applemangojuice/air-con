"use server";

import { revalidatePath } from "next/cache";
import type { ElectricsPlanStatus, ProjectAction } from "@aircon/domain";
import { notifyProjectAction } from "@/lib/project-notify";
import { applyAndSave } from "@/lib/projects-server";

/**
 * Ops-side transitions. These run behind the /ops basic-auth wall (see
 * middleware.ts). Server actions POST to the page's own URL, so the same
 * wall covers them. Customer actions go through /api/projects instead.
 */

/**
 * Plain <form action> requires void-returning actions. Each form only renders
 * when its transition is legal for the current state, so a reducer rejection
 * here means a stale page, and the revalidate refreshes it either way.
 */
async function run(projectId: string, action: ProjectAction): Promise<void> {
  const result = await applyAndSave(projectId, action);
  if ("error" in result) {
    console.error(`ops action ${action.type} on ${projectId} rejected:`, result.error);
  } else {
    // Milestones speak to the customer no matter which side moved them.
    await notifyProjectAction(result.project, action);
  }
  revalidatePath(`/ops/projects/${projectId}`);
  revalidatePath("/ops/projects");
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function issueFinalQuote(projectId: string, form: FormData) {
  return run(projectId, {
    type: "ops-issue-final-quote",
    totalGbp: Number(form.get("totalGbp")),
    note: str(form, "note") || undefined,
  });
}

export async function completeSiteVisit(projectId: string, form: FormData) {
  return run(projectId, {
    type: "ops-complete-site-visit",
    summary: str(form, "summary"),
    approvedForInstall: form.get("approvedForInstall") === "on",
    electricsStatus: (str(form, "electricsStatus") || "validated") as ElectricsPlanStatus,
    electricsSummary: str(form, "electricsSummary"),
  });
}

export async function markDispatched(projectId: string, form: FormData) {
  return run(projectId, {
    type: "ops-mark-dispatched",
    courier: str(form, "courier"),
    trackingRef: str(form, "trackingRef"),
  });
}

export async function markDelivered(projectId: string) {
  return run(projectId, { type: "ops-mark-delivered" });
}

export async function assignInstaller(projectId: string, form: FormData) {
  return run(projectId, {
    type: "ops-assign-installer",
    installer: {
      name: str(form, "name"),
      role: str(form, "role"),
      bio: str(form, "bio"),
      yearsExperience: Number(form.get("yearsExperience")) || 0,
    },
  });
}

export async function completeInstallation(projectId: string) {
  return run(projectId, { type: "ops-complete-installation" });
}
