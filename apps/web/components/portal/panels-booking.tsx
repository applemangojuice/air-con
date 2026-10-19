"use client";

import Link from "next/link";
import { useState } from "react";
import { daysBetween, rescheduleFeeGbp } from "@aircon/domain";
import { fmtDay, gbp, money } from "@/lib/format";
import {
  ActionFeedback,
  Callout,
  Explainer,
  Locked,
  PersonCardView,
  Primary,
  ReadOnlyNote,
  Secondary,
  StageShell,
  Sub,
  primaryCls,
  secondaryCls,
  useAction,
  useEchoesNextStep,
  ReachUs,
} from "./bits";
import { useHub } from "./controller";
import type { PanelProps } from "./panel-types";
import { BlockPicker } from "./pickers";
import { blockLabel } from "./schedule";
import { kitHeadline, kitSteps } from "./view";

/* ------------------------------------------------------------------ */
/* 4 · Booking                                                         */
/* ------------------------------------------------------------------ */

function earliestCopy(data: PanelProps["data"]): string {
  const { reason } = data.earliestStart;
  const first = fmtDay(data.installBlocks[0]?.startDate ?? data.earliestStart.date);
  const days = data.scheduling.cancellationDays;
  switch (reason) {
    case "awaiting-delivery":
      return `Because we're supplying your equipment, your cancellation period runs until ${days} days after it's delivered, and we start after that. So the first dates we can offer are from ${first}.`;
    case "cancellation-ends":
      return `Your cancellation period ends ${data.cancellation.endsOn ? fmtDay(data.cancellation.endsOn) : "soon"} and we start after that, so the first dates we can offer are from ${first}.`;
    case "early-start":
      return `You've asked us to start early. We need about a week to line up your team and kit, so dates from ${first}.`;
    case "lead-time":
      return `We need about a week to line up your team and kit, so dates from ${first}.`;
  }
}

function ChooseDates({ data, onDone }: { data: PanelProps["data"]; onDone?: () => void }) {
  const p = data.project;
  const { run, busy, error, message, readOnly } = useAction();
  const [start, setStart] = useState<string | null>(null);
  const echoDates = useEchoesNextStep("Choose your install dates");
  const block = data.installBlocks.find((b) => b.startDate === start) ?? null;
  const booked = p.booking.status === "booked" && p.booking.startDate;
  const fee = booked ? rescheduleFeeGbp("installation", daysBetween(data.today, p.booking.startDate!)) : 0;

  if (data.installBlocks.length === 0) {
    return (
      <Callout tone="warn" title="No install dates free online right now">
        <ReachUs company={data.company} capital /> and we&apos;ll find dates that work for you.
      </Callout>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (block && (await run({ kind: "install-dates", dates: block.dates }))) {
          setStart(null);
          onDone?.();
        }
      }}
    >
      <p className="text-[15px] leading-relaxed text-ink-700">{earliestCopy(data)}</p>
      <BlockPicker blocks={data.installBlocks} value={start} onChange={setStart} disabled={readOnly || busy} current={p.booking.startDate} />
      {booked && fee > 0 && (
        <Callout tone="warn" title={`A ${gbp(fee)} short-notice fee applies`}>
          Your install is less than a week away, so the crew and kit are already planned. Moving it adds {gbp(fee)} to your final balance.
        </Callout>
      )}
      <ReadOnlyNote />
      <ActionFeedback error={error} message={message} />
      <Primary type="submit" disabled={!block || readOnly} busy={busy} busyLabel="Saving your dates…" quiet={echoDates && !block}>
        {block ? `${booked ? "Move to" : "Book"} ${block.label}${fee > 0 ? ` (${gbp(fee)})` : ""}` : "Pick your dates"}
      </Primary>
    </form>
  );
}

