"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DOCUMENTS_CONSENT_HINT, DOCUMENTS_CONSENT_LABEL, documentsConsentCovers, type Project } from "@aircon/domain";
import { Checkbox } from "@/components/kit/form";
import { fmtDay, fmtDayTime, gbp, money } from "@/lib/format";
import {
  ActionFeedback,
  Callout,
  Checklist,
  Explainer,
  InfoList,
  InfoRow,
  Locked,
  PersonCardView,
  Primary,
  ReadOnlyNote,
  Secondary,
  StageShell,
  Sub,
  TextButton,
  primaryCls,
  secondaryCls,
  useAction,
  useEchoesNextStep,
  ReachUs,
} from "./bits";
import { useHub } from "./controller";
import type { PanelProps } from "./panel-types";
import { SlotPicker } from "./pickers";
import { arrivalTime, onMyWayFresh, proposalLate, proposalLateLine, proposalReadyBy } from "./view";

/* ------------------------------------------------------------------ */
/* Shared copy                                                         */
/* ------------------------------------------------------------------ */

const FLOOR_LABEL: Record<string, string> = {
  ground: "Ground floor",
  first: "First floor",
  "second-plus": "Second floor and up",
  loft: "Loft",
  basement: "Basement",
};

export const SURVEY_CHECKS = [
  "Each room: we measure up, check the windows and agree where the indoor unit could go.",
  "Outside: where the outdoor unit could sit, and how far it is from your neighbours' windows.",
  "The route for the pipes between them, and where the condensation drains away.",
  "Your fuse board, and the route for the new cable.",
  "The planning checks for the outdoor unit: size, position and noise.",
];

export const SURVEY_PREP = [
  "Clear access to your fuse board.",
  "Access to your loft, if you have one.",
  "Have a think about where you'd like the units to go.",
  "Someone 18 or over at home for the whole visit.",
];

// Word for word what the record keeps (DOCUMENTS_CONSENT_WORDING.portal).
const CONSENT_LABEL = DOCUMENTS_CONSENT_LABEL;
const CONSENT_HINT = DOCUMENTS_CONSENT_HINT;

const surveyFeeLine = (p: Project) => (p.survey.feeGbp > 0 ? `${gbp(p.survey.feeGbp)} survey fee` : "Free, with no obligation");

/* ------------------------------------------------------------------ */
/* 1 · Price                                                           */
/* ------------------------------------------------------------------ */

