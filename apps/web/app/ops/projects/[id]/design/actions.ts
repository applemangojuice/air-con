"use server";

import { revalidatePath } from "next/cache";
import type { Blocker } from "@aircon/domain";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { approveDesignRecord, draftNewDesign, relockLayout, saveDesign } from "@/lib/design-server";

/**
 * Design studio writes (F3). Each action checks the live staff record and
 * the project access itself, then hands the validated input to
 * lib/design-server, which re-reads the latest version before writing.
 * Results are plain data: the studio shows `error` as it comes.
 */

export type DesignActionResult =
  | { ok: true; id: string; version: number; status: string; unchanged?: boolean; lockFailures?: number }
  | { ok: false; error: string; conflict?: boolean; blockers?: Blocker[] };

const NOT_FOUND: DesignActionResult = { ok: false, error: "Project not found." };

function refresh(projectId: string) {
  revalidatePath(`/ops/projects/${projectId}/design`);
  revalidatePath(`/ops/projects/${projectId}`);
}

const crashed = (err: unknown): DesignActionResult => {
  console.error("[design] action failed:", err);
  return { ok: false, error: "Something went wrong on our side. Nothing was lost; please try again." };
};

export async function draftDesignAction(projectId: string, manufacturer?: string): Promise<DesignActionResult> {
  const staff = await requireStaff("design.edit");
  const access = await requireProjectAccess(String(projectId), { perm: "design.edit" });
  if (!access || access.kind !== "staff") return NOT_FOUND;
  try {
    const r = await draftNewDesign(String(projectId), staff, typeof manufacturer === "string" ? { manufacturer } : {});
    refresh(projectId);
    if (!r.ok) return { ok: false, error: r.error, ...(r.conflict ? { conflict: true } : {}) };
    return { ok: true, id: r.value.id, version: r.value.version, status: r.value.status };
  } catch (err) {
    return crashed(err);
  }
}

export async function saveDesignAction(projectId: string, input: unknown): Promise<DesignActionResult> {
  const staff = await requireStaff("design.edit");
  const access = await requireProjectAccess(String(projectId), { perm: "design.edit" });
  if (!access || access.kind !== "staff") return NOT_FOUND;
  try {
    const r = await saveDesign(String(projectId), staff, input);
    refresh(projectId);
    if (!r.ok) return { ok: false, error: r.error, ...(r.conflict ? { conflict: true } : {}), ...(r.blockers ? { blockers: r.blockers } : {}) };
    return { ok: true, id: r.value.design.id, version: r.value.design.version, status: r.value.design.status, unchanged: r.value.unchanged };
  } catch (err) {
    return crashed(err);
  }
}

export async function approveDesignAction(projectId: string, input: unknown): Promise<DesignActionResult> {
  const staff = await requireStaff("design.approve");
  const access = await requireProjectAccess(String(projectId), { perm: "design.approve" });
  if (!access || access.kind !== "staff") return NOT_FOUND;
  try {
    const r = await approveDesignRecord(String(projectId), staff, input);
    refresh(projectId);
    if (!r.ok) return { ok: false, error: r.error, ...(r.conflict ? { conflict: true } : {}), ...(r.blockers ? { blockers: r.blockers } : {}) };
    return { ok: true, id: r.value.design.id, version: r.value.design.version, status: r.value.design.status, lockFailures: r.value.lockFailures };
  } catch (err) {
    return crashed(err);
  }
}

export async function relockLayoutAction(projectId: string): Promise<DesignActionResult> {
  await requireStaff("design.approve");
  const access = await requireProjectAccess(String(projectId), { perm: "design.approve" });
  if (!access || access.kind !== "staff") return NOT_FOUND;
  try {
    const r = await relockLayout(String(projectId));
    refresh(projectId);
    if (!r.ok) return { ok: false, error: r.error };
    return r.value === 0
      ? { ok: true, id: "", version: 0, status: "approved", lockFailures: 0 }
      : { ok: false, error: `${r.value} photo${r.value === 1 ? "" : "s"} still couldn't be locked. Try again in a minute.` };
  } catch (err) {
    return crashed(err);
  }
}
