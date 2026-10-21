"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  JOB_TARGETS,
  TARGET_FAILS_PREFIX,
  commissioningFromJob,
  commissioningSignErrors,
  electricalRefsFromJob,
  fgasFromJob,
  jobTargets,
  openExceptions,
  runsheetProgress,
  windowText,
  type Blocker,
  type CommissioningResult,
  type DecayTestView,
  type ExceptionReview,
  type JobTarget,
} from "@aircon/domain";
import { DecayPanel } from "./decay-panel";
import { BlockerList } from "@/components/kit/blocker-list";
import { withAnswers, type SignAnswer, type TargetAnswer } from "./answers";
import { parseReading } from "./capture";
import { londonTime, personName, whenLabel } from "./format";
import { answerHeader, postAnswer, useCatchUp, useFieldJob } from "./server-answer";
import { HeaderTitle, SyncBadge } from "./sync-badge";
import type { FieldJob } from "./types";
import { getFieldOutbox } from "@/lib/field-outbox";
import { useMergedJob, useOutboxState, useRefreshOnSync } from "./use-outbox";

/**
 * Commissioning, for the tech lead: the results per system as the evidence
 * says them, the job's manufacturer targets (set or confirmed here), the
 * exceptions to review, and the signature. Signing completes the install,
 * signs commissioning on the project and issues the certificate. Everyone
 * else on the job sees the same results, read-only.
 *
 * A target set, a reading reviewed and the signature all show from the
 * server's answer at once, laid over the page's copy of the job (the same
 * domain functions the server applied), never from a page refresh landing
 * (server-answer.ts says why). Signing again answers with the record on
 * file, so a retry after a lost reply is safe.
 */

const BTN = "min-h-12 rounded-full px-5 font-semibold disabled:opacity-40";
const PRIMARY = `${BTN} bg-accent-700 text-white shadow-sm hover:bg-accent-800`;
const SECONDARY = `${BTN} border border-line bg-white text-ink-900 hover:bg-surface`;
const INPUT = "min-h-12 w-full rounded-full border border-line bg-white px-4 text-lg text-ink-900 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100";

const NO_REPLY = "No reply (no signal?), so it may not have saved. Try again outside or in a minute: it's safe to send twice.";

const BASIS: Record<JobTarget["basis"], { text: string; tone: string }> = {
  record: { text: "No target yet", tone: "bg-amber-50 text-amber-900" },
  candidate: { text: "Candidate: confirm it", tone: "bg-amber-50 text-amber-900" },
  "tech-lead": { text: "Set", tone: "bg-emerald-50 text-emerald-800" },
  catalogue: { text: "From the catalogue", tone: "bg-surface text-ink-700" },
};

