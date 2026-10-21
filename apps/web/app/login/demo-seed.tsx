"use client";

import { useState } from "react";

/**
 * "Load demo pilots" (development and demo deployments only; the login page
 * decides when to show it, the route decides whether to allow it). Deletes
 * and rebuilds the five DEMO homes, then points at "Try as… Admin".
 */

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; projects: { id: string; label: string; stage: string }[] }
  | { status: "error"; message: string };

export function DemoSeedButton() {
  const [state, setState] = useState<State>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/seed", {
        method: "POST",
        headers: { "x-dih-seed": "login" },
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        projects?: { id: string; label: string; stage: string }[];
      };
      if (!res.ok) {
        setState({ status: "error", message: data.error ?? "Demo pilots aren't available here." });
        return;
      }
      setState({ status: "done", projects: data.projects ?? [] });
    } catch {
      setState({ status: "error", message: "No connection. Try again." });
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <p className="text-sm text-ink-700">
        Five fictional DEMO homes at different stages: a survey booked, a proposal out, one ready to install, one
        needing a design review, and one finished. Loading them replaces any earlier DEMO pilots; nothing else is
        touched.
      </p>
      <button
        type="button"
        onClick={load}
        disabled={state.status === "loading"}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full border border-ink-900 bg-white px-6 py-3 font-semibold text-ink-900 transition hover:bg-surface disabled:cursor-wait disabled:opacity-70"
      >
        {state.status === "loading" ? "Loading demo pilots…" : state.status === "done" ? "Reload demo pilots" : "Load demo pilots"}
      </button>
      <div aria-live="polite">
        {state.status === "done" && (
          <div className="mt-3 rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm text-ink-900" role="status">
            <p className="font-semibold">Loaded {state.projects.length} DEMO pilots.</p>
            <ul className="mt-1.5 space-y-0.5 text-ink-700">
              {state.projects.map((p) => (
                <li key={p.id}>
                  {p.label} <span className="text-ink-500">({p.stage})</span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Now pick <strong>Try as… Admin</strong> above to explore them (or Technical lead, Installer, Subcontractor).
            </p>
          </div>
        )}
        {state.status === "error" && (
          <p className="mt-3 text-sm font-medium text-red-700" role="alert">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
