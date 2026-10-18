import type { MeasuredSurvey } from "@aircon/domain";

/**
 * The phone's own copy of the survey (localStorage), and the rules for
 * reconciling it with the server's when the screen opens. Pure apart from
 * the storage calls, which never throw (private mode, full storage).
 *
 * The phone copy is written on every change, before any network call, so a
 * dead battery, a closed tab or a cellar with no signal loses nothing.
 */

export interface LocalDraft {
  recordId: string;
  /** The server token (updated_at) this copy was based on. */
  baseToken: string;
  data: MeasuredSurvey;
  /** True while this copy holds changes the server hasn't acknowledged. */
  dirty: boolean;
  savedAt: string;
}

const key = (projectId: string) => `dih-survey:${projectId}`;

export function readLocalDraft(projectId: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(key(projectId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LocalDraft>;
    if (!d || typeof d.recordId !== "string" || typeof d.baseToken !== "string" || !d.data || typeof d.data !== "object") return null;
    return { recordId: d.recordId, baseToken: d.baseToken, data: d.data as MeasuredSurvey, dirty: d.dirty === true, savedAt: String(d.savedAt ?? "") };
  } catch {
    return null;
  }
}

/** False when the phone couldn't keep it (storage blocked or full). */
export function writeLocalDraft(projectId: string, draft: LocalDraft): boolean {
  try {
    window.localStorage.setItem(key(projectId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(projectId: string): void {
  try {
    window.localStorage.removeItem(key(projectId));
  } catch {
    // nothing to do
  }
}

/** JSON with sorted keys and no undefined values: equal surveys compare equal however they were built. */
export function canonical(value: unknown): string {
  if (value === undefined || value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

export const sameSurvey = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export type Resume =
  /** Use the server's copy (no phone copy, or nothing unsaved on it). */
  | { use: "server" }
  /** The phone has unsaved changes on top of the server's current copy: use them and save. */
  | { use: "phone"; data: MeasuredSurvey }
  /** Both changed since they last agreed: the person decides. */
  | { use: "conflict"; phone: MeasuredSurvey };

/** What to show when the survey opens, given the phone's copy and the server's. */
export function decideResume(local: LocalDraft | null, server: { recordId: string; token: string; data: MeasuredSurvey }): Resume {
  if (!local || local.recordId !== server.recordId || !local.dirty) return { use: "server" };
  if (sameSurvey(local.data, server.data)) return { use: "server" };
  if (local.baseToken === server.token) return { use: "phone", data: local.data };
  return { use: "conflict", phone: local.data };
}

/** Wait before the next save attempt after a failure: 2 s, 5 s, 10 s, then every 20 s. */
export function retryDelayMs(attempt: number): number {
  return [2_000, 5_000, 10_000][attempt - 1] ?? 20_000;
}
