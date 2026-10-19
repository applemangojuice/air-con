"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { handoverDeadlines, isFullName, variationAgreeWording } from "@aircon/domain";
import { Input, Textarea } from "@/components/kit/form";
import { fmtDate, fmtDay, fmtInstantDay, fmtInstantDayTime, money } from "@/lib/format";
import {
  ActionFeedback,
  Callout,
  Explainer,
  Locked,
  Primary,
  ReadOnlyNote,
  Secondary,
  StageShell,
  Sub,
  primaryCls,
  useAction,
  ReachUs,
} from "./bits";
import { useHub } from "./controller";
import type { PanelProps } from "./panel-types";
import type { HubIssue, HubPhoto } from "./types";
import { arrivalTime, installPlan, onMyWayFresh } from "./view";

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

const ISSUE_STATUS: Record<HubIssue["status"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  "in-progress": { label: "We're on it", cls: "border-sage-200 bg-sage-50 text-sage-700" },
  "awaiting-customer": { label: "Waiting for you", cls: "border-accent-100 bg-accent-50 text-accent-700" },
  resolved: { label: "Fixed", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  closed: { label: "Closed", cls: "border-line bg-surface text-ink-700" },
  rejected: { label: "Closed", cls: "border-line bg-surface text-ink-700" },
};

function IssueChip({ status }: { status: HubIssue["status"] }) {
  const s = ISSUE_STATUS[status];
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function PhotoGrid({ photos, label }: { photos: HubPhoto[]; label: string }) {
  if (photos.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={label}>
      {photos.map((ph) => (
        <li key={ph.id} className="overflow-hidden rounded-xl border border-line bg-surface">
          {ph.url ? (
            <a href={ph.url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URLs */}
              <img
                src={ph.url}
                alt={ph.caption ?? "Photo from your install"}
                width={ph.width ?? 400}
                height={ph.height ?? 300}
                loading="lazy"
                className="aspect-[4/3] h-auto w-full object-cover"
              />
            </a>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center px-2 text-center text-xs text-ink-500">Photo still uploading</div>
          )}
          {ph.caption && <p className="px-2 py-1.5 text-xs text-ink-700">{ph.caption}</p>}
        </li>
      ))}
    </ul>
  );
}

const tel = (phone: string) => `tel:${phone.replace(/\s+/g, "")}`;

/* ------------------------------------------------------------------ */
/* 6 · Install                                                         */
/* ------------------------------------------------------------------ */

function VariationCard({ issue }: { issue: HubIssue }) {
  const { run, busy, error, message, readOnly, clear } = useAction();
  const [choice, setChoice] = useState<"accept" | "decline" | null>(null);
  // A yes is an agreement to pay: it takes a second, deliberate step with their name.
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const v = issue.variation!;
  const up = v.totalDeltaPence >= 0;
  const wording = variationAgreeWording(v);
  const nameOk = isFullName(name);
  const nameId = useId();
  return (
    <article className="space-y-3 rounded-2xl border border-accent-100 bg-white p-4 shadow-sm sm:p-5" aria-labelledby={`var-${issue.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id={`var-${issue.id}`} className="font-semibold text-ink-900">
          Change #{issue.number}: {issue.title}
        </h4>
        <span className="rounded-full border border-accent-100 bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">Needs your answer</span>
      </div>
      <p className="text-[15px] leading-relaxed text-ink-700">{v.description}</p>
      <dl className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface/70 px-4 py-3">
        <dt className="text-sm text-ink-500">Price change</dt>
        <dd className="font-display text-2xl tabular-nums text-ink-900">
          {up ? "+" : ""}
          {money(v.totalDeltaPence)}
          {v.taxPence > 0 && <span className="ml-1 font-sans text-xs text-ink-500">incl. {money(v.taxPence)} VAT</span>}
        </dd>
      </dl>
      <p className="text-sm text-ink-500">No extra work happens without your yes. If you say no, we carry on exactly as agreed.</p>
      <ReadOnlyNote />
      <ActionFeedback error={error} message={message} />
      {confirming ? (
        <div className="space-y-3 rounded-2xl border border-line bg-cream p-4">
          <p className="text-sm font-semibold text-ink-900">Agree to this change</p>
          <p className="text-sm leading-relaxed text-ink-700">
            {v.totalDeltaPence > 0
              ? `It adds ${money(v.totalDeltaPence)} to your contract price${v.taxPence > 0 ? `, including ${money(v.taxPence)} VAT` : ""}, paid with your balance on the same terms.`
              : v.totalDeltaPence < 0
                ? `It takes ${money(-v.totalDeltaPence)} off your contract price.`
                : "It doesn't change your price."}{" "}
            We&apos;ll email you a copy and keep it in your documents. Changed your mind later? Tell us before we start this work and we won&apos;t do it.
          </p>
          <Input
            id={nameId}
            label="Your full name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...(touched && !nameOk ? { error: "Type your first name and surname." } : {})}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Primary
              onClick={() => {
                setTouched(true);
                if (!nameOk) return;
                setChoice("accept");
                void run({ kind: "variation", issueId: issue.id, decision: "accept", name: name.trim(), agreed: true });
              }}
              disabled={readOnly}
              busy={busy && choice === "accept"}
              busyLabel="Saving…"
            >
              {wording}
            </Primary>
            <Secondary
              onClick={() => {
                clear();
                setConfirming(false);
                setTouched(false);
              }}
              disabled={busy}
            >
              Back
            </Secondary>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Primary
            onClick={() => {
              clear();
              setConfirming(true);
            }}
            disabled={readOnly}
          >
            Yes, go ahead ({up ? "+" : ""}
            {money(v.totalDeltaPence)})
          </Primary>
          <Secondary
            onClick={() => {
              setChoice("decline");
              void run({ kind: "variation", issueId: issue.id, decision: "decline" });
            }}
            disabled={readOnly || busy}
          >
            {busy && choice === "decline" ? "Saving…" : "No thanks"}
          </Secondary>
        </div>
      )}
    </article>
  );
}

export function InstallPanel({ data, state }: PanelProps) {
  const p = data.project;
  const info = data.stages.install;
  const plan = installPlan(p.booking.installDays);
  const dayOf = (n: number) => p.install.days.find((d) => d.n === n);
  const dateOf = (n: number) => dayOf(n)?.date ?? p.booking.dates[n - 1];
  const updates = p.install.days.filter((d) => d.customerUpdate).sort((a, b) => (b.customerUpdate!.sentAt > a.customerUpdate!.sentAt ? 1 : -1));
  const variations = data.issues.filter((i) => i.kind === "variation" && i.variation);
  const waiting = variations.filter((i) => i.variation!.status === "proposed" && (i.status === "open" || i.status === "in-progress" || i.status === "awaiting-customer"));
  const decided = variations.filter((i) => i.variation!.status !== "proposed");
  // Fresh, and they haven't arrived yet (no day started since the message).
  const arrived = p.install.days.some((d) => d.startedAt && p.install.onMyWay && d.startedAt >= p.install.onMyWay.at);
  const omw = onMyWayFresh(p.install.onMyWay, data.nowIso) && !arrived && p.install.status !== "complete" ? p.install.onMyWay : null;
  const lead = data.crew[0];

  return (
    <StageShell info={info} state={state}>
      {omw && (
        <Callout tone="you" title={`${omw.by || lead?.name || "Your installer"} is on the way: about ${omw.etaMinutes} minutes`}>
          Expected around {arrivalTime(omw)}.
        </Callout>
      )}
      {waiting.length > 0 && (
        <div className="space-y-3">
          <Sub>A change needs your answer</Sub>
          {waiting.map((issue) => (
            <VariationCard key={issue.id} issue={issue} />
          ))}
        </div>
      )}
      <div className="space-y-3">
        <Sub>The plan, day by day</Sub>
        <ol className="space-y-2">
          {plan.map((d) => {
            const actual = dayOf(d.n);
            const status = actual?.status ?? "planned";
            const date = dateOf(d.n);
            return (
              <li
                key={d.n}
                className={`rounded-2xl border p-4 ${status === "in-progress" ? "border-accent-100 bg-accent-50" : status === "done" ? "border-emerald-200 bg-emerald-50/60" : "border-line bg-white"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink-900">
                    Day {d.n}
                    {date ? ` · ${fmtDay(date)}` : ""}: {d.title}
                  </p>
                  <span className={`text-xs font-semibold ${status === "done" ? "text-emerald-800" : status === "in-progress" ? "text-accent-700" : "text-ink-500"}`}>
                    {status === "done" ? "Done" : status === "in-progress" ? "Today" : "Planned"}
                  </span>
                </div>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-700">{d.body}</p>
              </li>
            );
          })}
          {p.install.days
            .filter((d) => d.n > plan.length)
            .map((d) => (
              <li key={d.n} className="rounded-2xl border border-line bg-white p-4">
                <p className="font-semibold text-ink-900">
                  Day {d.n} · {fmtDay(d.date)}: extra time to finish
                </p>
              </li>
            ))}
        </ol>
      </div>
      <Callout tone="warn" title="The power goes off for up to 30 minutes">
        On the day we connect the new circuit. We&apos;ll tell you before we switch off, so you can save anything you&apos;re working on.
      </Callout>
      <div className="space-y-3">
        <Sub>End-of-day updates</Sub>
        {updates.length ? (
          <ol className="space-y-4">
            {updates.map((d) => (
              <li key={d.n} className="space-y-3 rounded-2xl border border-line bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Day {d.n} · {fmtInstantDayTime(d.customerUpdate!.sentAt)}
                </p>
                <p className="text-[15px] leading-relaxed text-ink-900">{d.customerUpdate!.text}</p>
                <PhotoGrid photos={d.customerUpdate!.mediaIds.map((id) => data.photos[id] ?? { id, url: null })} label={`Photos from day ${d.n}`} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[15px] text-ink-700">At the end of each day your installer sends a short update with a few photos. They&apos;ll appear here.</p>
        )}
      </div>
      {decided.length > 0 && (
        <div className="space-y-2">
          <Sub>Changes you&apos;ve decided</Sub>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {decided.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-[15px]">
                <span className="font-medium text-ink-900">
                  #{i.number} {i.title}
                </span>
                <span className="text-sm text-ink-500">
                  {i.variation!.status === "accepted" ? "You said yes" : "You said no"}
                  {i.variation!.decidedAt ? `, ${fmtInstantDay(i.variation!.decidedAt)}` : ""} · {i.variation!.totalDeltaPence >= 0 ? "+" : ""}
                  {money(i.variation!.totalDeltaPence)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state === "upcoming" && <Explainer info={info} />}
      <p className="text-sm text-ink-500">
        Questions on the day? <ReachUs company={data.company} capital className="font-semibold text-accent-700 underline underline-offset-2" />.
      </p>
    </StageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Handover                                                        */
/* ------------------------------------------------------------------ */

function PaperRow({ label, status, detail }: { label: string; status: "done" | "pending" | "na"; detail?: string }) {
  const chip =
    status === "done"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "pending"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-line bg-surface text-ink-700";
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink-900">{label}</span>
        {detail && <span className="block text-sm text-ink-500">{detail}</span>}
      </span>
      <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip}`}>
        {status === "done" ? "Done" : status === "pending" ? "To come" : "Not needed"}
      </span>
    </li>
  );
}

export function HandoverPanel({ data, state, goTo }: PanelProps) {
  const p = data.project;
  const h = p.handover;
  const info = data.stages.handover;
  const hub = useHub();
  if (h.status === "pending" && p.install.status !== "complete") {
    return (
      <StageShell info={info} state={state}>
        <Explainer info={info} />
        <Locked>Your handover happens on the last install day.</Locked>
      </StageShell>
    );
  }
  const completedOn = data.pack?.completedOn || p.install.completedAt?.slice(0, 10);
  const due = completedOn ? handoverDeadlines(completedOn) : null;
  const packHref = h.packDocumentId ? hub.hrefs.document(h.packDocumentId) : null;
  const cert = data.documents.find((d) => d.kind === "commissioning-certificate");
  const certHref = cert ? hub.hrefs.document(cert.id) : null;
  const snags = data.issues.filter((i) => i.kind === "snag");
  const commissionedBy = data.commissioning?.by ?? h.commissionedBy;
  const commissionedAt = data.commissioning?.at ?? h.commissionedAt;
  const warrantyText = data.pack?.warranty.text ?? data.warranty.manufacturerSummary;

  return (
    <StageShell info={info} state={state}>
      {h.status === "pending" ? (
        <Callout tone="info" title="Commissioning next">
          The install is complete. A qualified engineer now tests and commissions your system, in heating and cooling, and signs it off.
        </Callout>
      ) : (
        <Callout tone="good" title={`Commissioned${commissionedAt ? ` on ${fmtInstantDay(commissionedAt)}` : ""}`}>
          Tested, measured and signed off{commissionedBy ? ` by ${commissionedBy}` : ""}
          {data.commissioning?.qualificationRef ? " (F-gas certified)" : ""}
          {data.commissioning?.systems ? `: ${data.commissioning.systems} system${data.commissioning.systems === 1 ? "" : "s"} checked` : ""}.
        </Callout>
      )}
      {h.packDocumentId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-100 bg-accent-50 p-5">
          <div>
            <p className="text-lg font-semibold text-ink-900">Your handover pack</p>
            <p className="text-[15px] text-ink-700">Equipment and serial numbers, certificates, warranty, care guide and who to call.</p>
          </div>
          {packHref ? (
            <Link href={packHref} className={primaryCls(false)}>
              Open your pack
            </Link>
          ) : (
            <span className="text-sm text-ink-500">In a real project, this opens your printable pack.</span>
          )}
        </div>
      ) : (
        h.status !== "pending" && <p className="text-[15px] text-ink-700">Your handover pack is being put together. It&apos;ll appear here.</p>
      )}
      {h.signoff && (
        <Callout tone={h.signoff.outcome === "all-good" ? "good" : "info"} title={`Signed off by ${h.signoff.name}, ${fmtInstantDay(h.signoff.at)}`}>
          {h.signoff.outcome === "all-good"
            ? "All good. Enjoy it."
            : `${h.signoff.snagCount} snag${h.signoff.snagCount === 1 ? "" : "s"} to put right. Each one has an owner and a date, below.`}
        </Callout>
      )}
      <div className="space-y-2">
        <Sub>Your paperwork</Sub>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          <PaperRow
            label="Commissioning certificate"
            status={h.status !== "pending" ? "done" : "pending"}
            detail={cert && certHref ? undefined : h.status !== "pending" ? "In your handover pack" : "When commissioning is signed off"}
          />
          <PaperRow
            label="Electrical installation certificate"
            status={h.electricalCert === "received" ? "done" : h.electricalCert === "not-required" ? "na" : "pending"}
            detail={
              h.electricalCert === "pending" && due
                ? `From the electrician's scheme, due by ${fmtDate(due.electricalCertDueBy)}`
                : h.electricalCert === "received"
                  ? "In your documents"
                  : undefined
            }
          />
          <PaperRow
            label="How to run and maintain it"
            status={data.pack?.maintenanceInfo.provided ? "done" : "pending"}
            detail={
              data.pack?.maintenanceInfo.provided ? "In your handover pack" : due ? `Due by ${fmtDate(due.maintenanceInfoDueBy)}` : "With your handover pack"
            }
          />
          <PaperRow
            label="Manufacturer warranty registration"
            status={h.warrantyRegistered ? "done" : "pending"}
            detail={h.warrantyRegistered ? "Registered for you" : h.warrantyDueOn ? `We register it for you by ${fmtDate(h.warrantyDueOn)}` : "We register it for you"}
          />
        </ul>
        {warrantyText && <p className="text-sm text-ink-500">{warrantyText}</p>}
        {certHref && (
          <Link href={certHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-700 underline underline-offset-2">
            Commissioning certificate ({cert!.ref})
          </Link>
        )}
      </div>
      {snags.length > 0 && (
        <div className="space-y-2">
          <Sub>Snags</Sub>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {snags.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink-900">{s.title}</span>
                  <span className="block text-sm text-ink-500">
                    {s.status === "resolved" || s.status === "closed"
                      ? s.resolvedAt
                        ? `Fixed ${fmtInstantDay(s.resolvedAt)}`
                        : "Fixed"
                      : s.dueOn
                        ? `We'll fix it by ${fmtDay(s.dueOn)}`
                        : "We'll be in touch with a date"}
                  </span>
                </span>
                <IssueChip status={s.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-ink-500">
        Something not right? <button type="button" onClick={() => goTo("aftercare")} className="font-semibold text-accent-700 underline underline-offset-2">Report a problem</button>{" "}
        and we&apos;ll call you back.
      </p>
    </StageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · Aftercare                                                       */
/* ------------------------------------------------------------------ */

function Feedback({ data }: { data: PanelProps["data"] }) {
  const p = data.project;
  const given = p.aftercare.feedback;
  const { run, busy, error, message, readOnly } = useAction();
  const [editing, setEditing] = useState(!given);
  const [score, setScore] = useState<number | null>(given?.score ?? null);
  const [comments, setComments] = useState(given?.comments ?? "");
  const legendId = useId();

  if (given && !editing) {
    return (
      <div className="space-y-2 rounded-2xl border border-line bg-white p-4 sm:p-5">
        <Sub>Your feedback</Sub>
        <p className="text-[15px] text-ink-700">
          You gave us <span className="font-semibold text-ink-900">{given.score} out of 10</span> on {fmtInstantDay(given.at)}. Thank you: we read every word.
        </p>
        {given.comments && <q className="block text-[15px] italic text-ink-700">{given.comments}</q>}
        <ActionFeedback message={message} />
        <Secondary onClick={() => setEditing(true)} disabled={readOnly}>
          Update my feedback
        </Secondary>
      </div>
    );
  }
  return (
    <form
      className="space-y-4 rounded-2xl border border-line bg-white p-4 sm:p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (score === null) return;
        if (await run({ kind: "feedback", score, comments })) setEditing(false);
      }}
    >
      <fieldset aria-describedby={`${legendId}-hint`}>
        <legend className="text-base font-semibold text-ink-900">How&apos;s it going, from 0 to 10?</legend>
        <p id={`${legendId}-hint`} className="mt-0.5 text-sm text-ink-500">
          0 is &ldquo;not happy at all&rdquo;, 10 is &ldquo;delighted&rdquo;. Honest answers help us most.
        </p>
        <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <label
              key={n}
              className={`relative flex min-h-12 cursor-pointer items-center justify-center rounded-xl border text-base font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-2 ${
                score === n ? "border-accent-700 bg-accent-700 text-white" : "border-line bg-white text-ink-900 hover:border-ink-300"
              }`}
            >
              <input
                type="radio"
                name={`score-${legendId}`}
                value={n}
                checked={score === n}
                onChange={() => setScore(n)}
                disabled={readOnly}
                className="peer absolute inset-0 cursor-pointer opacity-0"
              />
              <span aria-hidden>{n}</span>
              <span className="sr-only">{n} out of 10</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Textarea
        label="Anything you'd like to tell us?"
        hint="Optional. What went well, what we could do better."
        value={comments}
        maxLength={2000}
        rows={3}
        onChange={(e) => setComments(e.target.value)}
        disabled={readOnly}
      />
      <ReadOnlyNote />
      <ActionFeedback error={error} message={message} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Primary type="submit" disabled={score === null || readOnly} busy={busy} busyLabel="Sending…">
          Send my feedback
        </Primary>
        {given && <Secondary onClick={() => setEditing(false)}>Cancel</Secondary>}
      </div>
    </form>
  );
}

function ReportProblem({ data }: { data: PanelProps["data"] }) {
  const hub = useHub();
  const { run, busy, error, message, readOnly } = useAction();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [photos, setPhotos] = useState<{ id: string; url: string | null; name: string }[]>([]);
  const [uploading, setUploading] = useState<{ name: string; fraction: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const problems = data.issues.filter((i) => i.kind === "fault" || i.kind === "defect");

  async function addPhoto(file: File) {
    if (!hub.uploadPhoto) return;
    setUploadError(null);
    setUploading({ name: file.name, fraction: 0 });
    try {
      const item = await hub.uploadPhoto(file, (fraction) => setUploading({ name: file.name, fraction }));
      setPhotos((list) => [...list, { ...item, name: file.name }]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "That photo didn't upload. Try again, or send the report without it.");
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-4 rounded-2xl border border-line bg-white p-4 sm:p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ kind: "problem", title, detail, mediaIds: photos.map((p) => p.id) })) {
            setTitle("");
            setDetail("");
            setPhotos([]);
          }
        }}
      >
        <div>
          <Sub id={titleId}>Report a problem</Sub>
          <p className="mt-0.5 text-sm text-ink-500">It goes straight to the team, and we&apos;ll call you back. {data.company.phone ? `For anything urgent or unsafe, call ${data.company.phone}.` : "For anything urgent or unsafe, say so at the top and we'll call you first."}</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-900">What&apos;s wrong?</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            minLength={3}
            disabled={readOnly}
            placeholder="e.g. Bedroom unit is dripping"
            className="min-h-12 w-full rounded-full border border-line bg-white px-4 py-3 text-base text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </label>
        <Textarea label="Tell us a bit more" hint="Optional. When it started, which room, any error code on the display." value={detail} rows={3} maxLength={4000} onChange={(e) => setDetail(e.target.value)} disabled={readOnly} />
        {hub.uploadPhoto ? (
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-ink-900">Photos (optional)</span>
            {photos.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {photos.map((ph) => (
                  <li key={ph.id} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1 text-sm">
                    <span className="max-w-[12rem] truncate">{ph.name}</span>
                    <button
                      type="button"
                      onClick={() => setPhotos((list) => list.filter((x) => x.id !== ph.id))}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-700 hover:bg-line"
                      aria-label={`Remove ${ph.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {photos.length < 6 && (
              <label className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-dashed border-ink-300 bg-white px-5 text-sm font-semibold text-ink-900 hover:border-accent-500 ${uploading || readOnly ? "pointer-events-none opacity-50" : ""}`}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={Boolean(uploading) || readOnly}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void addPhoto(f);
                  }}
                />
                {uploading ? `Uploading ${Math.round(uploading.fraction * 100)}%…` : "Add a photo"}
              </label>
            )}
            <div aria-live="polite">{uploadError && <p className="text-sm font-medium text-red-700">{uploadError}</p>}</div>
          </div>
        ) : (
          <p className="text-sm text-ink-500">Photos can be added on a real project.</p>
        )}
        <ReadOnlyNote />
        <ActionFeedback error={error} message={message} />
        <Primary type="submit" disabled={title.trim().length < 3 || Boolean(uploading) || readOnly} busy={busy} busyLabel="Sending…">
          Send to the team
        </Primary>
      </form>
      {problems.length > 0 && (
        <div className="space-y-2">
          <Sub>Problems you&apos;ve reported</Sub>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {problems.map((i) => (
              <li key={i.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-medium text-ink-900">{i.title}</span>
                  <IssueChip status={i.status} />
                </div>
                <p className="text-sm text-ink-500">
                  Reported {fmtInstantDay(i.raisedAt)}
                  {i.resolution ? ` · ${i.resolution}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FollowUps({ data }: { data: PanelProps["data"] }) {
  const p = data.project;
  const { run, busy, error, readOnly } = useAction();
  const off = Boolean(p.aftercare.followUpsOptedOutAt);
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <Sub>Follow-up emails</Sub>
      <p className="text-[15px] leading-relaxed text-ink-700">
        {off
          ? "You've turned them off. We'll still contact you about any open work, problems or payments."
          : "We check in after a week, ask how it's going after a month, check again when the season turns, and remind you when a service is due."}
      </p>
      <ActionFeedback error={error} />
      <Secondary onClick={() => void run({ kind: "follow-ups", optedOut: !off })} disabled={busy || readOnly}>
        {busy ? "Saving…" : off ? "Turn follow-ups back on" : "Stop follow-up emails"}
      </Secondary>
    </div>
  );
}

export function AftercarePanel({ data, state }: PanelProps) {
  const p = data.project;
  const info = data.stages.aftercare;
  const installed = p.install.status === "complete";
  const handed = p.handover.status === "handed-over";
  const cancelled = p.closure.reason === "cancelled";
  if (!installed || cancelled) {
    return (
      <StageShell info={info} state={state}>
        <Explainer info={info} />
        {!cancelled && <Locked>Aftercare starts once your system is handed over.</Locked>}
      </StageShell>
    );
  }
  return (
    <StageShell info={info} state={state}>
      {handed && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-sm text-ink-500">First service due</p>
            <p className="mt-0.5 font-semibold text-ink-900">{p.aftercare.serviceDueOn ? `Around ${fmtDate(p.aftercare.serviceDueOn)}` : "We'll let you know"}</p>
            <p className="mt-1 text-sm text-ink-500">We&apos;ll remind you a few weeks before.</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-sm text-ink-500">Manufacturer warranty</p>
            <p className="mt-0.5 font-semibold text-ink-900">
              {p.handover.warrantyRegistered ? "Registered" : p.handover.warrantyDueOn ? `We register it by ${fmtDate(p.handover.warrantyDueOn)}` : "We register it for you"}
            </p>
            {data.warranty.manufacturerSummary && <p className="mt-1 text-sm text-ink-500">{data.warranty.manufacturerSummary}</p>}
          </div>
        </div>
      )}
      {handed && <Feedback data={data} />}
      {/* The same invitation for everyone, once we've asked by email: never based on the feedback score. */}
      {handed && p.aftercare.reviewRequestedAt && data.company.reviewUrl && (
        <div className="space-y-2 rounded-2xl border border-line bg-white p-4 sm:p-5">
          <Sub>Would you leave us a review?</Sub>
          <p className="text-[15px] leading-relaxed text-ink-700">
            We ask everyone, good or bad, and we don&apos;t offer anything for it. It helps other families decide.
          </p>
          <a href={data.company.reviewUrl} target="_blank" rel="noreferrer" className={primaryCls()}>
            Write a review
          </a>
        </div>
      )}
      <ReportProblem data={data} />
      {handed && <FollowUps data={data} />}
    </StageShell>
  );
}
