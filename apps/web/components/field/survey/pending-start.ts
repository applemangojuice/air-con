/**
 * A survey started on the phone with no signal at the door (a draft the
 * server prepared beforehand: see survey-server prepareSurveyDraft). The
 * phone keeps the time it started; the start goes to the server (the
 * customer's "started" update, the surveyor's clock from that time) as soon
 * as there's signal, and always before the survey is submitted.
 */

const key = (projectId: string) => `dih-survey-start:${projectId}`;

const store = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** When this phone started the survey without telling the server yet, if it did. */
export function pendingStart(projectId: string, s: Storage | null = store()): string | null {
  try {
    const at = s?.getItem(key(projectId));
    return at && Number.isFinite(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

export function setPendingStart(projectId: string, startedAt: string | null, s: Storage | null = store()): void {
  try {
    if (startedAt) s?.setItem(key(projectId), startedAt);
    else s?.removeItem(key(projectId));
  } catch {
    // storage blocked: the start is only in memory until the page closes
  }
}

/** Can "Start survey" begin on the phone? Only with a prepared draft that hasn't started. */
export function canStartOnPhone(prepared: { record: { status: string; startedAt?: string } } | null | undefined): boolean {
  return Boolean(prepared && prepared.record.status === "draft" && !prepared.record.startedAt);
}

/**
 * Send a pending start. "sent" (or the server already knows better: it's
 * submitted, gone, refused) clears it; no signal, a sign-in to renew or a
 * server error keeps it for the next try.
 */
export async function replayPendingStart(projectId: string, f: typeof fetch = fetch, s: Storage | null = store()): Promise<"none" | "sent" | "kept" | "dropped"> {
  const at = pendingStart(projectId, s);
  if (!at) return "none";
  try {
    const res = await f(`/api/field/survey/${projectId}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ startedAt: at }),
    });
    if (res.ok) {
      setPendingStart(projectId, null, s);
      return "sent";
    }
    if (res.status === 400 || res.status === 404 || res.status === 409) {
      setPendingStart(projectId, null, s);
      return "dropped";
    }
    return "kept";
  } catch {
    return "kept";
  }
}