function RoughPlan({ project }: { project: Project }) {
  const byFloor = useMemo(() => {
    const groups = new Map<string, { name: string; unitLabel: string }[]>();
    for (const room of project.quoteSummary.roomDesigns) {
      groups.set(room.floor, [...(groups.get(room.floor) ?? []), room]);
    }
    return [...groups.entries()];
  }, [project.quoteSummary.roomDesigns]);
  if (byFloor.length === 0) return null;
  return (
    <div className="space-y-3">
      <Sub>Your rough plan</Sub>
      <p className="text-sm text-ink-500">
        From what you told us{project.roughPlan.archetypeName ? ` about your ${project.roughPlan.archetypeName.toLowerCase()}` : ""}. Your
        surveyor checks every position with you.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {byFloor.map(([floor, rooms]) => (
          <div key={floor} className="rounded-2xl border border-line bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{FLOOR_LABEL[floor] ?? floor}</p>
            <ul className="mt-2 space-y-2">
              {rooms.map((room, i) => (
                <li key={`${room.name}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[15px]">
                  <span className="whitespace-nowrap font-medium text-ink-900">{room.name}</span>
                  <span className="shrink-0 rounded-full bg-sage-50 px-2.5 py-0.5 text-xs font-semibold text-sage-700">{room.unitLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {project.roughPlan.pattern && (
        // The pattern's own name ("Rear patio multi-split") is our shorthand; the customer gets the plain description.
        <div className="rounded-2xl bg-surface/70 p-4 text-[15px] leading-relaxed">
          <p className="font-semibold text-ink-900">How we&apos;d likely fit it</p>
          <p className="mt-1 text-ink-700">{project.roughPlan.pattern.summary}</p>
          <p className="mt-2 text-ink-700">
            <span className="font-semibold">The pipes:</span> {project.roughPlan.pattern.pipeRoute}
          </p>
        </div>
      )}
    </div>
  );
}

function BookSurvey({ data }: { data: PanelProps["data"] }) {
  const p = data.project;
  const { run, busy, error, message, readOnly } = useAction();
  const [slot, setSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<"in-person" | "video">("in-person");
  const [consent, setConsent] = useState(false);
  const consented = documentsConsentCovers(p);
  const echo = useEchoesNextStep("Book your home survey");

  if (data.surveySlots.length === 0) {
    return (
      <Callout tone="warn" title="No survey times free online right now">
        <ReachUs company={data.company} capital /> and we&apos;ll find a time that works.
      </Callout>
    );
  }

  return (
    <form
      id="book-survey"
      className="scroll-mt-24 space-y-5 rounded-2xl border border-line bg-cream/60 p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (slot) void run({ kind: "book-survey", scheduledFor: slot, mode, documentsConsent: consent });
      }}
    >
      <div>
        <Sub>Book your home survey</Sub>
        <p className="mt-1 text-sm text-ink-500">
          About {data.scheduling.surveyDurationMinutes} minutes. {surveyFeeLine(p)}.
        </p>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink-900">How would you like it?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["in-person", "At your home", "We measure up and check everything in person. Recommended."],
              ["video", "Video call", "A guided walk-round on your phone. We may still need to visit to measure up."],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition ${mode === value ? "border-accent-600 bg-accent-50" : "border-line bg-white hover:border-ink-300"}`}
            >
              <input
                type="radio"
                name="survey-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                disabled={readOnly}
                className="mt-1 h-4 w-4 shrink-0 accent-accent-600"
              />
              <span>
                <span className="block font-semibold text-ink-900">{label}</span>
                <span className="block text-sm text-ink-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <SlotPicker days={data.surveySlots} value={slot} onChange={setSlot} disabled={readOnly || busy} />
      {!consented && (
        <Checkbox
          label={CONSENT_LABEL}
          hint={CONSENT_HINT}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={readOnly || busy}
        />
      )}
      <ReadOnlyNote />
      <ActionFeedback error={error} message={message} />
      <Primary type="submit" disabled={!slot || readOnly} busy={busy} busyLabel="Booking your survey…" quiet={echo && !slot}>
        {slot ? `Book my survey: ${fmtDayTime(slot)}` : "Pick a time to book"}
      </Primary>
    </form>
  );
}

export function PricePanel({ data, state, goTo }: PanelProps) {
  const p = data.project;
  const q = p.quoteSummary;
  return (
    <StageShell info={data.stages.price} state={state}>
      <div className="rounded-2xl bg-ink-900 p-5 text-white sm:p-6">
        <p className="text-sm font-medium text-white/70">Your instant price</p>
        <p className="mt-1 font-display text-4xl tabular-nums">{gbp(q.totalGbp)}</p>
        <p className="mt-2 text-sm leading-relaxed text-white/80">
          Heating and cooling, supplied and fitted. Confirmed at your survey: if anything changes, your proposal says exactly what and why.
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/15 pt-4 text-sm">
          <div>
            <dt className="text-white/60">Rooms</dt>
            <dd className="mt-0.5 font-semibold">{q.roomCount}</dd>
          </div>
          <div>
            <dt className="text-white/60">Outdoor units</dt>
            <dd className="mt-0.5 font-semibold">{q.systems.length || 1}</dd>
          </div>
          <div>
            <dt className="text-white/60">Install</dt>
            <dd className="mt-0.5 font-semibold">
              {p.booking.installDays} day{p.booking.installDays === 1 ? "" : "s"}
            </dd>
          </div>
        </dl>
      </div>
      <RoughPlan project={p} />
      {p.survey.status === "not-booked" ? (
        <BookSurvey data={data} />
      ) : (
        <Callout tone="good" title={`Survey booked: ${p.survey.scheduledFor ? fmtDayTime(p.survey.scheduledFor) : "date to follow"}`}>
          <TextButton onClick={() => goTo("survey")}>See your survey details</TextButton>
        </Callout>
      )}
    </StageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Survey                                                          */
/* ------------------------------------------------------------------ */

function MoveSurvey({ data }: { data: PanelProps["data"] }) {
  const p = data.project;
  const { run, busy, error, message, readOnly } = useAction();
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<string | null>(null);
  if (!p.survey.scheduledFor) return null;
  // The survey is free and no-obligation, so moving it is free too (rescheduleFeeGbp).
  const days = data.surveySlots.map((d) => ({ ...d, slots: d.slots.filter((s) => s.iso !== p.survey.scheduledFor) })).filter((d) => d.slots.length);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Secondary onClick={() => setOpen(true)} disabled={readOnly}>
          Move my survey
        </Secondary>
        <span className="text-sm text-ink-500">Free to move</span>
      </div>
    );
  }
  return (
    <form
      className="space-y-5 rounded-2xl border border-line bg-cream/60 p-4 sm:p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (slot && (await run({ kind: "reschedule-survey", scheduledFor: slot }))) {
          setOpen(false);
          setSlot(null);
        }
      }}
    >
      <Sub>Move your survey</Sub>
      <p className="text-sm text-ink-500">Moving it is free. Pick a new time and we&apos;ll let your surveyor know.</p>
      {days.length ? (
        <SlotPicker days={days} value={slot} onChange={setSlot} disabled={busy} legend="Pick a new day" />
      ) : (
        <p className="text-sm text-ink-700">No other times are free online. <ReachUs company={data.company} capital /> and we&apos;ll sort it.</p>
      )}
      <ActionFeedback error={error} message={message} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Primary type="submit" disabled={!slot} busy={busy} busyLabel="Moving your survey…">
          {slot ? `Move to ${fmtDayTime(slot)}` : "Pick a new time"}
        </Primary>
        <Secondary onClick={() => setOpen(false)}>Keep my current time</Secondary>
      </div>
    </form>
  );
}

export function SurveyPanel({ data, state, goTo }: PanelProps) {
  const p = data.project;
  const s = p.survey;
  const info = data.stages.survey;
  const report = data.documents.find((d) => d.kind === "survey-report");
  const hub = useHub();
  const echoBook = useEchoesNextStep("Book your home survey");

  if (s.status === "not-booked") {
    return (
      <StageShell info={info} state={state}>
        <Explainer info={info} />
        <div className="space-y-3">
          <Locked>Pick a time for your survey first. It takes about {data.scheduling.surveyDurationMinutes} minutes.</Locked>
          <Primary onClick={() => goTo("price")} quiet={echoBook}>
            Book my home survey
          </Primary>
        </div>
      </StageShell>
    );
  }

  if (s.status === "submitted") {
    const readyBy = proposalReadyBy(p);
    const late = proposalLate(p, data.today);
    const reportHref = report ? hub.hrefs.document(report.id) : null;
    return (
      <StageShell info={info} state={state}>
        <Callout tone="good" title={readyBy && !late ? `Survey done. Your proposal will be ready by ${fmtDay(readyBy)}.` : "Survey done."}>
          Thanks for having us. Next, we design your system from what we measured, and a qualified engineer signs it off before you see a price.
          {late ? ` ${proposalLateLine(p)}` : ""}
        </Callout>
        {report && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
            <div>
              <p className="font-semibold text-ink-900">Your survey report</p>
              <p className="text-sm text-ink-500">What we found, and anything we promised you.</p>
            </div>
            {reportHref ? (
              <Link href={reportHref} className={primaryCls(false)}>
                Read your report
              </Link>
            ) : (
              <span className="text-sm text-ink-500">In a real project, this opens your report.</span>
            )}
          </div>
        )}
        {s.surveyor && data.surveyor && <PersonCardView person={data.surveyor} />}
      </StageShell>
    );
  }

  const fresh = onMyWayFresh(s.onMyWay, data.nowIso) && s.status === "booked" && s.onMyWay;
  return (
    <StageShell info={info} state={state}>
      {fresh && (
        <Callout tone="you" title={`${data.surveyor?.name ?? "Your surveyor"} is on the way: about ${fresh.etaMinutes} minutes`}>
          Expected around {arrivalTime(fresh)}. We&apos;ll be with you shortly.
        </Callout>
      )}
      {s.status === "in-progress" && <Callout tone="info" title="Your survey is under way">Your surveyor is with you now.</Callout>}
      <InfoList>
        <InfoRow label="When">{s.scheduledFor ? fmtDayTime(s.scheduledFor) : "To be confirmed"}</InfoRow>
        <InfoRow label="How long">About {s.durationMinutes} minutes</InfoRow>
        <InfoRow label="Type">{s.mode === "video" ? "Video call" : "At your home"}</InfoRow>
        <InfoRow label="Cost">{s.feeGbp > 0 ? `${gbp(s.feeGbp)}${s.paymentStatus === "paid" ? " (paid)" : ""}` : "Free"}</InfoRow>
      </InfoList>
      <div className="space-y-3">
        <Sub>Who&apos;s coming</Sub>
        {data.surveyor ? (
          <PersonCardView person={data.surveyor} />
        ) : (
          <p className="text-[15px] text-ink-700">We&apos;ll introduce your surveyor here, with their photo, before the day.</p>
        )}
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <Sub>What we&apos;ll check</Sub>
          <Checklist items={SURVEY_CHECKS} />
        </div>
        <div className="space-y-3">
          <Sub>Before we arrive</Sub>
          <Checklist items={SURVEY_PREP} />
        </div>
      </div>
      {s.status === "booked" && <MoveSurvey data={data} />}
    </StageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Proposal                                                        */
/* ------------------------------------------------------------------ */

function ConsentBox() {
  const { run, busy, error, message, readOnly } = useAction();
  const [ticked, setTicked] = useState(false);
  const echo = useEchoesNextStep("Agree to get your documents by email");
  return (
    <form
      className="space-y-3 rounded-2xl border border-accent-100 bg-accent-50 p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ticked) void run({ kind: "documents-consent" });
      }}
    >
      <p className="font-semibold text-ink-900">Can we email you your documents?</p>
      <Checkbox label={CONSENT_LABEL} hint={CONSENT_HINT} checked={ticked} onChange={(e) => setTicked(e.target.checked)} disabled={readOnly || busy} />
      <ReadOnlyNote />
      <ActionFeedback error={error} message={message} />
      <Primary type="submit" disabled={!ticked || readOnly} busy={busy} busyLabel="Saving…" quiet={echo && !ticked}>
        Save my choice
      </Primary>
    </form>
  );
}

function ProgressList({ items }: { items: { label: string; done: boolean; detail?: string }[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="flex gap-3">
          <span
            aria-hidden
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-emerald-600 text-white" : "border-2 border-line bg-white"}`}
          >
            {item.done && (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="text-[15px]">
            <span className={`font-semibold ${item.done ? "text-ink-900" : "text-ink-700"}`}>
              {item.label}
              <span className="sr-only">{item.done ? ", done" : ", not yet"}</span>
            </span>
            {item.detail && <span className="block text-sm text-ink-500">{item.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EarlyStartSummary({ data, goTo }: { data: PanelProps["data"]; goTo: PanelProps["goTo"] }) {
  const p = data.project;
  const es = p.proposal.earlyStart;
  const requested = es?.requested ?? p.proposal.earlyStartRequested ?? false;
  if (!requested) return null;
  if (es?.evidencedAt) {
    return <Callout tone="good" title="Early start: confirmed">We&apos;ve got your request to start early in writing, saved with your contract.</Callout>;
  }
  return (
    <Callout tone="you" title="Early start: waiting for your email">
      You asked us to start before your cancellation period ends. To make it official, reply to our confirmation email with the words we sent.{" "}
      <TextButton onClick={() => goTo("booking")}>See what to send</TextButton>
    </Callout>
  );
}

export function ProposalPanel({ data, state, goTo, slots }: PanelProps) {
  const p = data.project;
  const info = data.stages.proposal;
  const hub = useHub();
  const contract = data.documents.find((d) => d.kind === "contract");
  const proposalDoc = data.documents.find((d) => d.kind === "proposal");
  const consented = documentsConsentCovers(p);
  const echoReview = useEchoesNextStep("Review your proposal");

  if (p.proposal.status === "accepted") {
    const contractHref = contract ? hub.hrefs.document(contract.id) : null;
    return (
      <StageShell info={info} state={state}>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-800">Accepted{p.proposal.acceptedAt ? ` on ${fmtDay(p.proposal.acceptedAt)}` : ""}</p>
          <p className="mt-1 text-lg font-semibold text-ink-900">{p.proposal.acceptedOptionLabel ?? "Your system"}</p>
          {p.proposal.contractTotalPence !== undefined && (
            <p className="mt-1 font-display text-3xl tabular-nums text-ink-900">{money(p.proposal.contractTotalPence)}</p>
          )}
        </div>
        <div className="space-y-2">
          <Sub>Your right to cancel</Sub>
          <p className="text-[15px] leading-relaxed text-ink-700">{data.cancellation.sentence}</p>
          <p className="text-sm text-ink-500">The cancellation form is in your contract confirmation, along with how to use it.</p>
        </div>
        <EarlyStartSummary data={data} goTo={goTo} />
        <div className="flex flex-col gap-2 sm:flex-row">
          {contract && contractHref && (
            <Link href={contractHref} className={primaryCls()}>
              Your contract confirmation
            </Link>
          )}
          <Secondary onClick={() => goTo("booking")}>{p.booking.dates.length ? "See your install dates" : "Choose your install dates"}</Secondary>
        </div>
      </StageShell>
    );
  }

  if (p.survey.status !== "submitted") {
    return (
      <StageShell info={info} state={state}>
        <Explainer info={info} />
        {!consented && p.survey.status !== "not-booked" && <ConsentBox />}
        <Locked>Your proposal follows your survey. We design it from what we measure.</Locked>
      </StageShell>
    );
  }

  const readyBy = proposalReadyBy(p);
  const issued = p.proposal.status === "issued";
  const proposalHref = hub.hrefs.proposal;
  return (
    <StageShell info={info} state={state}>
      {!consented && <ConsentBox />}
      {issued && (
        <div className="rounded-2xl border border-accent-100 bg-accent-50 p-5">
          <p className="text-lg font-semibold text-ink-900">Your proposal is ready</p>
          <p className="mt-1 text-[15px] text-ink-700">
            Your design, drawn on photos of your own rooms, and the price in writing.
            {p.proposal.validUntil ? ` Take your time: it's valid until ${fmtDay(p.proposal.validUntil)}.` : ""}
          </p>
          <div className="mt-4">
            {proposalHref ? (
              <Link href={proposalHref} className={echoReview ? secondaryCls() : primaryCls()}>
                Review your proposal
              </Link>
            ) : (
              slots?.proposal
            )}
          </div>
        </div>
      )}
      {p.proposal.status === "changes-requested" && (
        <Callout tone="info" title="You asked for some changes">
          {p.proposal.changeRequest && <q className="block italic">{p.proposal.changeRequest}</q>}
          We&apos;ll send you a revised proposal as soon as it&apos;s ready.
        </Callout>
      )}
      {(p.proposal.status === "declined" || p.proposal.status === "expired") && (
        <Callout tone="warn" title={p.proposal.status === "declined" ? "You declined this proposal" : "This proposal has expired"}>
          Changed your mind, or want an updated one? {data.company.phone ? `Call us on ${data.company.phone} or email ${data.company.email}.` : `Email us at ${data.company.email}.`}
        </Callout>
      )}
      {(p.proposal.status === "not-issued" || p.proposal.status === "changes-requested") && (
        <ProgressList
          items={[
            { label: "Survey done", done: true },
            {
              label: p.design.status === "approved" ? "Design signed off by our engineer" : "Designing your system",
              done: p.design.status === "approved",
              detail: p.design.status === "approved" ? undefined : "The right unit for each room, where it goes and how the pipes run.",
            },
            {
              label: "Your proposal",
              done: false,
              detail:
                readyBy && p.proposal.status === "not-issued"
                  ? proposalLate(p, data.today)
                    ? proposalLateLine(p)
                    : `Due by ${fmtDay(readyBy)}`
                  : undefined,
            },
          ]}
        />
      )}
      {proposalDoc && hub.hrefs.document(proposalDoc.id) && !issued && (
        <Link href={hub.hrefs.document(proposalDoc.id)!} className="text-sm font-semibold text-accent-700 underline underline-offset-2">
          Your earlier proposal ({proposalDoc.ref})
        </Link>
      )}
      {!issued && <Explainer info={info} title="How your proposal works" />}
    </StageShell>
  );
}
