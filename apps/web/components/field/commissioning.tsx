"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  JOB_TARGETS,
  commissioningFromJob,
  commissioningSignErrors,
  electricalRefsFromJob,
  fgasFromJob,
  jobTargets,
  openExceptions,
  runsheetProgress,
  windowText,
  type Blocker,
  type JobTarget,
} from "@aircon/domain";
import { BlockerList } from "@/components/kit/blocker-list";
import { parseReading } from "./capture";
import { londonTime, whenLabel } from "./format";
import { HeaderTitle, SyncBadge } from "./sync-badge";
import type { FieldJob } from "./types";
import { useMergedJob, useRefreshOnSync } from "./use-outbox";

/**
 * Commissioning, for the tech lead: the results per system as the evidence
 * says them, the job's manufacturer targets (set or confirmed here), the
 * exceptions to review, and the signature. Signing completes the install,
 * signs commissioning on the project and issues the certificate. Everyone
 * else on the job sees the same results, read-only.
 */

const BTN = "min-h-12 rounded-full px-5 font-semibold disabled:opacity-40";
const PRIMARY = `${BTN} bg-accent-600 text-white shadow-sm hover:bg-accent-700`;
const SECONDARY = `${BTN} border border-line bg-white text-ink-900 hover:bg-surface`;
const INPUT = "min-h-12 w-full rounded-full border border-line bg-white px-4 text-lg text-ink-900 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100";

async function post(url: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; blockers?: Blocker[] }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; blockers?: Blocker[] };
    if (!res.ok) return { ok: false, error: data.error ?? `That didn't work (${res.status}).`, ...(data.blockers ? { blockers: data.blockers } : {}) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "No connection. Sign-off needs signal: try again outside or in a minute." };
  }
}

const BASIS: Record<JobTarget["basis"], { text: string; tone: string }> = {
  record: { text: "No target yet", tone: "bg-amber-50 text-amber-900" },
  candidate: { text: "Candidate: confirm it", tone: "bg-amber-50 text-amber-900" },
  "tech-lead": { text: "Set", tone: "bg-emerald-50 text-emerald-800" },
};

function TargetRow({ projectId, target, canEdit, locked }: { projectId: string; target: JobTarget; canEdit: boolean; locked: boolean }) {
  const router = useRouter();
  const def = JOB_TARGETS[target.key];
  const [min, setMin] = useState(target.min !== undefined ? String(target.min) : "");
  const [max, setMax] = useState(target.max !== undefined ? String(target.max) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = BASIS[target.basis];
  const showMin = def.bounds !== "max";
  const showMax = def.bounds !== "min";

  async function save(recordOnly: boolean) {
    setError(null);
    const lo = recordOnly || !showMin || !min.trim() ? undefined : parseReading(min);
    const hi = recordOnly || !showMax || !max.trim() ? undefined : parseReading(max);
    if (lo === null || hi === null) return setError("Numbers only.");
    setBusy(true);
    const r = await post(`/api/field/jobs/${projectId}/targets`, { key: target.key, ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <li className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">{def.label}</p>
          <p className="text-sm text-ink-700">
            {windowText({ ...(target.min !== undefined ? { min: target.min } : {}), ...(target.max !== undefined ? { max: target.max } : {}), unit: def.unit }) ?? "Record only"}
            {target.basis === "tech-lead" && target.setBy ? ` · ${target.setBy.replace(/^DEMO /, "")}` : ""}
            {` · ${target.specCount} reading${target.specCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.tone}`}>{b.text}</span>
      </div>
      <p className="mt-2 text-sm text-ink-500">{def.hint}</p>
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
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void save(false)} className={`${PRIMARY} flex-1`}>
              {busy ? "Saving…" : target.basis === "candidate" ? "Confirm these numbers" : "Set target"}
            </button>
            {target.key !== "pressure.test" && (
              <button type="button" disabled={busy} onClick={() => void save(true)} className={SECONDARY}>
                Record only
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ExceptionRow({ projectId, item, canReview }: { projectId: string; item: ReturnType<typeof openExceptions>[number]; canReview: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { step, slot } = item;
  async function review(resolution: "accepted" | "recapture-required") {
    if (reason.trim().length < 3) return setError("Give the reason: it goes on the record.");
    setBusy(true);
    setError(null);
    const r = await post(`/api/field/jobs/${projectId}/exceptions`, { specId: slot.spec.id, ...(slot.record?.id ? { evidenceId: slot.record.id } : {}), resolution, reason });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setReason("");
    router.refresh();
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
        Window {windowText(slot.spec) ?? "none"} · {slot.record?.by.replace(/^DEMO /, "")}, {londonTime(slot.record?.at)}
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

const fmtNum = (v: number | undefined, unit: string) => (v === undefined ? "Not recorded" : `${v} ${unit}`);

export function Commissioning({ data, certificateHref }: { data: FieldJob; certificateHref?: string }) {
  useRefreshOnSync();
  const router = useRouter();
  const { header, me } = data;
  const merged = useMergedJob(data.job, me);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const job = merged?.job ?? null;
  const signed = job?.commissioning ?? null;

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
    const r = await post(`/api/field/jobs/${header.projectId}/commissioning`, { notes });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setBlockers(r.blockers ?? []);
      return;
    }
    router.refresh();
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
            ? `Signed by ${signed.signedBy.name.replace(/^DEMO /, "")} (F-gas ${signed.signedBy.qualificationRef || "ref not recorded"}), ${whenLabel(signed.at, header.today)}.`
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
                {certificateHref && (
                  <a href={certificateHref} className={SECONDARY + " flex items-center"}>
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
              {derived.errors.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-800">Everything is in. Ready for your signature.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {derived.errors.map((e) => (
                    <li key={e} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
                      {e}
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
                  <ExceptionRow key={x.slot.spec.id} projectId={header.projectId} item={x} canReview={me.canReview} />
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
                <TargetRow key={t.key} projectId={header.projectId} target={t} canEdit={me.canReview} locked={Boolean(signed)} />
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
                      {r.noiseDb !== undefined && (
                        <>
                          <dt className="text-ink-500">Noise QA (1 m)</dt>
                          <dd className="tabular-nums text-ink-900">{r.noiseDb} dB(A)</dd>
                        </>
                      )}
                    </dl>
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
              <button type="button" disabled={busy || derived.errors.length > 0} onClick={sign} className={`${PRIMARY} mt-3 w-full`}>
                {busy ? "Signing…" : derived.errors.length ? "Not ready to sign" : `Sign as ${me.name.replace(/^DEMO /, "")}`}
              </button>
            </section>
          )}
        </div>
      )}
    </>
  );
}
