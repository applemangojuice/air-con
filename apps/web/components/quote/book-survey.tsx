"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@/lib/analytics-client";
import { primaryBtn } from "./ui";

/**
 * The one next action after a price: "Book my home survey". It turns the
 * saved quote into a project (POST /api/projects {quoteId} → {id}, idempotent
 * server-side) and lands on the project page, where the survey slot is
 * picked. On a revisit with a project already started it simply opens it.
 */
// /p/[id] is the portal hub with the survey booking panel. The browser that
// saved the quote holds its quote-owner cookie (lib/auth/quote-owner.ts), which
// opens this one project without an email round trip; anyone else gets the
// hub's "we've emailed you a sign-in link" page.
export function BookSurveyButton({
  quoteId,
  existingProjectId,
  surveyPrice,
  surveyDuration,
}: {
  /** null in demo mode (no database): the button opens the playable demo. */
  quoteId: string | null;
  existingProjectId?: string | null;
  surveyPrice: string;
  surveyDuration: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");

  async function start() {
    track("survey_cta_clicked", { existing: Boolean(existingProjectId) });
    if (existingProjectId) return router.push(`/p/${existingProjectId}`);
    if (!quoteId) return router.push("/p/demo");
    setState("sending");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      const data = (await res.json().catch(() => null)) as { demo?: boolean; id?: string } | null;
      if (!res.ok || !data) return setState("error");
      router.push(data.demo || !data.id ? "/p/demo" : `/p/${data.id}`);
    } catch {
      setState("error");
    }
  }

  const facts = [surveyPrice, surveyDuration, "at a time that suits you", "no obligation"].filter(Boolean).join(" · ");

  return (
    <section aria-labelledby="next-step" className="no-print rounded-sm border border-accent-100 bg-accent-50 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">Your next step</p>
      <h2 id="next-step" className="mt-1 text-xl font-display">
        {existingProjectId ? "Your project is underway" : "A home survey to confirm your price"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-700">
        {existingProjectId
          ? "Everything from here lives on your project page: your survey, your proposal and every date."
          : "A surveyor visits to measure your rooms, check where the units and pipes can go, and look at your fuse board. Then we design your system and send a proposal with your price in writing."}
      </p>
      {!existingProjectId && <p className="mt-2 text-sm font-medium text-ink-900">{facts}</p>}
      <button
        type="button"
        onClick={start}
        disabled={state === "sending"}
        aria-busy={state === "sending" || undefined}
        className={`${primaryBtn} mt-5 w-full`}
      >
        {state === "sending" ? "Setting up your project…" : existingProjectId ? "Open my project" : "Book my home survey"}
      </button>
      <p aria-live="polite" className="mt-2 text-center text-sm">
        {state === "error" && (
          <span className="font-medium text-red-700">That didn&apos;t go through. Check your signal and try again.</span>
        )}
        {state !== "error" && !quoteId && !existingProjectId && (
          <span className="text-ink-500">Demo mode: this opens an example project.</span>
        )}
      </p>
    </section>
  );
}
