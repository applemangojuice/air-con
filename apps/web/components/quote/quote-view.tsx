"use client";

import { useState } from "react";
import type { QuoteResult as Quote } from "@aircon/domain";
import { gbp } from "@/lib/format";

export const BAND_COPY = {
  high: {
    label: "Price locked",
    cls: "bg-sage-50 text-sage-700 border-sage-200",
    body: "Your survey is complete enough for us to guarantee this price as-is.",
  },
  medium: {
    label: "Nearly locked",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    body: "This price is fixed once we've reviewed your photos — usually within one working day.",
  },
  low: {
    label: "Provisional",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    body: "A few details are missing, so treat this as a close estimate. Add the items below to lock it in.",
  },
} as const;

/** Presentational quote: hero, system, breakdown, confidence, finance.
 *  Used by the wizard result and the saved /q/[id] page. */
export function QuoteView({ quote, roomCount }: { quote: Quote; roomCount: number }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const band = BAND_COPY[quote.confidence.band];
  const longest = quote.finance[quote.finance.length - 1];

  return (
    <div>
      {/* Hero */}
      <div className="ink-gradient overflow-hidden rounded-3xl p-6 text-white sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-white/70">Your fixed installation price</p>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${band.cls}`}>
            {band.label} · {quote.confidence.score}/100
          </span>
        </div>
        <p className="mt-3 text-5xl font-display">{gbp(quote.totalGbp)}</p>
        <p className="mt-2 text-sm text-white/70">
          {roomCount} room{roomCount > 1 ? "s" : ""} ·{" "}
          {quote.installDays === 1 ? "1-day install" : `${quote.installDays}-day install`} ·{" "}
          {quote.warrantyYears}-year parts &amp; labour warranty · VAT included
        </p>
        {longest && (
          <p className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm">
            Or from <span className="font-bold">{gbp(longest.monthlyGbp)}/month</span> over{" "}
            {longest.months} months with a {gbp(longest.depositGbp)} deposit.
          </p>
        )}
      </div>

      <p className="mt-4 text-sm text-ink-500">{band.body}</p>

      {/* Systems */}
      <section className="mt-8">
        <h2 className="text-lg font-bold">Your system</h2>
        <ul className="mt-3 space-y-3">
          {quote.systems.map((system, i) => (
            <li key={i} className="rounded-2xl border border-line p-4">
              <p className="font-semibold">{system.outdoorLabel}</p>
              <ul className="mt-2 space-y-1.5">
                {system.rooms.map((room) => (
                  <li key={room.roomId} className="flex justify-between text-sm text-ink-500">
                    <span>{room.roomName}</span>
                    <span>{room.unitLabel}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {/* Breakdown */}
      <section className="mt-6">
        <button
          type="button"
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="text-sm font-semibold text-accent-600 hover:underline"
        >
          {showBreakdown ? "Hide" : "Show"} full price breakdown
        </button>
        {showBreakdown && (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {quote.lines.map((line, i) => (
              <li key={i} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{line.label}</span>
                  {line.detail && <span className="block text-xs text-ink-300">{line.detail}</span>}
                </span>
                <span className="font-semibold">{gbp(line.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 text-sm font-bold">
              <span>Total (inc. VAT)</span>
              <span>{gbp(quote.totalGbp)}</span>
            </li>
          </ul>
        )}
      </section>

      {/* Confidence gaps */}
      {quote.confidence.gaps.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-800">To lock this price in</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800/90">
            {quote.confidence.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Review flags */}
      {quote.reviewFlags.length > 0 && (
        <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">Our design team will double-check</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-500">
            {quote.reviewFlags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Finance */}
      {quote.finance.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Spread the cost</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {quote.finance.map((f) => (
              <div key={f.months} className="rounded-2xl border border-line p-4 text-center">
                <p className="text-xs font-semibold text-ink-300">{f.months} months</p>
                <p className="mt-1 text-xl font-bold">{gbp(f.monthlyGbp)}</p>
                <p className="text-xs text-ink-300">per month</p>
                <p className="mt-2 text-[11px] text-ink-300">
                  {gbp(f.depositGbp)} deposit · {f.aprPercent}% APR · total {gbp(f.totalPayableGbp)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-300">
            Illustrative figures — finance subject to status and lender approval.
          </p>
        </section>
      )}
    </div>
  );
}
