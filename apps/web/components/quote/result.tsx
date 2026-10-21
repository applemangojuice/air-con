"use client";

import { useMemo } from "react";
import { generateQuote } from "@aircon/domain";
import type { QuoteDraft } from "@/lib/quote-draft";
import { surveyDurationCopy, surveyPriceCopy, type PublicSettings } from "@/components/site/claims";
import { BookSurveyButton } from "./book-survey";
import { JourneyStrip } from "./journey-strip";
import { LegalLinks } from "./legal-links";
import { QuoteView } from "./quote-view";

/**
 * The in-funnel result, used only when nothing could be saved because this
 * deployment has no database (demo mode). A saved quote goes straight to its
 * permanent /q/[id] page instead, which survives a refresh.
 */
export function DemoResult({
  draft,
  settings,
  onStartOver,
}: {
  draft: QuoteDraft;
  settings: PublicSettings;
  onStartOver: () => void;
}) {
  const quote = useMemo(() => generateQuote(draft.survey), [draft.survey]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-8 sm:px-0">
      <div className="mb-6">
        <JourneyStrip current="price" />
      </div>
      <p role="status" className="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        This is a demo site, so your quote wasn&apos;t saved and nothing was emailed.
      </p>
      <QuoteView
        quote={quote}
        roomCount={draft.survey.rooms.length}
        settings={settings}
        afterHero={
          <BookSurveyButton
            quoteId={null}
            surveyPrice={surveyPriceCopy(settings)}
            surveyDuration={surveyDurationCopy(settings)}
          />
        }
      />
      <button
        type="button"
        onClick={onStartOver}
        className="mt-8 min-h-10 text-sm font-semibold text-ink-700 underline-offset-2 hover:underline"
      >
        Start a new quote
      </button>
      <LegalLinks className="mt-6" />
    </div>
  );
}
