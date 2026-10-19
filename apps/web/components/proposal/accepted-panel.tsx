"use client";

import Link from "next/link";
import { useState } from "react";
import { LinkButton } from "@/components/kit";
import { fmtDate, money } from "@/lib/format";

/**
 * After acceptance: what they agreed, what happens next, where their
 * cancellation period stands, and (if they asked to start early) the exact
 * words to reply with, which is the durable record ops then files.
 */

export interface AcceptedView {
  optionLabel: string;
  totalPence: number;
  at: string;
  name: string;
  earlyStartRequested: boolean;
  earlyStartEvidenced: boolean;
  cancellation: string;
  wording?: string;
  email?: string;
  contractDocumentId?: string;
  /** When the confirmation email (their contract copy) went, once the outbox has recorded it. */
  confirmationSentAt?: string;
}

export function AcceptedPanel({
  view,
  projectId,
  firstName,
  phone,
  justNow,
  emailDemo = false,
}: {
  view: AcceptedView;
  projectId: string;
  firstName: string;
  phone: string;
  justNow: boolean;
  /** No email provider (a demo deployment): nothing was emailed, so never say it was. */
  emailDemo?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const needsReply = view.earlyStartRequested && !view.earlyStartEvidenced && Boolean(view.wording);

  async function copy() {
    if (!view.wording) return;
    try {
      await navigator.clipboard.writeText(view.wording);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="accepted-h" className="rounded-3xl border border-emerald-200 bg-white shadow-sm">
      <div className="rounded-t-3xl bg-emerald-50 px-5 py-6 sm:px-8">
        <p className="text-sm font-semibold text-emerald-800">{justNow ? "Accepted. Thank you." : "Accepted"}</p>
        <h2 id="accepted-h" tabIndex={-1} className="mt-1 font-display text-3xl leading-tight text-ink-900 outline-none">
          {justNow ? `You're all set${firstName ? `, ${firstName}` : ""}` : "Your proposal is accepted"}
        </h2>
        <p className="mt-2 text-base text-ink-700">
          {view.name} accepted <span className="font-semibold text-ink-900">{view.optionLabel}</span> for{" "}
          <span className="font-semibold text-ink-900">{money(view.totalPence)}</span> on {fmtDate(view.at)}.
        </p>
      </div>

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {needsReply && (
          <div className="rounded-2xl border border-accent-100 bg-accent-50/70 p-5">
            <p className="font-semibold text-ink-900">One thing to do: confirm your early start</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-700">
              You asked us to start within your cancellation period. For that to count, the law needs it from you in writing.
              Reply to your confirmation email{view.email ? ` (sent to ${view.email})` : ""} with these exact words:
            </p>
            <blockquote className="mt-3 rounded-xl border-l-4 border-accent-500 bg-white px-4 py-3 text-sm italic leading-relaxed text-ink-900">
              {view.wording}
            </blockquote>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={copy}
                className="inline-flex min-h-10 items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface"
              >
                Copy the words
              </button>
              <span role="status" aria-live="polite" className="text-sm text-emerald-800">
                {copied ? "Copied" : ""}
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-500">Until we have your reply, we won&apos;t start before your cancellation period ends.</p>
          </div>
        )}
        {view.earlyStartRequested && view.earlyStartEvidenced && (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            We&apos;ve got your email asking us to start early, and saved it with your contract.
          </p>
        )}

        <div>
          <h3 className="font-semibold text-ink-900">What happens next</h3>
          <ol className="mt-3 space-y-3">
            {[
              emailDemo
                ? `This is a demo: email isn't set up, so nothing was emailed.${view.contractDocumentId ? " Your contract and cancellation form are in your documents." : ""}`
                : view.confirmationSentAt && !justNow
                  ? `We emailed your contract and cancellation form${view.email ? ` to ${view.email}` : ""} on ${fmtDate(view.confirmationSentAt)}. Please keep that email: it's your copy.`
                  : view.email
                    ? `Your contract and cancellation form are on their way to ${view.email}. Please keep that email: it's your copy.${justNow ? "" : ` If it hasn't arrived, call us on ${phone} and we'll send it again.`}`
                    : view.contractDocumentId
                      ? "Your contract and cancellation form are in your documents. Please keep a copy."
                      : `We'll send you your contract and cancellation form to keep. If they don't arrive, call us on ${phone}.`,
              "Choose your install dates on your project page. We then confirm the dates and introduce your team.",
              "We order your equipment and tell you when it's delivered.",
            ].map((t, i) => (
              <li key={t} className="flex gap-3 text-sm leading-relaxed text-ink-700">
                <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sage-50 text-xs font-semibold text-sage-700">
                  {i + 1}
                </span>
                <span className="pt-1">{t}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl bg-cream px-4 py-3">
          <p className="text-sm font-semibold text-ink-900">Your cancellation period</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-700">{view.cancellation}</p>
          <p className="mt-1 text-sm text-ink-500">To cancel, tell us clearly by email, letter or phone ({phone}).</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <LinkButton href={`/p/${projectId}#booking`} size="lg">
            Choose your install dates
          </LinkButton>
          {view.contractDocumentId && (
            // /d/[id] renders the contract document (F1).
            <LinkButton href={`/d/${view.contractDocumentId}`} variant="secondary" size="lg">
              View your contract
            </LinkButton>
          )}
        </div>
        <p className="text-sm text-ink-500">
          Questions? Call us on <Link href={`tel:${phone.replace(/\s+/g, "")}`} className="font-semibold text-accent-700 underline">{phone}</Link>.
        </p>
      </div>
    </section>
  );
}
