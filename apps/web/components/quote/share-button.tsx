"use client";

import { useState } from "react";
import { track } from "@/lib/analytics-client";

/**
 * The referral seed: every saved quote is shareable, and neighbours are the
 * cheapest acquisition channel a street-by-street business has. Native share
 * sheet on mobile, copy-to-clipboard on desktop.
 */
export function ShareQuoteButton({ quoteId }: { quoteId: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/q/${quoteId}?utm_source=share&utm_medium=referral`;
    const payload = {
      title: "My fixed air conditioning price",
      text: "Got a guaranteed price for home air con in two minutes — no salesperson. Worth a look for your place:",
      url,
    };
    const hasNativeShare = typeof navigator.share === "function";
    track("quote_shared", { method: hasNativeShare ? "native" : "clipboard" });
    try {
      if (hasNativeShare) {
        await navigator.share(payload);
        return;
      }
    } catch {
      return; // user dismissed the sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable: nothing sensible to do */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="no-print mt-3 w-full rounded-full border border-line px-5 py-3 text-sm font-semibold text-ink-700 transition hover:bg-surface"
    >
      {copied ? "Link copied ✓" : "Share my quote (neighbours ask anyway)"}
    </button>
  );
}
