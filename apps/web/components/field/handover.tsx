"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { handoverSteps, stepView, type Blocker, type HandoverPackSnapshot } from "@aircon/domain";
import { BlockerList } from "@/components/kit/blocker-list";
import { newOpId } from "@/lib/field-outbox";
import { uploadMedia } from "@/lib/media-client";
import { fmtDate, whenLabel } from "./format";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { StepCard } from "./step-card";
import { HeaderTitle, SyncBadge } from "./sync-badge";
import type { FieldJob } from "./types";
import { useMergedJob, useRefreshOnSync } from "./use-outbox";

/**
 * Handover, on the installer's phone with the customer beside them:
 *  1. the walkthrough (show, don't tell),
 *  2. the handover pack, published once commissioning is signed,
 *  3. the customer's sign-off: "All good" or "There's a snag" (each snag
 *     becomes an issue they can see), with their name and signature.
 */

const BTN = "min-h-12 rounded-full px-5 font-semibold disabled:opacity-40";
const PRIMARY = `${BTN} bg-accent-600 text-white shadow-sm hover:bg-accent-700`;
const SECONDARY = `${BTN} border border-line bg-white text-ink-900 hover:bg-surface`;

async function post(url: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; blockers?: Blocker[] }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; blockers?: Blocker[] };
    if (!res.ok) return { ok: false, error: data.error ?? `That didn't work (${res.status}).`, ...(data.blockers ? { blockers: data.blockers } : {}) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "No connection. This step needs signal: try again in a minute." };
  }
}

function StepHeading({ n, title, done, children }: { n: number; title: string; done: boolean; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${done ? "bg-emerald-600 text-white" : "bg-ink-900 text-white"}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-2xl leading-tight text-ink-900">{title}</h2>
        {children && <div className="mt-0.5 text-sm text-ink-500">{children}</div>}
      </div>
    </div>
  );
}