function TargetRow({ projectId, target, canEdit, locked, onAnswer }: { projectId: string; target: JobTarget; canEdit: boolean; locked: boolean; onAnswer: (a: TargetAnswer) => void }) {
  const def = JOB_TARGETS[target.key];
  const [min, setMin] = useState(target.min !== undefined ? String(target.min) : "");
  const [max, setMax] = useState(target.max !== undefined ? String(target.max) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A change that fails a test already taken asks first (the server refuses it until this is ticked).
  const [confirmFails, setConfirmFails] = useState(false);
  const failsTaken = Boolean(error?.startsWith(TARGET_FAILS_PREFIX));
  // A company default applies until the tech lead sets a figure: it isn't waiting for anyone.
  const b = target.basis !== "tech-lead" && def.defaultApplies ? { text: "Company default", tone: "bg-surface text-ink-700" } : BASIS[target.basis];
  const showMin = def.bounds !== "max";
  const showMax = def.bounds !== "min";

  async function save(recordOnly: boolean) {
    setError(null);
    const lo = recordOnly || !showMin || !min.trim() ? undefined : parseReading(min);
    const hi = recordOnly || !showMax || !max.trim() ? undefined : parseReading(max);
    if (lo === null || hi === null) return setError("Numbers only.");
    setBusy(true);
    const r = await postAnswer<{ applied: TargetAnswer }>(
      `/api/field/jobs/${projectId}/targets`,
      { key: target.key, ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(failsTaken && confirmFails ? { confirmFails: true } : {}) },
      NO_REPLY,
    );
    setBusy(false);
    if (!r.ok) {
      if (!r.error.startsWith(TARGET_FAILS_PREFIX)) setConfirmFails(false);
      return setError(r.error);
    }
    setConfirmFails(false);
    onAnswer(r.data.applied);
  }

  return (
    <li className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">{def.label}</p>
          <p className="text-sm text-ink-700">
            {windowText({ ...(target.min !== undefined ? { min: target.min } : {}), ...(target.max !== undefined ? { max: target.max } : {}), unit: def.unit }) ??
              (target.basis === "tech-lead" && def.recordOnly ? def.recordOnly.replace(/^Use /, "Using ") : target.basis === "tech-lead" ? "Record only" : def.defaultApplies ? `Using ${def.defaultApplies}` : "Not set")}
            {target.basis === "tech-lead" && target.setBy ? ` · ${personName(target.setBy)}` : ""}
            {` · ${target.specCount} reading${target.specCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.tone}`}>{b.text}</span>
      </div>
      {!locked && <p className="mt-2 text-sm text-ink-500">{def.hint}</p>}
      {target.note && target.basis !== "tech-lead" && <p className="mt-1 text-sm text-ink-500">{target.note}</p>}
      {target.basis === "tech-lead" && target.note && <p className="mt-1 text-sm text-ink-700">Note: {target.note}</p>}
      {canEdit && !locked && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {showMin && (
              <div>
                <label htmlFor={`${target.key}-min`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Minimum ({def.unit})
                </label>
                <input id={`${target.key}-min`} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} className={INPUT} />
              </div>
            )}
            {showMax && (
              <div>
                <label htmlFor={`${target.key}-max`} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Maximum ({def.unit}){target.key === "pressure.test" ? ": nameplate PS" : ""}
                </label>
                <input id={`${target.key}-max`} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} className={INPUT} />
              </div>
            )}
          </div>
          <label htmlFor={`${target.key}-note`} className="sr-only">
            Source (manual page)
          </label>
          <input id={`${target.key}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Source, e.g. installation manual p.14" className={INPUT} />
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          {failsTaken && (
            <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <input type="checkbox" checked={confirmFails} onChange={(e) => setConfirmFails(e.target.checked)} className="mt-1 h-5 w-5 accent-accent-600" />
              <span className="text-sm font-semibold text-red-900">The figure is right: fail the test already taken (a full retest is then needed)</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void save(false)} className={`${PRIMARY} flex-1`}>
              {busy ? "Saving…" : target.basis === "candidate" ? "Confirm these numbers" : "Set target"}
            </button>
            {def.recordOnly !== false && (
              <button type="button" disabled={busy} onClick={() => void save(true)} className={SECONDARY}>
                {def.recordOnly ?? "Record only"}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ExceptionRow({ projectId, item, canReview, onAnswer }: { projectId: string; item: ReturnType<typeof openExceptions>[number]; canReview: boolean; onAnswer: (r: ExceptionReview) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { step, slot } = item;
  async function review(resolution: "accepted" | "recapture-required") {
    if (reason.trim().length < 3) return setError("Give the reason: it goes on the record.");
    setBusy(true);
    setError(null);
    const r = await postAnswer<{ review: ExceptionReview }>(
      `/api/field/jobs/${projectId}/exceptions`,
      { specId: slot.spec.id, ...(slot.record?.id ? { evidenceId: slot.record.id } : {}), resolution, reason },
      NO_REPLY,
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setReason("");
    onAnswer(r.data.review);
  }
  return (
    <li className="rounded-2xl border border-red-300 bg-red-50/60 p-4">
      <p className="font-semibold text-ink-900">
        {slot.spec.label} <span className="font-normal text-ink-700">· {step.title}{step.item ? `, ${step.item}` : ""}</span>
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-red-800">
        {slot.record?.value} <span className="text-base font-normal text-ink-700">{slot.spec.unit}</span>
      </p>
      <p className="text-sm text-ink-700">
        {slot.why ?? `Window ${windowText(slot.spec) ?? "none"}`} · {personName(slot.record?.by ?? "")}, {londonTime(slot.record?.at)}
      </p>
      {canReview ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`exc-${slot.spec.id}`} className="block text-sm font-semibold text-ink-900">
            Your reason
          </label>
          <textarea id={`exc-${slot.spec.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base" />
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void review("accepted")} className={PRIMARY}>
              Accept
            </button>
            <button type="button" disabled={busy} onClick={() => void review("recapture-required")} className={SECONDARY}>
              Capture again
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm font-medium text-ink-700">Waiting for the tech lead.</p>
      )}
    </li>
  );
}

