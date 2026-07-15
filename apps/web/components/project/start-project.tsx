"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_STAGES, SITE_VISIT, STAGE_INFO } from "@aircon/domain";
import { gbp } from "@/lib/format";

/**
 * "Start your installation plan" — turns a saved quote into a project and
 * lands the customer on their timeline. Idempotent server-side, so it also
 * acts as the "open my timeline" button on revisits.
 */
export function StartProjectPanel({
  quoteId,
  existingProjectId,
}: {
  quoteId: string | null;
  existingProjectId?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");

  async function start() {
    if (!quoteId) return router.push("/p/demo");
    setState("sending");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { demo?: boolean; id?: string }
        | null;
      if (!res.ok || !data) return setState("error");
      router.push(data.demo || !data.id ? "/p/demo" : `/p/${data.id}`);
    } catch {
      setState("error");
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-accent-100 bg-accent-50 p-6">
      <h2 className="text-lg font-bold">
        {existingProjectId ? "Your installation is underway" : "Ready when you are"}
      </h2>
      <p className="mt-2 text-sm text-ink-700">
        Everything from here happens on one timeline — you can see every step, every projected
        date, and book the real dates yourself:
      </p>
      <ol className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-sm font-medium text-ink-700">
        {PROJECT_STAGES.map((stage, i) => (
          <li key={stage}>
            {STAGE_INFO[stage].label}
            {i < PROJECT_STAGES.length - 1 && <span className="text-ink-300"> →</span>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-500">
        Nothing is payable until you book your {gbp(SITE_VISIT.feeGbp)} site visit — the one-hour
        session that greenlights installation (and the fee comes off your price).
      </p>
      <button
        type="button"
        onClick={existingProjectId ? () => router.push(`/p/${existingProjectId}`) : start}
        disabled={state === "sending"}
        className="mt-5 block w-full rounded-full bg-accent-600 px-5 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:opacity-40"
      >
        {state === "sending"
          ? "Setting up your timeline…"
          : existingProjectId
            ? "Open my installation timeline"
            : "Start my installation plan"}
      </button>
      {state === "error" && (
        <p className="mt-2 text-sm text-red-600">That didn&apos;t work — try again in a moment.</p>
      )}
      {!quoteId && (
        <p className="mt-2 text-center text-xs text-ink-300">
          Demo mode — you&apos;ll get a playable example timeline.
        </p>
      )}
    </section>
  );
}
