"use client";

import { useId, useState, type ReactNode } from "react";
import { customerChecks, type QuoteResult as Quote } from "@aircon/domain";
import { fmtDate, gbp } from "@/lib/format";
import {
  BAND_COPY,
  PRICE_PROMISE,
  financeDisclosure,
  gapsAsSurveyChecks,
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
  // What the answers didn't cover, then what the engine wants confirmed: one list, all the surveyor's.
  const checks = [...new Set([...gapsAsSurveyChecks(quote.confidence.gaps), ...customerChecks(quote.reviewFlags, { outdoorUnits: quote.systems.length })])];
  const until = createdAt ? validUntil(settings, createdAt) : null;
  const finance = settings.finance.offered ? settings.finance : null;

  return (
    <div>
      {/* Hero */}
      <div className="ink-gradient overflow-hidden rounded-sm p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-white/80">Your price</p>
          <span className={`rounded-sm border px-2.5 py-0.5 text-xs font-semibold ${band.tone}`}>
            {band.label} · {quote.confidence.score}/100
          </span>
        </div>
        <p className="mt-3 text-5xl font-display">{gbp(quote.totalGbp)}</p>
        <p className="mt-2 text-sm text-white/80">
          {roomCount} room{roomCount === 1 ? "" : "s"} · heating and cooling · {installDurationCopy(settings).toLowerCase()}
          {vat.short ? ` · ${vat.short}` : ""}
        </p>
        <p className="mt-4 rounded-sm bg-white/10 px-4 py-3 text-sm leading-relaxed text-white/90">{PRICE_PROMISE}</p>
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
            <li key={i} className="rounded-sm border border-line bg-white p-4">
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
          <ul className="mt-3 divide-y divide-line rounded-sm border border-line bg-white">
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

      {/* What the survey confirms, in the customer's words: the details the answers didn't cover
          (nothing can be added here, so never as instructions) and the engine's flags (written for the office). */}
      {checks.length > 0 && (
        <section className="mt-6 rounded-sm border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">Your surveyor will check</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
            {checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </section>
      )}

      {warranty && (
        <section className="mt-4 rounded-sm border border-line bg-white p-4">
          <h2 className="text-sm font-bold">{warranty.headline}</h2>
          <p className="mt-1 text-sm text-ink-700">{warranty.body} All on top of your statutory rights.</p>
        </section>
      )}

      {/* Finance: a regulated promotion. Only with every fact on record (financeOffered), and only the lender's own example, word for word. */}
      {finance && (
        <section className="mt-8 rounded-sm border border-line bg-white p-4 sm:p-5">
          <h2 className="text-lg font-bold">Spreading the cost</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-ink-900">{finance.representativeExample}</p>
          {financeDisclosure(finance, settings.company.tradingName).map((line) => (
            <p key={line} className="mt-2 text-xs text-ink-500">
              {line}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