function EarlyStart({ data }: { data: PanelProps["data"] }) {
  const p = data.project;
  const { run, busy, error, message, readOnly } = useAction();
  const echoReply = useEchoesNextStep("Reply to confirm your early start");
  const es = p.proposal.earlyStart;
  const requested = es?.requested ?? p.proposal.earlyStartRequested ?? false;
  const cs = data.cancellation;
  if (p.install.status !== "not-started") return null;

  if (requested && es?.evidencedAt) {
    return (
      <Callout tone="good" title="Starting early: confirmed">
        We&apos;ve got your request in writing and saved it with your contract, so we can start before your cancellation period ends.
      </Callout>
    );
  }
  if (cs.ended) return null;

  const mailto = `mailto:${data.company.email}?subject=${encodeURIComponent("Early start request")}&body=${encodeURIComponent(data.earlyStartWording)}`;
  if (requested) {
    return (
      <div id="early-start" className="space-y-3 rounded-2xl border border-accent-100 bg-accent-50 p-4 sm:p-5">
        <p className="font-semibold text-ink-900">Reply to confirm your early start</p>
        <p className="text-[15px] leading-relaxed text-ink-700">
          You asked us to start before your cancellation period ends. The law needs that request from you in writing, so please reply to our confirmation email, or email{" "}
          <span className="font-semibold">{data.company.email}</span>, with these words:
        </p>
        <blockquote className="rounded-xl border-l-4 border-accent-500 bg-white px-4 py-3 text-[15px] italic leading-relaxed text-ink-900">
          {data.earlyStartWording}
        </blockquote>
        <a href={mailto} className={echoReply ? secondaryCls() : primaryCls()}>
          Email us these words
        </a>
        <p className="text-sm text-ink-500">Until it arrives, we can&apos;t start before your cancellation period ends.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <p className="font-semibold text-ink-900">Want us to start sooner?</p>
      <p className="text-[15px] leading-relaxed text-ink-700">
        We normally start once your cancellation period has ended. You can ask us to start before then. If you do, and then cancel after we&apos;ve
        started, you pay for the work done up to that point.
      </p>
      <ReadOnlyNote />
      <ActionFeedback error={error} message={message} />
      <Secondary onClick={() => void run({ kind: "early-start" })} disabled={busy || readOnly}>
        {busy ? "Saving…" : "Ask to start early"}
      </Secondary>
    </div>
  );
}

function Prep({ data }: { data: PanelProps["data"] }) {
  const p = data.project;
  const { run, busy, error, readOnly } = useAction();
  const [pending, setPending] = useState<string | null>(null);
  const items = p.booking.prep;
  const left = items.filter((i) => i.confirmable && !i.done).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Sub id="prep-title">Getting your home ready</Sub>
        <span className="text-sm text-ink-500">{left === 0 ? "All done, thank you" : `${left} to go`}</span>
      </div>
      <ul aria-labelledby="prep-title" className="divide-y divide-line rounded-2xl border border-line bg-white">
        {items.map((item) => (
          <li key={item.id} className="px-4">
            {item.confirmable ? (
              <label className="flex min-h-14 cursor-pointer items-start gap-3 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-accent-600"
                  checked={item.done}
                  disabled={readOnly || (busy && pending === item.id)}
                  onChange={async (e) => {
                    setPending(item.id);
                    await run({ kind: "prep", itemId: item.id, done: e.target.checked });
                    setPending(null);
                  }}
                />
                <span>
                  <span className={`block font-semibold ${item.done ? "text-ink-500 line-through decoration-ink-300" : "text-ink-900"}`}>{item.label}</span>
                  <span className="block text-sm text-ink-500">{item.detail}</span>
                </span>
              </label>
            ) : (
              <div className="flex items-start gap-3 py-3">
                <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
                  !
                </span>
                <span>
                  <span className="block font-semibold text-ink-900">{item.label}</span>
                  <span className="block text-sm text-ink-500">{item.detail}</span>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ActionFeedback error={error} />
    </div>
  );
}

function Deposit({ data, slots }: { data: PanelProps["data"]; slots: PanelProps["slots"] }) {
  const p = data.project;
  const hub = useHub();
  const echoPay = useEchoesNextStep("Pay your deposit");
  if (p.booking.depositStatus === "not-required") return null;
  if (p.booking.depositStatus === "paid") {
    return <Callout tone="good" title="Deposit received">Thank you. It comes off your final balance.</Callout>;
  }
  const due = data.money.outstandingPence;
  return (
    <div className="space-y-3 rounded-2xl border border-accent-100 bg-accent-50 p-4 sm:p-5">
      <p className="font-semibold text-ink-900">Your deposit{due > 0 ? `: ${money(due)}` : ""}</p>
      <p className="text-[15px] text-ink-700">We confirm your dates once it&apos;s paid. Card or bank transfer.</p>
      {hub.hrefs.pay && due > 0 ? (
        <Link href={hub.hrefs.pay} className={echoPay ? secondaryCls() : primaryCls()}>
          Pay your deposit
        </Link>
      ) : hub.hrefs.pay ? (
        <p className="text-sm text-ink-500">Your invoice is on its way. It&apos;ll appear here to pay.</p>
      ) : (
        slots?.pay
      )}
    </div>
  );
}

export function BookingPanel({ data, state, slots }: PanelProps) {
  const p = data.project;
  const info = data.stages.booking;
  const [changing, setChanging] = useState(false);

  if (p.proposal.status !== "accepted") {
    return (
      <StageShell info={info} state={state}>
        <Explainer info={info} />
        <Locked>Accept your proposal and you can pick your install dates right here.</Locked>
      </StageShell>
    );
  }

  const chosen = p.booking.dates.length > 0;
  const confirmed = p.booking.status === "booked";
  const started = p.install.status !== "not-started";
  return (
    <StageShell info={info} state={state}>
      {!chosen && <ChooseDates data={data} />}
      {chosen && (
        <div className="space-y-3">
          <div className={`rounded-2xl border p-5 ${confirmed ? "border-emerald-200 bg-emerald-50" : "border-line bg-white"}`}>
            <p className={`text-sm font-semibold ${confirmed ? "text-emerald-800" : "text-ink-500"}`}>{confirmed ? "Confirmed" : "Your chosen dates"}</p>
            <p className="mt-1 font-display text-2xl text-ink-900">{blockLabel(p.booking.dates)}</p>
            <p className="mt-1 text-[15px] text-ink-700">
              {confirmed
                ? data.onTheWay === "sms"
                  ? "Your team and dates are locked in. We'll text you the evening before, and again when we're on the way."
                  : data.onTheWay === "email"
                    ? "Your team and dates are locked in. We'll email you the evening before, and again when we're on the way."
                    : "Your team and dates are locked in. We'll be in touch the evening before."
                : "We'll confirm once your team and kit are lined up. You'll get an email when we do."}
            </p>
          </div>
          {!started && !changing && (
            <Secondary onClick={() => setChanging(true)}>Change my dates</Secondary>
          )}
          {!started && changing && (
            <div className="space-y-3 rounded-2xl border border-line bg-cream/60 p-4 sm:p-5">
              <ChooseDates data={data} onDone={() => setChanging(false)} />
              <Secondary onClick={() => setChanging(false)}>Keep my dates</Secondary>
            </div>
          )}
        </div>
      )}
      <Deposit data={data} slots={slots} />
      <EarlyStart data={data} />
      <div className="space-y-3">
        <Sub>Your install team</Sub>
        {data.crew.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.crew.map((person) => (
              <PersonCardView key={`${person.name}-${person.role}`} person={person} />
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-ink-700">We&apos;ll introduce your team here, with the qualifications they hold, once they&apos;re assigned.</p>
        )}
      </div>
      <Prep data={data} />
    </StageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Kit                                                             */
/* ------------------------------------------------------------------ */

export function KitPanel({ data, state }: PanelProps) {
  const p = data.project;
  const info = data.stages.kit;
  const steps = kitSteps(p);
  const showTracker = p.booking.status === "booked" || p.kit.status !== "not-ordered";
  return (
    <StageShell info={info} state={state}>
      {showTracker ? (
        <>
          <p className="text-[15px] font-medium text-ink-900">{kitHeadline(p)}</p>
          <ol className="relative space-y-4 pl-1">
            {steps.map((s, i) => (
              <li key={s.label} className="relative flex items-center gap-3">
                {i < steps.length - 1 && (
                  <span aria-hidden className={`absolute left-[11px] top-7 h-4 w-0.5 ${s.done ? "bg-emerald-600" : "bg-line"}`} />
                )}
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    s.done ? "bg-emerald-600 text-white" : s.current ? "border-2 border-accent-600 bg-white" : "border-2 border-line bg-white"
                  }`}
                >
                  {s.done && (
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className={`text-[15px] ${s.done ? "font-semibold text-ink-900" : "text-ink-500"}`}>
                  {s.label}
                  <span className="sr-only">{s.done ? ", done" : ", not yet"}</span>
                </span>
              </li>
            ))}
          </ol>
          {p.proposal.goodsReceivedOn && data.cancellation.endsOn && !data.cancellation.ended && (
            <Callout tone="info" title="Your cancellation period">
              {data.cancellation.sentence}
            </Callout>
          )}
          <p className="text-sm text-ink-500">We only tell you what someone has actually confirmed or seen: never a guess from a delivery estimate.</p>
        </>
      ) : (
        <>
          <Explainer info={info} />
          <Locked>We order your kit once your booking is confirmed.</Locked>
        </>
      )}
    </StageShell>
  );
}