/** Why Sign waits: what's on the phone isn't on the server, and the certificate is made from the server's records. */
const onPhoneText = (n: number) =>
  `${n === 1 ? "1 capture for this job is" : `${n} captures for this job are`} still on this phone, not on the server. The certificate is made from what the server has: get signal and let them sync (tap the sync badge), then sign.`;

const fmtNum = (v: number | undefined, unit: string) => (v === undefined ? "Not recorded" : `${v} ${unit}`);

/** A result's decay record, shown the way the runsheet step shows the live test. */
function asTestView(kind: DecayTestView["kind"], rec: NonNullable<CommissioningResult["pressureTest"] | CommissioningResult["vacuumTest"]>): DecayTestView {
  return {
    kind,
    result: rec.result,
    retestNeeded: rec.result === "fail",
    failedRuns: rec.failedRuns,
    fails: rec.fails,
    invalid: [],
    toTake: [],
    pending: [],
    ...(kind === "pressure" ? { pressure: rec.figures as NonNullable<DecayTestView["pressure"]> } : { vacuum: rec.figures as NonNullable<DecayTestView["vacuum"]> }),
  };
}

export function Commissioning({ data: page, certificateHref, holds = [] }: { data: FieldJob; certificateHref?: string; holds?: Blocker[] }) {
  useRefreshOnSync();
  const catchUp = useCatchUp();
  const data = useFieldJob(page);
  const { header, me } = data;
  const merged = useMergedJob(data.job, me);
  const outboxState = useOutboxState();
  // Captures for this job still on this phone (waiting, or refused): the screen shows them, the server hasn't got them.
  const onPhone = outboxState.items.filter((i) => i.projectId === header.projectId).length;
  const [notes, setNotes] = useState("");
  // A job with a subcontractor (CDM 2015: more than one contractor) leaves a health and safety file: the tech lead's line for it.
  const [hsNote, setHsNote] = useState("");
  const severalContractors = header.crew.some((c) => c.external);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  // The server's answers to this screen, laid over the page's job until the page's own data has them.
  const [targetsNow, setTargetsNow] = useState<TargetAnswer[]>([]);
  const [reviewsNow, setReviewsNow] = useState<ExceptionReview[]>([]);
  const [signedNow, setSignedNow] = useState<SignAnswer | null>(null);
  const job = useMemo(
    () => (merged ? withAnswers(merged.job, { targets: targetsNow, reviews: reviewsNow, signed: signedNow }) : null),
    [merged, targetsNow, reviewsNow, signedNow],
  );
  const signed = job?.commissioning ?? null;
  const certHref = certificateHref ?? (signedNow?.certificate ? `/d/${signedNow.certificate.id}` : undefined);
  const onTarget = (a: TargetAnswer) => {
    setTargetsNow((list) => [...list, a]);
    catchUp();
  };
  const onReview = (r: ExceptionReview) => {
    setReviewsNow((list) => [...list, r]);
    catchUp();
  };

  const derived = useMemo(() => {
    if (!job) return null;
    return {
      results: signed?.results ?? commissioningFromJob(job),
      targets: jobTargets(job.runsheet),
      exceptions: openExceptions(job),
      progress: runsheetProgress(job),
      fgas: fgasFromJob(job),
      refs: electricalRefsFromJob(job),
      errors: commissioningSignErrors(job, me.staff, header.today),
    };
  }, [job, signed, me.staff, header.today]);

  async function sign() {
    setBusy(true);
    setError(null);
    setBlockers([]);
    // What's signed is what the server has: send anything still on this phone first, and never sign past it.
    const outbox = getFieldOutbox();
    await outbox.flush(true).catch(() => undefined);
    const left = outbox.state().items.filter((i) => i.projectId === header.projectId).length;
    if (left > 0) {
      setBusy(false);
      setError(onPhoneText(left));
      return;
    }
    // Every capture this screen showed: the server refuses if a newer one has arrived (another crew phone).
    const seen = (merged?.job.evidence ?? []).map((e) => e.id).filter((x): x is string => Boolean(x));
    const r = await postAnswer<SignAnswer>(`/api/field/jobs/${header.projectId}/commissioning`, { notes, seen, ...(severalContractors && hsNote.trim() ? { hsFileNote: hsNote.trim() } : {}) }, NO_REPLY);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setBlockers(r.blockers ?? []);
      return;
    }
    setSignedNow(r.data);
    answerHeader(header.projectId, r.data.header);
    catchUp();
  }

  return (
    <>
      <SyncBadge />
      <HeaderTitle>{header.customerName}</HeaderTitle>
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">Commissioning</p>
        <h1 className="font-display text-3xl leading-tight text-ink-900">{signed ? "Signed off" : "Results and sign-off"}</h1>
        <p className="mt-1 text-base text-ink-700">
          {signed
            ? `Signed by ${personName(signed.signedBy.name)} (F-gas ${signed.signedBy.qualificationRef || "ref not recorded"}), ${whenLabel(signed.at, header.today)}.`
            : me.canSign
              ? "Check the readings against the manual, set the job's targets, review anything out of its window, then sign."
              : "The tech lead signs commissioning. You can see the results as they come in."}
        </p>
      </header>

      {!job && (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {data.jobProblem ?? "There's no runsheet for this job yet."}
        </p>
      )}

      {derived && (
        <div className="space-y-10">
          {signed && (
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-lg font-semibold text-emerald-800">Commissioning is signed.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {certHref && (
                  <a href={certHref} className={SECONDARY + " flex items-center"}>
                    Commissioning certificate
                  </a>
                )}
                <Link href={`/field/jobs/${header.projectId}/handover`} className={PRIMARY + " flex items-center"}>
                  Next: handover →
                </Link>
              </div>
            </div>
          )}

          {!signed && (
            <section aria-labelledby="readiness">
              <h2 id="readiness" className="font-display text-2xl text-ink-900">
                Ready to sign?
              </h2>
              {derived.errors.length === 0 && holds.length === 0 && onPhone > 0 ? (
                <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">{onPhoneText(onPhone)}</p>
              ) : derived.errors.length === 0 && holds.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-800">Everything is in. Ready for your signature.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {derived.errors.map((e) => (
                    <li key={e} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
                      {e}
                    </li>
                  ))}
                  {holds.map((h) => (
                    <li key={h.code} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
                      {h.message.replace(/([^.])$/, "$1.")}
                      {h.code.startsWith("issue:") ? (
                        <Link href="/field/issues" className="ml-1 font-semibold text-accent-700 underline underline-offset-2">
                          Resolve it in Issues
                        </Link>
                      ) : h.action ? (
                        <span className="text-amber-800"> {h.action}.</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {derived.exceptions.length > 0 && (
            <section aria-labelledby="exceptions">
              <h2 id="exceptions" className="font-display text-2xl text-ink-900">
                Readings to review ({derived.exceptions.length})
              </h2>
              <p className="mb-3 mt-0.5 text-sm text-ink-500">Outside the job's window. Accept with a reason, or ask for it to be captured again.</p>
              <ul className="space-y-3">
                {derived.exceptions.map((x) => (
                  <ExceptionRow key={x.slot.spec.id} projectId={header.projectId} item={x} canReview={me.canReview} onAnswer={onReview} />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="targets">
            <h2 id="targets" className="font-display text-2xl text-ink-900">
              This job&apos;s targets
            </h2>
            <p className="mb-3 mt-0.5 text-sm text-ink-500">
              Manufacturer figures weren&apos;t verified in our research, so the tech lead sets each one from this model&apos;s manual. Readings already taken are judged against what you set.
            </p>
            <ul className="space-y-3">
              {derived.targets.map((t) => (
                <TargetRow key={t.key} projectId={header.projectId} target={t} canEdit={me.canReview} locked={Boolean(signed)} onAnswer={onTarget} />
              ))}
            </ul>
          </section>

          <section aria-labelledby="results">
            <h2 id="results" className="font-display text-2xl text-ink-900">
              Results
            </h2>
            <p className="mb-3 mt-0.5 text-sm text-ink-500">From the runsheet: the latest reading for each slot.</p>
            <div className="space-y-4">
              {derived.results.map((r) => {
                const fg = derived.fgas.find((f) => f.system === r.system)?.record;
                return (
                  <article key={r.system} className="rounded-2xl border border-line bg-white p-4">
                    <h3 className="text-lg font-semibold text-ink-900">{r.system}</h3>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-base">
                      <dt className="text-ink-500">Test pressure</dt>
                      <dd className="tabular-nums text-ink-900">{fmtNum(r.strengthTestBar, "bar g")}</dd>
                      <dt className="text-ink-500">After the hold</dt>
                      <dd className="tabular-nums text-ink-900">{fmtNum(r.holdBar, "bar g")}</dd>
                      <dt className="text-ink-500">Vacuum</dt>
                      <dd className="tabular-nums text-ink-900">{fmtNum(r.vacuumMicrons, "micron")}</dd>
                      <dt className="text-ink-500">After decay hold</dt>
                      <dd className="tabular-nums text-ink-900">{fmtNum(r.decayMicrons, "micron")}</dd>
                      <dt className="text-ink-500">Refrigerant added</dt>
                      <dd className="tabular-nums text-ink-900">{fmtNum(r.additionalChargeG, "g")}</dd>
                      {r.expectedChargeG !== undefined && (
                        <>
                          <dt className="text-ink-500">Expected from the as-built length</dt>
                          <dd className="tabular-nums text-ink-900">
                            {r.expectedChargeG} g{r.chargeToleranceG !== undefined ? ` (± ${r.chargeToleranceG} g)` : ""}
                          </dd>
                        </>
                      )}
                      {r.noiseDb !== undefined && (
                        <>
                          <dt className="text-ink-500">Noise QA (1 m)</dt>
                          <dd className="tabular-nums text-ink-900">{r.noiseDb} dB(A)</dd>
                        </>
                      )}
                    </dl>
                    {(r.pressureTest || r.vacuumTest) && (
                      <div className="mt-3 space-y-2">
                        {r.pressureTest && <DecayPanel test={asTestView("pressure", r.pressureTest)} />}
                        {r.vacuumTest && <DecayPanel test={asTestView("vacuum", r.vacuumTest)} />}
                      </div>
                    )}
                    {Object.keys(r.coolingSplitC).length + Object.keys(r.heatingSplitC).length > 0 && (
                      <table className="mt-4 w-full text-left text-base">
                        <caption className="mb-1 text-left text-sm font-semibold text-ink-900">Air temperature split, °C (recorded, no pass/fail)</caption>
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-ink-500">
                            <th scope="col" className="py-1 font-semibold">Room</th>
                            <th scope="col" className="py-1 font-semibold">Cooling</th>
                            <th scope="col" className="py-1 font-semibold">Heating</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...new Set([...Object.keys(r.coolingSplitC), ...Object.keys(r.heatingSplitC)])].map((room) => (
                            <tr key={room} className="border-t border-line">
                              <th scope="row" className="py-1.5 font-normal text-ink-900">{room}</th>
                              <td className="py-1.5 tabular-nums">{r.coolingSplitC[room] ?? "–"}</td>
                              <td className="py-1.5 tabular-nums">{r.heatingSplitC[room] ?? "–"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {r.serials.length > 0 && (
                      <ul className="mt-4 space-y-1 text-sm">
                        {r.serials.map((s) => (
                          <li key={s.item + s.serial} className="flex justify-between gap-3">
                            <span className="text-ink-700">{s.item}</span>
                            <span className="font-mono text-ink-900">{s.serial}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-4 rounded-xl bg-surface px-3 py-2 text-sm text-ink-900">
                      <p className="font-semibold">F-gas label</p>
                      {fg ? (
                        <p className="tabular-nums">
                          {fg.refrigerant}: factory {fg.factoryChargeKg} kg + added {fg.additionalChargeKg} kg = {fg.totalKg} kg · {fg.tco2e} tCO2e (GWP {fg.gwp})
                        </p>
                      ) : (
                        <p className="text-ink-700">Not complete: needs the factory charge and the weight added.</p>
                      )}
                    </div>
                  </article>
                );
              })}
              {derived.results.length === 0 && <p className="text-base text-ink-700">No results yet.</p>}
              <div className="rounded-2xl border border-line bg-white p-4 text-base">
                <p className="font-semibold text-ink-900">Electrical certificate</p>
                <p className="text-ink-700">
                  EIC {derived.refs.eic ?? "not recorded yet"} · scheme {derived.refs.scheme ?? "not recorded yet"}
                </p>
              </div>
            </div>
          </section>

          {!signed && me.canSign && (
            <section aria-labelledby="sign" className="rounded-2xl border border-line bg-white p-4">
              <h2 id="sign" className="font-display text-2xl text-ink-900">
                Sign commissioning
              </h2>
              <p className="mt-1 text-sm text-ink-500">Signing completes the install, records commissioning on the project for the customer, and issues the certificate. It can&apos;t be undone from the field.</p>
              <label htmlFor="comm-notes" className="mt-3 block text-sm font-semibold text-ink-900">
                Notes (optional, printed on the certificate)
              </label>
              <textarea id="comm-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5 w-full rounded-2xl border border-line bg-white px-4 py-3 text-base" />
              {severalContractors && (
                <>
                  <label htmlFor="comm-hs" className="mt-3 block text-sm font-semibold text-ink-900">
                    For the health and safety file (a subcontractor worked on this job)
                  </label>
                  <p className="text-sm text-ink-500">
                    The pack lists the pipe and cable routes as built, the R32, the isolators and the manuals. Add what else the next person working on it should know (hidden fixings, anything left in place, safe access), or leave it blank.
                  </p>
                  <textarea id="comm-hs" rows={3} maxLength={2000} value={hsNote} onChange={(e) => setHsNote(e.target.value)} className="mt-1.5 w-full rounded-2xl border border-line bg-white px-4 py-3 text-base" />
                </>
              )}
              {error && (
                <p role="alert" className="mt-2 text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
              {blockers.length > 0 && (
                <div className="mt-3">
                  <BlockerList blockers={blockers} />
                </div>
              )}
              <button type="button" disabled={busy || derived.errors.length + holds.length + onPhone > 0} onClick={sign} className={`${PRIMARY} mt-3 w-full`}>
                {busy ? "Signing…" : derived.errors.length + holds.length ? "Not ready to sign" : onPhone ? "Sync first" : `Sign as ${personName(me.name)}`}
              </button>
            </section>
          )}
        </div>
      )}
    </>
  );
}
