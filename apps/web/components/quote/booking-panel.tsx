"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { OptionCards } from "./ui";

export type PreferredStart = "asap" | "2-4-weeks" | "1-2-months" | "flexible";

export interface BookingRequest {
  preferredStart: PreferredStart;
  notes: string;
}

export const PREFERRED_START_LABEL: Record<PreferredStart, string> = {
  asap: "As soon as possible",
  "2-4-weeks": "In 2–4 weeks",
  "1-2-months": "In 1–2 months",
  flexible: "I'm flexible",
};

/**
 * "Book my installation" — attaches a booking request to a saved quote.
 * Falls back to email when the quote couldn't be saved (demo mode/offline).
 */
export function BookingPanel({
  quoteId,
  installDays,
  postcode,
  initialBooking,
}: {
  quoteId: string | null;
  installDays: number;
  postcode: string;
  initialBooking?: BookingRequest | null;
}) {
  const [booking, setBooking] = useState<BookingRequest>({
    preferredStart: "2-4-weeks",
    notes: "",
  });
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    initialBooking ? "done" : "idle",
  );
  const confirmed = initialBooking ?? booking;

  async function requestBooking() {
    if (!quoteId) return;
    setState("sending");
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId, ...booking }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <section className="mt-8 rounded-3xl border border-sage-200 bg-sage-50 p-6">
        <h2 className="text-lg font-bold text-sage-900">Booking requested ✓</h2>
        <p className="mt-2 text-sm text-sage-800">
          Preferred start: <strong>{PREFERRED_START_LABEL[confirmed.preferredStart]}</strong>.
          We&apos;ll confirm your installation date within one working day, then
          send your deposit link to secure it.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-3xl border border-accent-100 bg-accent-50 p-6">
      <h2 className="text-lg font-bold">What happens next</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-700">
        <li>We review your photos and confirm your fixed price.</li>
        <li>We agree an installation date and you pay a deposit to secure it.</li>
        <li>
          Our engineers install, test and hand over — usually in{" "}
          {installDays === 1 ? "a single day" : `${installDays} days`}.
        </li>
      </ol>

      {quoteId ? (
        <div className="mt-5 space-y-4">
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-ink-900">
              When would you like the installation?
            </span>
            <OptionCards<PreferredStart>
              value={booking.preferredStart}
              onChange={(preferredStart) => setBooking((b) => ({ ...b, preferredStart }))}
              options={[
                { value: "asap", label: "ASAP" },
                { value: "2-4-weeks", label: "2–4 weeks" },
                { value: "1-2-months", label: "1–2 months" },
                { value: "flexible", label: "Flexible" },
              ]}
            />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink-900">
              Anything we should know? <span className="font-normal text-ink-300">(optional)</span>
            </span>
            <textarea
              className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              rows={2}
              placeholder="Parking, pets, best days of the week…"
              value={booking.notes}
              onChange={(e) => setBooking((b) => ({ ...b, notes: e.target.value }))}
            />
          </label>
          <button
            type="button"
            onClick={requestBooking}
            disabled={state === "sending"}
            className="block w-full rounded-full bg-accent-600 px-5 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:opacity-40"
          >
            {state === "sending" ? "Sending…" : "Book my installation"}
          </button>
          {state === "error" && (
            <p className="text-sm text-red-600">
              That didn&apos;t send — try again, or email {BRAND.supportEmail}.
            </p>
          )}
          <p className="text-center text-xs text-ink-300">
            No payment now — booking is free and doesn&apos;t commit you.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <a
            href={`mailto:${BRAND.supportEmail}?subject=Booking request — ${encodeURIComponent(postcode)}`}
            className="block rounded-full bg-accent-600 px-5 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-accent-700"
          >
            Book my installation
          </a>
          <p className="mt-2 text-center text-xs text-ink-300">
            This drops us an email and we reply the same day.
          </p>
        </div>
      )}
    </section>
  );
}
