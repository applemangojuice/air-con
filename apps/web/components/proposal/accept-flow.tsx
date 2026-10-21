"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isFullName, type ProposalOption } from "@aircon/domain";
import { Button, Checkbox, Fieldset, Input } from "@/components/kit";
import { money } from "@/lib/format";
import { contractTypeLabel, earlyStartExplainer } from "./copy";
import { CancellationDetails } from "./sections";
import { TermsText } from "./terms-text";
import type { ProposalPageData } from "./types";
import type { AcceptedSummary } from "@/lib/proposal-server";

/**
 * The legal acceptance, as a check-answers flow (GOV.UK pattern):
 *   1 choose the option → 2 check your answers (each with Change) →
 *   3 starting early (unticked; the loss-of-right line only for
 *   install-only) → 4 type your name and "I accept and agree to pay £X",
 *   with the main characteristics, total, extra charges, duration and
 *   obligations immediately above the button (CCR reg 14).
 *
 * Patchy signal: the request is safe to repeat (the server answers a
 * repeat with the acceptance on file), and a failure says so plainly and
 * leaves everything as it was.
 */

type Step = 1 | 2 | 3 | 4;

const READ_ID = "accept-read-cancellation";
const NAME_ID = "accept-full-name";

const STEP_TITLE: Record<Step, string> = {
  1: "Choose your option",
  2: "Check your answers",
  3: "Starting within your cancellation period",
  4: "Confirm and accept",
};

