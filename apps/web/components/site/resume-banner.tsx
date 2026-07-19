"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadDraft } from "@/lib/quote-draft";
import { track } from "@/lib/analytics-client";

/**
 * "Pick up where you left off": shown on the homepage when this browser has
 * a part-done survey in local storage. The single cheapest conversion win —
 * these people already decided to get a price once.
 */
export function ResumeBanner() {
  const [resume, setResume] = useState<{ postcode: string; configured: boolean } | null>(null);

  useEffect(() => {
    const draft = loadDraft();
    // Only nudge when they got somewhere: address entered at minimum.
    if (draft && draft.survey.postcode && draft.survey.addressLine) {
      setResume({ postcode: draft.survey.postcode, configured: draft.configured });
      track("resume_banner_shown");
    }
  }, []);

  if (!resume) return null;

  return (
    <div className="border-b border-accent-100 bg-accent-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="text-sm text-ink-700">
          <span className="font-semibold">Welcome back.</span> Your survey for{" "}
          <span className="font-semibold">{resume.postcode}</span> is saved —{" "}
          {resume.configured ? "your price is one step away." : "pick up where you left off."}
        </p>
        <Link
          href="/quote"
          onClick={() => track("resume_banner_clicked")}
          className="rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-700"
        >
          Finish my quote →
        </Link>
      </div>
    </div>
  );
}
