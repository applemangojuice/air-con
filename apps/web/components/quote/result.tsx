"use client";

import { useMemo } from "react";
import { generateQuote } from "@aircon/domain";
import { BRAND } from "@/lib/brand";
import type { QuoteDraft } from "@/lib/quote-draft";
import { BookingPanel } from "./booking-panel";
import { QuoteView } from "./quote-view";

export type SubmissionState =
  | { status: "saved"; id: string; emailed: boolean }
  | { status: "demo" }
  | { status: "error" };

export function QuoteResult({
  draft,
  submission,
  onStartOver,
}: {
  draft: QuoteDraft;
  submission: SubmissionState | null;
  onStartOver: () => void;
}) {
  const quote = useMemo(() => generateQuote(draft.survey), [draft.survey]);
  const saved = submission?.status === "saved" ? submission : null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-8 sm:px-0">
      <QuoteView quote={quote} roomCount={draft.survey.rooms.length} />

      {saved && (
        <p className="mt-4 text-sm text-sage-700">
          ✓ Saved{saved.emailed ? ` — a copy is on its way to ${draft.contact.email}` : ""}. Your
          quote lives at{" "}
          <a href={`/q/${saved.id}`} className="font-semibold underline">
            this permanent link
          </a>{" "}
          — bookmark it to come back any time.
        </p>
      )}
      {submission?.status === "error" && (
        <p className="mt-4 text-sm text-red-600">
          We couldn&apos;t save your survey just now — your quote is still valid.
          Screenshot this page or email us at {BRAND.supportEmail}.
        </p>
      )}

      <BookingPanel
        quoteId={saved?.id ?? null}
        installDays={quote.installDays}
        postcode={draft.survey.postcode}
      />

      <button
        type="button"
        onClick={onStartOver}
        className="mt-8 text-sm font-medium text-ink-300 hover:text-ink-700 hover:underline"
      >
        Start a new quote
      </button>
    </div>
  );
}