export function AcceptFlow({
  data,
  optionId,
  onOptionChange,
  onAccepted,
}: {
  data: ProposalPageData;
  optionId: string;
  onOptionChange: (id: string) => void;
  onAccepted: (summary: AcceptedSummary) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [earlyStart, setEarlyStart] = useState(false);
  const [lossAck, setLossAck] = useState(false);
  const [readCancellation, setReadCancellation] = useState(false);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reload?: boolean; list?: string[] } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const option = data.options.find((o) => o.id === optionId) ?? data.options[0]!;
  const installOnly = data.contractType === "install-only";
  const readOnly = data.viewer !== "customer";
  const total = option.pricing.totalPence;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const nameOk = isFullName(name);
  const lossOk = !installOnly || !earlyStart || lossAck;
  const canSubmit = !readOnly && nameOk && readCancellation && lossOk && !busy;
  // What's missing, said by the button (the errors themselves sit higher up, often off a phone's screen).
  const missing = [
    !readCancellation ? "tick the box to say you've read your cancellation information" : "",
    !nameOk ? "type your first name and surname" : "",
    !lossOk ? "go back a step to confirm you understand losing the right to cancel" : "",
  ].filter(Boolean);
  const missingSummary = missing.length ? `To accept, ${missing.join(" and ")}.` : "";

  async function submit() {
    setTouched(true);
    if (!canSubmit) {
      if (busy || readOnly) return;
      // Take them to the first thing to fix, so the tap is never silent.
      const target = document.getElementById(!readCancellation ? READ_ID : !nameOk ? NAME_ID : "");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${data.proposalId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          optionId: option.id,
          name,
          earlyStartRequested: earlyStart,
          acknowledgedCancellationInfo: readCancellation,
          acknowledgedLossOfRight: installOnly && earlyStart && lossAck,
          documentHash: data.documentHash,
        }),
      });
      const body = (await res.json().catch(() => null)) as { summary?: AcceptedSummary; error?: string; errors?: string[] } | null;
      if (res.ok && body?.summary) {
        onAccepted(body.summary);
        return;
      }
      if (res.status === 409 && body?.errors?.includes("changed")) {
        setError({ message: body.error ?? "Your proposal has been updated. Please reload the page.", reload: true });
      } else if (res.status === 429) {
        setError({ message: "That's a lot of tries in a short time. Please wait a minute, then try again." });
      } else {
        setError({
          message: body?.error ?? "We couldn't record your acceptance. Nothing has been accepted yet: please try again.",
          ...(body?.errors && body.errors.length > 1 ? { list: body.errors } : {}),
        });
      }
    } catch {
      setError({
        message: "We couldn't reach our server. Check your signal and tap the button again: it's safe to repeat, you won't accept twice.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-white shadow-sm">
      {/* Progress */}
      <div className="border-b border-line px-5 pt-5 sm:px-8 sm:pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Step {step} of 4
        </p>
        <ol className="mt-3 grid grid-cols-4 gap-1.5 pb-5" aria-label="Progress">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <li key={s} className={`h-1.5 rounded-full ${s <= step ? "bg-accent-600" : "bg-line"}`}>
              <span className="sr-only">
                {STEP_TITLE[s]}
                {s < step ? " (done)" : s === step ? " (current)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="px-5 py-6 sm:px-8 sm:py-8">
        <h3 ref={headingRef} tabIndex={-1} className="font-display text-2xl leading-tight text-ink-900 outline-none">
          {STEP_TITLE[step]}
        </h3>

        {step === 1 && (
          <div className="mt-5 space-y-5">
            <Fieldset legend="Which option would you like?">
              <div className="grid gap-3">
                {data.options.map((o) => (
                  <OptionRadio key={o.id} option={o} checked={o.id === option.id} onChange={() => onOptionChange(o.id)} vat={data.vatNotes[o.id] ?? ""} />
                ))}
              </div>
            </Fieldset>
            <StepNav onNext={() => go(2)} nextLabel="Continue" />
          </div>
        )}

        {step === 2 && (
          <div className="mt-5 space-y-5">
            <dl className="divide-y divide-line rounded-2xl border border-line">
              <Row label="Your option" onChange={() => go(1)}>
                <span className="font-semibold text-ink-900">{option.label}</span>
                <span className="mt-0.5 block text-ink-700">{option.roomCards.map((c) => `${c.roomName}: ${c.unitName}`).join("; ")}</span>
              </Row>
              <Row label="What we do">{contractTypeLabel(data.contractType)}, with pipework, the electrical circuit, commissioning and handover.</Row>
              <Row label="Total price" onChange={() => go(1)}>
                <span className="font-semibold tabular-nums text-ink-900">{money(total)}</span>
                <span className="block text-ink-500">{data.vatNotes[option.id]}</span>
              </Row>
              <Row label="Paying">
                <ul className="space-y-1">
                  {(data.paymentTerms[option.id] ?? []).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Row>
              <Row label="Timing">
                {option.installDays} working day{option.installDays === 1 ? "" : "s"} at your home. {data.performance} {data.earliestStart}
              </Row>
              <Row label="Cancelling">{data.cancellation.summary}</Row>
              <Row label="Optional extras">None. Nothing extra is added unless you agree it in writing.</Row>
            </dl>
            <p className="text-sm text-ink-500">
              Something not right? You can{" "}
              <a href="#respond" className="font-semibold text-accent-700 underline underline-offset-2">
                ask us for changes
              </a>{" "}
              instead.
            </p>
            <StepNav onBack={() => go(1)} onNext={() => go(3)} nextLabel="Continue" />
          </div>
        )}

        {step === 3 && (
          <div className="mt-5 space-y-5">
            <div className="space-y-3 text-base leading-relaxed text-ink-700">
              {earlyStartExplainer(data.contractType, data.cancellation.days).map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <div className="rounded-2xl border border-line bg-cream px-4 py-2">
              <Checkbox
                label="I want you to start within my cancellation period"
                hint="Optional. Leave it unticked and we'll wait until your cancellation period has ended."
                checked={earlyStart}
                onChange={(e) => {
                  setEarlyStart(e.target.checked);
                  if (!e.target.checked) setLossAck(false);
                }}
              />
              {earlyStart && installOnly && (
                <Checkbox
                  label="I understand that I lose my right to cancel once you've fully completed the work"
                  checked={lossAck}
                  onChange={(e) => setLossAck(e.target.checked)}
                  {...(touched && !lossAck ? { error: "Please confirm this to start early, or untick the box above." } : {})}
                />
              )}
            </div>
            {earlyStart && (
              <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm leading-relaxed text-sage-900">
                <p className="font-semibold">One more step after you accept</p>
                <p className="mt-1">
                  The law needs your request in a form you can keep. We&apos;ll email your contract straight away: reply to it with these words to confirm.
                </p>
                <blockquote className="mt-2 border-l-4 border-sage-500 pl-3 italic">{data.earlyStart.wording}</blockquote>
              </div>
            )}
            <StepNav onBack={() => go(2)} onNext={() => go(4)} nextLabel="Continue" />
          </div>
        )}

        {step === 4 && (
          <div className="mt-5 space-y-5">
            <CancellationDetails data={data} summaryLabel="Your cancellation information and model form" />
            {data.termsText?.length ? (
              <TermsText sections={data.termsText} version={data.termsVersion} summary={`Our terms (version ${data.termsVersion}): they form part of your contract`} />
            ) : null}
            <Checkbox
              id={READ_ID}
              label="I've read the cancellation information, including the model cancellation form"
              checked={readCancellation}
              onChange={(e) => setReadCancellation(e.target.checked)}
              {...(touched && !readCancellation ? { error: "Please confirm you've read your cancellation information." } : {})}
            />
            {installOnly && earlyStart && !lossAck && (
              <p className="text-sm font-medium text-red-700">
                You asked to start early: go back a step to confirm you understand losing the right to cancel once the work is complete.
              </p>
            )}
            <Input
              id={NAME_ID}
              label="Your full name"
              hint="Your first name and surname. Typing it here is your signature."
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name && setTouched(true)}
              {...(touched && !nameOk ? { error: "Type your first name and surname." } : {})}
              required
            />

            <div className="rounded-2xl border border-accent-100 bg-accent-50/60 p-5">
              <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">What you&apos;re agreeing to</p>
              <dl className="mt-3 space-y-3 text-sm leading-relaxed text-ink-900">
                <Fact label="What you get">
                  {option.label}: {option.roomCards.map((c) => `${c.unitName} in the ${c.roomName.toLowerCase()}`).join(", ")}.{" "}
                  {contractTypeLabel(data.contractType)}, connected, tested, commissioned and handed over.
                </Fact>
                <Fact label="Total price">
                  <span className="font-semibold">{money(total)}</span> ({data.vatNotes[option.id]?.replace(/^./, (c) => c.toLowerCase())})
                </Fact>
                <Fact label="Extra charges">{data.extraCharges}</Fact>
                <Fact label="How long">
                  {option.installDays} working day{option.installDays === 1 ? "" : "s"} at your home. {data.performance}
                </Fact>
                <Fact label="What you commit to">{(data.paymentTerms[option.id] ?? []).slice(0, 2).join(" ")}</Fact>
                <Fact label="Starting early">{earlyStart ? "Yes, you've asked us to start within your cancellation period." : "No, we'll wait until your cancellation period ends."}</Fact>
              </dl>
            </div>

            <div aria-live="polite" role="status" className="min-h-0 space-y-3">
              {touched && missingSummary && !readOnly && (
                <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-900">{missingSummary}</p>
              )}
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  <p className="font-medium">{error.message}</p>
                  {error.list && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {error.list.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {error.reload && (
                    <button type="button" onClick={() => window.location.reload()} className="mt-2 font-semibold text-red-900 underline">
                      Reload the page
                    </button>
                  )}
                </div>
              )}
            </div>

            {readOnly ? (
              <div className="rounded-2xl border border-dashed border-line bg-cream p-4 text-sm text-ink-700">
                {data.viewer === "preview"
                  ? "Preview only: the customer sees the button \"I accept and agree to pay\" here. Nothing can be accepted from a preview."
                  : "You're signed in as staff. Only the customer can accept, from their own link."}
              </div>
            ) : (
              <Button size="lg" block onClick={submit} busy={busy} busyLabel="Recording your acceptance…" disabled={busy} aria-describedby="accept-note">
                I accept and agree to pay {money(total)}
              </Button>
            )}
            <p id="accept-note" className="text-sm text-ink-500">
              This places your order with an obligation to pay. We email your contract and cancellation form straight away.
            </p>
            <StepNav onBack={() => go(3)} />
          </div>
        )}
      </div>
    </div>
  );
}

function OptionRadio({ option, checked, onChange, vat }: { option: ProposalOption; checked: boolean; onChange: () => void; vat: string }) {
  return (
    <label
      className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
        checked ? "border-accent-500 bg-accent-50/60 ring-2 ring-accent-100" : "border-line bg-white hover:border-ink-300"
      }`}
    >
      <input type="radio" name="proposal-option" checked={checked} onChange={onChange} className="mt-1 h-5 w-5 shrink-0 accent-accent-600" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-semibold text-ink-900">{option.label}</span>
          <span className="font-semibold tabular-nums text-ink-900">{money(option.pricing.totalPence)}</span>
        </span>
        <span className="mt-0.5 block text-sm text-ink-700">{option.summary}</span>
        <span className="mt-0.5 block text-xs text-ink-500">{vat}</span>
      </span>
    </label>
  );
}

function Row({ label, children, onChange }: { label: string; children: ReactNode; onChange?: () => void }) {
  return (
    <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[9rem_1fr_auto] sm:gap-4 sm:px-5">
      <dt className="text-sm font-semibold text-ink-900">{label}</dt>
      <dd className="text-sm leading-relaxed text-ink-700">{children}</dd>
      {onChange ? (
        <dd className="sm:text-right">
          <button type="button" onClick={onChange} className="min-h-10 text-sm font-semibold text-accent-700 underline underline-offset-2">
            Change<span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        </dd>
      ) : (
        <dd className="hidden sm:block" />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd className="text-ink-700">{children}</dd>
    </div>
  );
}

function StepNav({ onBack, onNext, nextLabel }: { onBack?: () => void; onNext?: () => void; nextLabel?: string }) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <Button size="lg" onClick={onNext}>
          {nextLabel ?? "Continue"}
        </Button>
      )}
    </div>
  );
}
