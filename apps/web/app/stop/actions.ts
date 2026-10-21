"use server";

import { stopLinkValid } from "@/lib/follow-up-stop";
import { dispatch, loadProject } from "@/lib/project-service";

export interface StopState {
  done?: boolean;
  error?: string;
}

/**
 * The stop page's one button: the signed link again (never trusted from the
 * page alone), then follow-ups off on that project, as the family. Already
 * off is done too, so a second tap reads the same.
 */
export async function stopFollowUpsAction(projectId: string, sig: string, _prev: StopState, _form: FormData): Promise<StopState> {
  if (!(await stopLinkValid(projectId, sig))) return { error: "This link doesn't work any more. Turn follow-ups off from your project page, or email us." };
  const project = await loadProject(projectId).catch(() => null);
  if (!project) return { error: "We couldn't find that project. Email us and we'll stop them." };
  if (project.aftercare.followUpsOptedOutAt) return { done: true };
  const result = await dispatch(projectId, { type: "aftercare-opt-out", optedOut: true }, { kind: "customer", customerId: project.customer.customerId ?? "", name: project.customer.name || "Customer" });
  if ("error" in result) {
    const again = await loadProject(projectId).catch(() => null);
    if (again?.aftercare.followUpsOptedOutAt) return { done: true };
    return { error: "That didn't save. Try again in a minute, or email us and we'll stop them." };
  }
  return { done: true };
}
