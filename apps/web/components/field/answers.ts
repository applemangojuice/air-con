import { jobTargets, setJobTarget, withExceptionReview, type CommissioningRecord, type ExceptionReview, type InstallJobV2, type TargetKey } from "@aircon/domain";
import type { FieldHeader, FieldHeaderState } from "./types";

/**
 * The field screens' own copy of the job: the page's data with the
 * server's answers to the phone's steps laid over it (server-answer.ts says
 * why a screen doesn't wait for a refresh). Pure, so it's tested
 * (tests/field-answers.test.ts).
 */

/**
 * The header as the newest of the page's data and the latest answer for
 * this job: an answer counts only while it's ahead of the page (a higher
 * version), so a refresh that set off before the step, and lands after
 * it, can't take the screen back, and one that lands later wins again.
 */
export function withHeaderState(header: FieldHeader, state: FieldHeaderState | null | undefined): FieldHeader {
  if (!state || state.version <= header.version) return header;
  // The answer's optional parts replace the page's (a cleared "on my way" stays cleared).
  const { onMyWay: _onMyWay, packDocumentId: _pack, signoff: _signoff, ...rest } = header;
  return { ...rest, ...state };
}

/** A target the server set: exactly what setJobTarget applied, by whom and when. */
export type TargetAnswer = { input: { key: TargetKey; min?: number; max?: number; note?: string }; by: string; at: string };
export type SignAnswer = { record: CommissioningRecord; certificate: { id: string; ref: string } | null; already?: boolean; header?: FieldHeaderState };

/**
 * The page's job with this screen's answered changes laid over it. Each
 * only while the page's data doesn't have it yet (or has something newer),
 * so a refresh that lands, late or early, never takes the screen back.
 */
export function withAnswers(job: InstallJobV2, answers: { targets: TargetAnswer[]; reviews: ExceptionReview[]; signed: SignAnswer | null }): InstallJobV2 {
  let out = job;
  if (answers.targets.length) {
    const serverSetAt = new Map(jobTargets(job.runsheet).map((t) => [t.key, t.setAt]));
    let runsheet = job.runsheet;
    for (const a of answers.targets) {
      const has = serverSetAt.get(a.input.key);
      if (has && has >= a.at) continue;
      try {
        runsheet = setJobTarget(runsheet, a.input, a.by, a.at);
      } catch {
        /* the server accepted it, so this can't refuse; if it does, the page's data stands */
      }
    }
    out = { ...out, runsheet };
  }
  for (const r of answers.reviews) {
    if (!out.exceptionReviews.some((x) => x.specId === r.specId && x.at === r.at)) out = withExceptionReview(out, r);
  }
  if (answers.signed && !out.commissioning) out = { ...out, commissioning: answers.signed.record };
  return out;
}