function PackPreview({ pack, missing }: { pack: HandoverPackSnapshot; missing: string[] }) {
  return (
    <div className="space-y-4 rounded-2xl border border-line bg-white p-4 text-base">
      {missing.length > 0 && (
        <ul className="space-y-1">
          {missing.map((m) => (
            <li key={m} className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              {m}
            </li>
          ))}
        </ul>
      )}
      <div>
        <h3 className="font-semibold text-ink-900">Your equipment</h3>
        <ul className="mt-1 divide-y divide-line">
          {pack.equipment.map((e) => (
            <li key={`${e.room}-${e.model}-${e.serial}`} className="flex flex-wrap justify-between gap-x-3 py-1.5">
              <span className="text-ink-900">
                {e.room}: {e.label}
              </span>
              <span className="font-mono text-sm text-ink-700">{e.serial || "serial not captured"}</span>
            </li>
          ))}
        </ul>
      </div>
      {pack.fgas.length > 0 && (
        <div>
          <h3 className="font-semibold text-ink-900">F-gas record</h3>
          {pack.fgas.map((f) => (
            <p key={f.system} className="text-sm tabular-nums text-ink-700">
              {f.system}: {f.refrigerant}, {f.totalKg} kg total ({f.factoryChargeKg} factory + {f.additionalChargeKg} added), {f.tco2e} tCO2e
            </p>
          ))}
        </div>
      )}
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="font-semibold text-ink-900">Electrical certificate</dt>
          <dd className="text-ink-700">{pack.electricalCert.status === "received" ? "Received" : pack.electricalCert.status === "not-required" ? "Not required" : `Pending: due by ${fmtDate(pack.electricalCert.dueBy)} (Building Regulations, within 30 days)`}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-900">How to run and look after it</dt>
          <dd className="text-ink-700">In the pack now (due by {fmtDate(pack.maintenanceInfo.dueBy)}).</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-900">Warranty</dt>
          <dd className="text-ink-700">
            {pack.warranty.text ?? "No warranty wording in our settings yet: the office confirms it."}
            {pack.warranty.registered ? " Registered." : pack.warranty.dueOn ? ` We register it for you by ${fmtDate(pack.warranty.dueOn)}.` : ""}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="font-semibold text-ink-900">Care guide</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-700">
          {pack.care.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-ink-700">
        Something not right later? {pack.contacts.find((c) => c.label === "Report a problem")?.phone ?? pack.company.phone} or report it from their project page.
      </p>
    </div>
  );
}

export function Handover({ data, pack, missing }: { data: FieldJob; pack: HandoverPackSnapshot | null; missing: string[] }) {
  useRefreshOnSync();
  const router = useRouter();
  const { header, me } = data;
  const merged = useMergedJob(data.job, me);
  const commissioned = header.handoverStatus !== "pending";
  const handedOver = header.handoverStatus === "handed-over";
  const published = Boolean(header.packDocumentId);
  const walk = merged ? handoverSteps(merged.job.runsheet).map((s) => stepView(merged.job, s)) : [];
  const walkDone = walk.length > 0 && walk.every((v) => v.state === "done" || v.state === "na");

  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<"all-good" | "snags" | null>(null);
  const [snags, setSnags] = useState<{ id: string; text: string }[]>([]);
  const [hasSig, setHasSig] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const pad = useRef<SignaturePadHandle>(null);

  const refusal = header.installStatus === "not-started" ? "The install hasn't started." : null;

  async function publish() {
    setPublishing(true);
    setError(null);
    const r = await post(`/api/field/jobs/${header.projectId}/handover`, { action: "publish" });
    setPublishing(false);
    if (!r.ok) {
      setError(r.error);
      setBlockers(r.blockers ?? []);
      return;
    }
    const email = (r.data.email as { status?: string } | undefined)?.status;
    setPublishMsg(email === "sent" ? "Published and emailed to the customer." : email === "demo" ? "Published. Demo mode: the email was recorded, not sent." : "Published: it's on their project page.");
    router.refresh();
  }

  async function sign() {
    setError(null);
    setBlockers([]);
    if (name.trim().length < 2) return setError("Their full name, please.");
    if (!outcome) return setError("All good, or is there a snag?");
    const list = snags.filter((s) => s.text.trim().length >= 3);
    if (outcome === "snags" && list.length === 0) return setError("Write down each snag (a few words is fine).");
    setSigning(true);
    try {
      let signatureMediaId: string | undefined;
      const blob = await pad.current?.toBlob();
      if (!blob) {
        setSigning(false);
        return setError("Ask them to sign in the box.");
      }
      const item = await uploadMedia(blob, { projectId: header.projectId, tag: "signature", source: "handover", fileName: "handover-signature.png", caption: `Handover signed by ${name.trim()}` });
      signatureMediaId = item.id;
      const r = await post(`/api/field/jobs/${header.projectId}/handover`, { action: "sign", name: name.trim(), outcome, snags: outcome === "snags" ? list : [], signatureMediaId });
      if (!r.ok) {
        setError(r.error);
        setBlockers(r.blockers ?? []);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The signature didn't upload. Check the signal and try again.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <>
      <SyncBadge />
      <HeaderTitle>{header.customerName}</HeaderTitle>
      <header className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">Handover</p>
        <h1 className="font-display text-3xl leading-tight text-ink-900">{handedOver ? "Handed over" : "With the customer"}</h1>
        <p className="mt-1 text-base text-ink-700">
          {handedOver && header.signoff
            ? `Signed by ${header.signoff.name}, ${whenLabel(header.signoff.at, header.today)}${header.signoff.outcome === "snags" ? `, with ${header.signoff.snagCount} snag${header.signoff.snagCount === 1 ? "" : "s"} to fix` : ": all good"}.`
            : "Walk them through it, publish their pack, and ask them to sign."}
        </p>
      </header>

      {handedOver ? (
        <div className="space-y-4">
          <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-lg font-semibold text-emerald-800">
            Done. Thank them, and leave it tidy.
          </p>
          {header.signoff?.outcome === "snags" && (
            <Link href="/field/issues" className={`${SECONDARY} flex items-center justify-center`}>
              See the snags
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="walk">
            <StepHeading n={1} title="Walkthrough" done={walkDone}>
              Let them press the buttons. Tick each one as you show it.
            </StepHeading>
            {walk.length === 0 || !merged ? (
              <p className="rounded-2xl bg-surface px-4 py-3 text-base text-ink-700">{data.jobProblem ?? "This runsheet has no walkthrough step."}</p>
            ) : (
              <ul className="space-y-3">
                {walk.map((v) => (
                  <StepCard key={v.step.id} projectId={header.projectId} view={v} merged={merged} me={me.staff} today={header.today} mediaUrls={data.mediaUrls} refusal={refusal} expanded onToggle={() => undefined} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="pack">
            <StepHeading n={2} title="Their handover pack" done={published}>
              {commissioned ? (published ? "Published. Publishing again makes a new version." : "Check it with them, then publish: they get it by email and on their project page.") : "Opens once the tech lead signs commissioning."}
            </StepHeading>
            {!commissioned && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
                <p className="font-semibold">Commissioning isn&apos;t signed yet.</p>
                <Link href={`/field/jobs/${header.projectId}/commissioning`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent-700 underline underline-offset-2">
                  Go to commissioning →
                </Link>
              </div>
            )}
            {commissioned && pack && <PackPreview pack={pack} missing={missing} />}
            {commissioned && (
              <div className="mt-3 space-y-2" aria-live="polite">
                {publishMsg && <p className="rounded-2xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-800">{publishMsg}</p>}
                <button type="button" disabled={publishing} onClick={publish} className={`${published ? SECONDARY : PRIMARY} w-full`}>
                  {publishing ? "Publishing…" : published ? "Publish an updated pack" : "Publish the handover pack"}
                </button>
              </div>
            )}
          </section>

          <section aria-labelledby="signoff">
            <StepHeading n={3} title="Their sign-off" done={false}>
              {published ? (walkDone ? "Hand them the phone." : "Finish the walkthrough first.") : "After the pack is published."}
            </StepHeading>
            <fieldset disabled={!published || !walkDone || signing} className="space-y-4 rounded-2xl border border-line bg-white p-4 disabled:opacity-60">
              <legend className="sr-only">Customer sign-off</legend>
              <div>
                <label htmlFor="signoff-name" className="mb-1.5 block text-sm font-semibold text-ink-900">
                  Your full name
                </label>
                <input id="signoff-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="min-h-12 w-full rounded-full border border-line bg-white px-4 text-lg text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100" />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-ink-900">How did we do?</legend>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" aria-pressed={outcome === "all-good"} onClick={() => setOutcome("all-good")} className={`min-h-14 rounded-2xl border text-lg font-semibold ${outcome === "all-good" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-line bg-white text-ink-900"}`}>
                    All good
                  </button>
                  <button
                    type="button"
                    aria-pressed={outcome === "snags"}
                    onClick={() => {
                      setOutcome("snags");
                      if (snags.length === 0) setSnags([{ id: newOpId(), text: "" }]);
                    }}
                    className={`min-h-14 rounded-2xl border text-lg font-semibold ${outcome === "snags" ? "border-amber-600 bg-amber-50 text-amber-900" : "border-line bg-white text-ink-900"}`}
                  >
                    There&apos;s a snag
                  </button>
                </div>
              </fieldset>
              {outcome === "snags" && (
                <div className="space-y-2">
                  <p className="text-sm text-ink-700">Each snag gets an owner and a date, and you&apos;ll see them on your project page.</p>
                  {snags.map((s, i) => (
                    <div key={s.id} className="flex gap-2">
                      <label htmlFor={`snag-${s.id}`} className="sr-only">
                        Snag {i + 1}
                      </label>
                      <input
                        id={`snag-${s.id}`}
                        value={s.text}
                        placeholder={`Snag ${i + 1}, e.g. a mark on the wall by the unit`}
                        onChange={(e) => setSnags((list) => list.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)))}
                        className="min-h-12 w-full min-w-0 flex-1 rounded-full border border-line bg-white px-4 text-base"
                      />
                      {snags.length > 1 && (
                        <button type="button" onClick={() => setSnags((list) => list.filter((x) => x.id !== s.id))} className="min-h-12 rounded-full px-3 text-sm font-semibold text-ink-700" aria-label={`Remove snag ${i + 1}`}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {snags.length < 10 && (
                    <button type="button" onClick={() => setSnags((list) => [...list, { id: newOpId(), text: "" }])} className={`${SECONDARY} w-full`}>
                      Add another snag
                    </button>
                  )}
                </div>
              )}
              <SignaturePad ref={pad} label="Customer signature" onChange={(empty) => setHasSig(!empty)} />
              {error && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
              {blockers.length > 0 && <BlockerList blockers={blockers} />}
              <button type="button" disabled={signing || !hasSig || !outcome || name.trim().length < 2} onClick={sign} className={`${PRIMARY} w-full`}>
                {signing ? "Saving…" : "Sign off the handover"}
              </button>
            </fieldset>
          </section>
        </div>
      )}
    </>
  );
}
