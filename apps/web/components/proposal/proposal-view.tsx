"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate, money } from "@/lib/format";
import { AcceptFlow } from "./accept-flow";
import { AcceptedPanel, type AcceptedView } from "./accepted-panel";
import { Respond } from "./respond";
import {
  CancelSection,
  GuaranteesSection,
  IncludedSection,
  OutsideSection,
  PipesSection,
  PlanSection,
  PriceSection,
  RoomsSection,
  SectionHeading,
} from "./sections";
import type { ProposalPageData } from "./types";
import type { AcceptedSummary } from "@/lib/proposal-server";

/**
 * The customer's proposal: the premium page. One obvious next action
 * (accept), with ask-for-changes and decline beside it; everything above it
 * is what they're agreeing to, on their own photos, in plain words.
 */

const VIEW_KEY = (id: string) => `dih-proposal-viewed:${id}`;

export function ProposalView({ data }: { data: ProposalPageData }) {
  const router = useRouter();
  const initial = data.accepted?.optionId ?? data.options[0]?.id ?? "";
  const [optionId, setOptionId] = useState(initial);
  const [justAccepted, setJustAccepted] = useState<AcceptedSummary | null>(null);
  const [responded, setResponded] = useState<"changes" | "decline" | null>(null);
  const [inFlow, setInFlow] = useState(false);
  const acceptedRef = useRef<HTMLDivElement>(null);

  const accepted: AcceptedView | null = justAccepted
    ? {
        optionLabel: justAccepted.optionLabel,
        totalPence: justAccepted.totalPence,
        at: justAccepted.at,
        name: justAccepted.name,
        earlyStartRequested: justAccepted.earlyStartRequested,
        earlyStartEvidenced: false,
        cancellation: justAccepted.cancellation,
        ...(justAccepted.earlyStartWording ? { wording: justAccepted.earlyStartWording } : {}),
        ...(justAccepted.email ? { email: justAccepted.email } : {}),
        ...(justAccepted.contractDocumentId ? { contractDocumentId: justAccepted.contractDocumentId } : {}),
      }
    : data.accepted
      ? {
          ...data.accepted,
          ...(data.accepted.earlyStartRequested ? { wording: data.earlyStart.wording } : {}),
          ...(data.email ? { email: data.email } : {}),
          ...(data.documents.contract ? { contractDocumentId: data.documents.contract.id } : {}),
        }
      : null;

  const state = accepted ? "accepted" : data.state;
  const visibleOptions = accepted ? data.options.filter((o) => o.label === accepted.optionLabel).slice(0, 1) : data.options;
  const option = (accepted ? visibleOptions[0] : data.options.find((o) => o.id === optionId)) ?? data.options[0]!;
  const canAccept = (state === "open" || state === "changes-requested") && responded !== "decline";

  // The phone's sticky "Accept" bar steps aside while the accept or respond section is on screen.
  useEffect(() => {
    const targets = ["accept", "respond"].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setInFlow(visible.size > 0);
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [data.state, responded, justAccepted]);

  // The first customer view, once per browser (the server also only records it once).
  useEffect(() => {
    if (data.viewer !== "customer" || (data.state !== "open" && data.state !== "changes-requested")) return;
    try {
      if (sessionStorage.getItem(VIEW_KEY(data.proposalId))) return;
    } catch {
      /* private mode: just send it */
    }
    void fetch(`/api/proposals/${data.proposalId}/view`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((r) => {
        if (r.ok) {
          try {
            sessionStorage.setItem(VIEW_KEY(data.proposalId), "1");
          } catch {
            /* fine */
          }
        }
      })
      .catch(() => undefined);
  }, [data.proposalId, data.state, data.viewer]);

  function onAccepted(summary: AcceptedSummary) {
    setJustAccepted(summary);
    router.refresh();
  }

  // Once the confirmation is on screen, take them (and their screen reader) to it.
  useEffect(() => {
    if (!justAccepted) return;
    acceptedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    acceptedRef.current?.querySelector<HTMLElement>("#accepted-h")?.focus({ preventScroll: true });
  }, [justAccepted]);

  const total = option.pricing.totalPence;
  const aboveInstant = data.instantPricePence > 0 && total > data.instantPricePence && data.increaseReason;
  let n = 0;
  const next = () => ++n;

  return (
    <div className="space-y-12 sm:space-y-16">
      {data.viewer === "preview" && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Preview: this is exactly what the customer will see once this version is issued. Nothing here can be accepted.
        </p>
      )}
      {data.viewer === "staff" && (
        <p className="rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 text-sm font-medium text-sage-900">
          You&apos;re viewing the customer&apos;s page as staff. Viewing it here doesn&apos;t count as the customer opening it.
        </p>
      )}

      {accepted && (
        <div ref={acceptedRef} className="scroll-mt-6">
          <AcceptedPanel view={accepted} projectId={data.projectId} firstName={data.firstName} phone={data.company.phone} justNow={Boolean(justAccepted)} />
        </div>
      )}

      {/* Summary */}
      <section aria-labelledby="summary-h" className="warm-gradient overflow-hidden rounded-3xl border border-line">
        <div className="px-5 pb-6 pt-7 sm:px-10 sm:pb-10 sm:pt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">Proposal · version {data.version}</p>
          {data.ref && <p className="mt-0.5 text-xs tabular-nums text-ink-500">Reference {data.ref}</p>}
          <h1 id="summary-h" className="mt-2 font-display text-4xl leading-[1.05] text-ink-900 sm:text-5xl">
            {state === "accepted" ? "Your heating and cooling, agreed" : "Your heating and cooling proposal"}
          </h1>
          <p className="mt-3 max-w-xl text-lg text-ink-700">
            {data.firstName ? `${data.firstName}, here's` : "Here's"} what we&apos;d fit at {data.place}: drawn on your own photos, with a fixed price in writing.
          </p>

          <StateBanner data={data} state={state} responded={responded} />

          {visibleOptions.length > 1 && (
            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-semibold text-ink-900">Choose an option</legend>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {visibleOptions.map((o) => {
                  const on = o.id === option.id;
                  return (
                    <label
                      key={o.id}
                      className={`cursor-pointer rounded-2xl border px-4 py-3 transition focus-within:ring-2 focus-within:ring-accent-500 ${
                        on ? "border-ink-900 bg-white shadow-sm ring-1 ring-ink-900" : "border-line bg-white/70 hover:bg-white"
                      }`}
                    >
                      <input type="radio" name="option-toggle" className="sr-only" checked={on} onChange={() => setOptionId(o.id)} />
                      <span className="block font-semibold text-ink-900">{o.label}</span>
                      <span className="block text-sm tabular-nums text-ink-700">{money(o.pricing.totalPence)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="mt-6 rounded-2xl border border-line bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink-500">{state === "accepted" ? "Contract price" : "Pilot price"}</p>
                <p className="font-display text-5xl leading-none tabular-nums text-ink-900">{money(total)}</p>
                <p className="mt-2 text-sm text-ink-500">{data.vatNotes[option.id]}</p>
              </div>
              {data.foundingPilot && (
                <span className="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-700">Founding pilot price</span>
              )}
            </div>
            <p className="mt-4 text-base text-ink-700">{option.summary}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {option.highlights.map((h) => (
                <li key={h} className="rounded-full bg-cream px-3 py-1 text-sm font-medium text-ink-700">
                  {h}
                </li>
              ))}
            </ul>
            <dl className="mt-5 grid gap-3 border-t border-line pt-5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-500">Installation</dt>
                <dd className="font-semibold text-ink-900">
                  {option.installDays} working day{option.installDays === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">{accepted ? "Accepted on" : "Valid until"}</dt>
                <dd className="font-semibold text-ink-900">{fmtDate(accepted ? accepted.at : data.validUntil)}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Design signed off by</dt>
                <dd className="font-semibold text-ink-900">{data.approvedBy ?? "Our engineer"}</dd>
              </div>
            </dl>
            {state !== "accepted" && <p className="mt-4 text-sm leading-relaxed text-ink-500">{data.earliestStart}</p>}
          </div>

          {aboveInstant && (
            <div className="mt-4 rounded-2xl border border-line bg-white/80 p-5">
              <p className="text-sm font-semibold text-ink-900">
                Why this is more than your online estimate of {money(data.instantPricePence)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-700">{data.increaseReason}</p>
            </div>
          )}

          {canAccept && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href="#accept" className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-accent-700">
                Accept this proposal
              </a>
              <a href="#respond" className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-6 py-3 text-base font-semibold text-ink-900 transition hover:bg-surface">
                Ask for changes
              </a>
            </div>
          )}
        </div>
      </section>

      <RoomsSection data={data} option={option} n={next()} />
      <OutsideSection data={data} option={option} n={next()} />
      <PipesSection option={option} n={next()} />
      <IncludedSection data={data} n={next()} />
      <PlanSection option={option} n={next()} />
      <PriceSection data={data} option={option} n={next()} />
      <GuaranteesSection data={data} n={next()} />
      <CancelSection data={data} n={next()} />

      {canAccept && (
        <section id="accept" aria-labelledby="accept-h" className="scroll-mt-6">
          <SectionHeading n={next()} id="accept-h" title="Accept your proposal" lead="Four short steps. Nothing is agreed until the last one." />
          <AcceptFlow data={data} optionId={option.id} onOptionChange={setOptionId} onAccepted={onAccepted} />
        </section>
      )}

      {(canAccept || responded) && (
        <section id="respond" aria-labelledby="respond-h" className="scroll-mt-6">
          <SectionHeading id="respond-h" title="Not quite right?" lead="Ask us to change something, or let us know it's not for you. No hard feelings either way." />
          <Respond
            data={data}
            onDone={(kind) => {
              setResponded(kind);
              router.refresh();
            }}
          />
        </section>
      )}

      <section aria-labelledby="docs-h" className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 id="docs-h" className="font-semibold text-ink-900">
          Your documents and questions
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.documents.proposal && (
            <li>
              {/* INTEGRATION(F1): /d/[id] renders the printable proposal. */}
              <a href={`/d/${data.documents.proposal.id}`} className="font-semibold text-accent-700 underline underline-offset-2">
                Your proposal to print or save ({data.documents.proposal.ref})
              </a>
            </li>
          )}
          {data.documents.contract && (
            <li>
              <a href={`/d/${data.documents.contract.id}`} className="font-semibold text-accent-700 underline underline-offset-2">
                Your contract confirmation ({data.documents.contract.ref})
              </a>
            </li>
          )}
          <li>
            <a href={`/p/${data.projectId}`} className="font-semibold text-accent-700 underline underline-offset-2">
              Your project page
            </a>
          </li>
        </ul>
        <p className="mt-3 text-sm text-ink-500">
          Questions about anything here? Call {data.company.phone} or email{" "}
          <a href={`mailto:${data.company.email}`} className="font-semibold text-accent-700 underline">
            {data.company.email}
          </a>
          . {data.company.legalName}
          {data.company.tradingName && data.company.tradingName !== data.company.legalName ? `, trading as ${data.company.tradingName}` : ""}. Terms version {data.termsVersion}.
        </p>
      </section>

      {/* The one next action, always in reach on a phone. */}
      {canAccept && !inFlow && data.viewer === "customer" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-500">{option.label} · pilot price</p>
              <p className="font-semibold tabular-nums text-ink-900">{money(total)}</p>
            </div>
            <a href="#accept" className="inline-flex min-h-12 items-center rounded-full bg-accent-600 px-5 text-base font-semibold text-white shadow-sm">
              Accept
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function StateBanner({ data, state, responded }: { data: ProposalPageData; state: string; responded: "changes" | "decline" | null }) {
  if (responded === "decline" || state === "declined") {
    return (
      <div className="mt-5 rounded-2xl border border-line bg-white p-4 text-sm text-ink-700">
        <p className="font-semibold text-ink-900">You&apos;ve declined this proposal.</p>
        <p className="mt-1">
          Thanks for letting us know{data.declineReason ? ` (“${data.declineReason}”)` : ""}. Changed your mind, or want something different? Call us on {data.company.phone}.
        </p>
      </div>
    );
  }
  if (state === "expired") {
    return (
      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">This proposal was valid until {fmtDate(data.validUntil)}.</p>
        <p className="mt-1">
          Prices and availability may have changed, so it can&apos;t be accepted as it is. Call us on {data.company.phone} or email {data.company.email} and we&apos;ll send you an updated one.
        </p>
      </div>
    );
  }
  if (responded === "changes" || state === "changes-requested") {
    return (
      <div className="mt-5 rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm text-sage-900">
        <p className="font-semibold">We&apos;ve got your request for changes.</p>
        {data.changeRequest && <p className="mt-1 whitespace-pre-line">“{data.changeRequest}”</p>}
        <p className="mt-1">We&apos;ll send you a revised proposal. You can still accept this one if you change your mind.</p>
      </div>
    );
  }
  return null;
}
