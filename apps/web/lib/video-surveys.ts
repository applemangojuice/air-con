/**
 * The video walkthrough pipeline's rules (the iOS capture app's endpoints,
 * /api/video-surveys/**). Pure, so the routes and the tests share them.
 *
 *  * Off in production unless `VIDEO_SURVEYS_ENABLED=1`: the capture app
 *    isn't part of the pilot, and the endpoints are public (no sign-in).
 *  * Processing runs once per record. A record is claimed atomically
 *    (`uploaded` or `transcribed` → `processing`) before any provider is
 *    called; one that's already extracted, quoted or parked for review
 *    answers with what's stored, so a repeated call never pays for
 *    transcription or extraction again. A run that dies mid-way (the
 *    function's time limit) stays `processing`, for someone to review.
 */

export type VideoSurveyStatus = "uploaded" | "processing" | "transcribed" | "extracted" | "quoted" | "needs_review";

/** Statuses a run may claim. */
export const CLAIMABLE_VIDEO_STATUSES: readonly VideoSurveyStatus[] = ["uploaded", "transcribed"];

/** Statuses that are an answer already: the stored result, never a new run. */
export const SETTLED_VIDEO_STATUSES: readonly VideoSurveyStatus[] = ["extracted", "quoted", "needs_review"];

export function videoSurveysEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.VIDEO_SURVEYS_ENABLED === "1";
}

/** What a process call does with a record in this status. */
export function processDecision(status: string | null | undefined): "claim" | "stored" | "busy" {
  if ((CLAIMABLE_VIDEO_STATUSES as readonly string[]).includes(status ?? "")) return "claim";
  if ((SETTLED_VIDEO_STATUSES as readonly string[]).includes(status ?? "")) return "stored";
  return "busy";
}
