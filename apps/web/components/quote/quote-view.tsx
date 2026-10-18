"use client";

import { useId, useState, type ReactNode } from "react";
import type { QuoteResult as Quote } from "@aircon/domain";
import { fmtDate, gbp } from "@/lib/format";
import {
  BAND_COPY,
  PRICE_PROMISE,
  installDurationCopy,
  validUntil,
  vatCopy,
  warrantyCopy,
  type PublicSettings,
} from "@/components/site/claims";

/**
 * The price, said honestly: "your price, confirmed at your home survey",
 * with the confidence band, the install length and validity from settings,
 * VAT only as settings allow, and no warranty years, finance examples or
 * "price locked" unless they're real. Used by the funnel's demo result and
 * the saved /q/[id] page.
 */
export function QuoteView({
  quote,
  roomCount,
  settings,
  createdAt,
  afterHero,
}: {
  quote: Quote;
  roomCount: number;
  settings: PublicSettings;
  /** When the price was given; sets the "valid until" date. */
  createdAt?: string;
  /** The next action, placed straight after the price so it's never below the fold. */
  afterHero?: ReactNode;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const breakdownId = useId();
  const band = BAND_COPY[quote.confidence.band];
  const vat = vatCopy(settings);
  const warranty = warrantyCopy(settings);
  const until = createdAt ? validUntil(settings, createdAt) : null;
  const finance = settings.finance.lenderConfigured ? quote.finance : [];

  return (
    <div>
      {/* Hero */}
      <div className="ink-gradient overflow-hidden rounded-3xl p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-white/80">Your price</p>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${band.tone}`}>
            {band.label} · {quote.confidence.score}/100
          </span>
        </div>
        <p className="mt-3 text-5xl font-display">{gbp(quote.totalGbp)}</p>
        <p className="mt-2 text-sm text-white/80">
          {roomCount} room{roomCount === 1 ? "" : "s"} · heating and cooling · {installDurationCopy(settings).toLowerCase()}
          {vat.short ? ` · ${vat.short}` : ""}
        </p>
        <p className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm leading-relaxed text-white/90">{PRICE_PROMISE}</p>
      </div>

      <p className="mt-4 text-sm text-ink-700">
        <span className="font-semibold text-ink-900">
          {until ? `Valid until ${fmtDate(until)}.` : `Valid for ${settings.quoteValidityDays} days.`}
        </span>{" "}
        {band.body}
      </p>

      {afterHero && <div className="mt-6">{afterHero}</div>}

      {/* Systems */}
      <section className="mt-8" aria-labelledby={`${breakdownId}-system`}>
        <h2 id={`${breakdownId}-system`} className="text-lg font-bold">
          Your system
        </h2>
        <ul className="mt-3 space-y-3">
          {quote.systems.map((system, i) => (
            <li key={i} className="rounded-2xl border border-line bg-white p-4">
              <p className="font-semibold">{system.outdoorLabel}</p>
              <ul className="mt-2 space-y-1.5">
                {system.rooms.map((room) => (
                  <li key={room.roomId} className="flex justify-between gap-3 text-sm text-ink-700">
                    <span>{room.roomName}</span>
                    <span className="text-right text-ink-500">{room.unitLabel}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-500">
          Sizes come from your answers. Your surveyor measures each room, and a qualified engineer signs off the final
          design.
        </p>
      </section>

      {/* Breakdown */}
      <section className="mt-6">
        <button
          type="button"
          aria-expanded={showBreakdown}
          aria-controls={breakdownId}
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="text-sm font-semibold text-accent-700 underline-offset-2 hover:underline"
        >
          {showBreakdown ? "Hide" : "Show"} the price breakdown
        </button>
        <div id={breakdownId} hidden={!showBreakdown}>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
            {quote.lines.map((line, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{line.label}</span>
                  {line.detail && <span className="block text-xs text-ink-500">{line.detail}</span>}
                </span>
                <span className="font-semibold">{gbp(line.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 text-sm font-bold">
              <span>Total</span>
              <span>{gbp(quote.totalGbp)}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-ink-500">{vat.long}</p>
        </div>
      </section>

      {/* Confidence gaps */}
      {quote.confidence.gaps.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-900">To firm up your price</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {quote.confidence.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-900">Or leave it to your surveyor: they check all of this at your home.</p>
        </section>
      )}

      {/* Review flags */}
      {quote.reviewFlags.length > 0 && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">Your surveyor will check</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
            {quote.reviewFlags.map((flag) => (
              // The engine's older wording says "lock this line in"; nothing is locked before the survey.
              <li key={flag}>{flag.replace(/lets us lock this line in/i, "helps us firm up this line")}</li>
            ))}
          </ul>
        </section>
      )}

      {warranty && (
        <section className="mt-4 rounded-2xl border border-line bg-white p-4">
          <h2 className="text-sm font-bold">{warranty.headline}</h2>
          <p className="mt-1 text-sm text-ink-700">{warranty.body} All on top of your statutory rights.</p>
        </section>
      )}

      {/* Finance: a regulated promotion, shown only once a lender is in place. */}
      {finance.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Spread the cost</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {finance.map((f) => (
              <div key={f.months} className="rounded-2xl border border-line bg-white p-4 text-center">
                <p className="text-xs font-semibold text-ink-500">{f.months} months</p>
                <p className="mt-1 text-xl font-bold">{gbp(f.monthlyGbp)}</p>
                <p className="text-xs text-ink-500">per month</p>
                <p className="mt-2 text-xs text-ink-500">
                  {gbp(f.depositGbp)} deposit · {f.aprPercent}% APR · total {gbp(f.totalPayableGbp)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">Finance is subject to status and the lender&apos;s approval.</p>
        </section>
      )}
    </div>
  );
}
