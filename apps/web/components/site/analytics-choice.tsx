"use client";

import { useEffect, useState } from "react";
import { analyticsOptedOut, privacySignalOn, setAnalyticsOptOut } from "@/lib/analytics-client";

/**
 * Say no to usage analytics (or yes again), for this browser: the simple,
 * free way to object that storing an analytics identifier needs. Off means
 * nothing is stored for analytics and no usage events are sent; what was
 * stored is removed straight away. The browser's Global Privacy Control
 * signal counts as off, and this says so rather than offering a switch that
 * wouldn't do anything.
 */
export function AnalyticsChoice() {
  // Unknown until mounted (storage lives in the browser), so nothing flashes the wrong way.
  const [state, setState] = useState<{ off: boolean; signal: boolean } | null>(null);
  useEffect(() => {
    setState({ off: analyticsOptedOut(), signal: privacySignalOn() });
  }, []);

  const choose = (off: boolean) => {
    setAnalyticsOptOut(off);
    setState({ off: analyticsOptedOut(), signal: privacySignalOn() });
  };

  return (
    <div id="analytics" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <p className="font-semibold text-ink-900">Usage analytics in this browser</p>
      <p aria-live="polite" className="mt-1 text-sm text-ink-700">
        {state === null
          ? "Checking…"
          : state.signal
            ? "Off: your browser sends a Global Privacy Control signal, so we store nothing for analytics and send no usage events."
            : state.off
              ? "Off: we store nothing for analytics in this browser and send no usage events."
              : "On: a random identifier is kept in this browser to count visits. Turn it off any time."}
      </p>
      {state !== null && !state.signal && (
        <button
          type="button"
          onClick={() => choose(!state.off)}
          className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 transition hover:border-ink-300 hover:bg-surface"
        >
          {state.off ? "Turn analytics back on" : "Turn analytics off"}
        </button>
      )}
    </div>
  );
}
