"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_STAGES, STAGE_INFO } from "@aircon/domain";

/**
 * "Start my installation plan" on a saved quote (/q/[id]): turns the quote
 * into a v2 project (POST /api/projects, idempotent) and gets the customer
 * onto their private project page. Signed in already: straight there.
 * Otherwise we email them a sign-in link to the address on the quote and
 * say so here, rather than dropping them on a sign-in screen.
 */
export function StartProjectPanel({ quoteId, existingProjectId }: { quoteId: string | null; existingProjectId?: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<
    { status: "idle" } | { status: "sending" } | { status: "error" } | { status: "emailed"; id: string; devLink?: string }
  >({ status: "idle" });

  async function start() {
    if (!quoteId) return router.push("/p/demo");
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      const data = (await res.json().catch(() => null)) as { demo?: boolean; id?: string; canOpen?: boolean; linkSent?: boolean; devLink?: string } | null;
      if (!res.ok || !data) return setState({ status: "error" });
      if (data.demo || !data.id) return router.push("/p/demo");
      if (data.canOpen || !data.linkSent) return router.push(`/p/${data.id}`);
      setState({ status: "emailed", id: data.id, ...(data.devLink ? { devLink: data.devLink } : {}) });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-accent-100 bg-accent-50 p-6">
      <h2 className="text-lg font-bold text-ink-900">{existingProjectId ? "Your project is under way" : "Ready when you are"}</h2>
      <p className="mt-2 text-sm text-ink-700">Everything from here lives on one private project page, with a clear next step at every stage:</p>
      <ol className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-sm font-medium text-ink-700">
        {PROJECT_STAGES.map((stage, i) => (
          <li key={stage}>
            {STAGE_INFO[stage].label}
            {i < PROJECT_STAGES.length - 1 && <span className="text-ink-500"> →</span>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-ink-700">
        First, you book a home survey: we measure up and turn your price into a real design. Nothing is agreed until you&apos;ve seen your proposal.
      </p>

      {state.status === "emailed" ? (
        <div className="mt-5 space-y-3" role="status" aria-live="polite">
          <div className="rounded-2xl border border-sage-200 bg-white p-4">
            <p className="font-semibold text-ink-900">Check your inbox</p>
            <p className="mt-1 text-sm text-ink-700">
              Your project is set up. We&apos;ve emailed a sign-in link to the address on your quote: one tap and you&apos;re in, no password.
            </p>
          </div>
          {state.devLink && (
            <a
              href={state.devLink}
              className="block w-full rounded-full bg-accent-700 px-5 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-accent-800"
            >
              Development: open the sign-in link
            </a>
          )}
          <button
            type="button"
            onClick={() => router.push(`/p/${state.id}`)}
            className="min-h-11 text-sm font-semibold text-accent-700 underline underline-offset-2"
          >
            Go to my project page
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={existingProjectId ? () => router.push(`/p/${existingProjectId}`) : start}
            disabled={state.status === "sending"}
            aria-busy={state.status === "sending" || undefined}
            className="mt-5 block min-h-12 w-full rounded-full bg-accent-700 px-5 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-accent-800 disabled:opacity-50"
          >
            {state.status === "sending" ? "Setting up your project…" : existingProjectId ? "Open my project" : "Start my installation plan"}
          </button>
          <div aria-live="polite">
            {state.status === "error" && <p className="mt-2 text-sm font-medium text-red-700">That didn&apos;t work. Please try again in a moment.</p>}
          </div>
          {!quoteId && <p className="mt-2 text-center text-xs text-ink-500">Demo mode: you&apos;ll get a playable example project.</p>}
        </>
      )}
    </section>
  );
}
