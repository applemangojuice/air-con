"use client";

import { useState } from "react";
import { track } from "@/lib/analytics-client";
import { secondaryBtn } from "./ui";

/**
 * The referral seed: every saved quote is shareable, and neighbours are the
 * cheapest acquisition channel a street-by-street business has. Native share
 * sheet on mobile, copy-to-clipboard on desktop. The page shows the address,
 * so the button says so before anyone shares it.
 */
export function ShareQuoteButton({ quoteId }: { quoteId: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const url = `${window.location.origin}/q/${quoteId}?utm_source=share&utm_medium=referral`;
    const payload = {
      title: "My heating and cooling price",
      text: "I got a price for heating and cooling our home in about two minutes, no salesperson. Worth a look for yours:",
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
      return; // the share sheet was dismissed
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div>
      <button type="button" onClick={share} className={`${secondaryBtn} w-full text-sm`}>
        {status === "copied" ? "Link copied" : "Share my price"}
      </button>
      <p aria-live="polite" className="mt-1 text-center text-xs text-ink-500">
        {status === "failed" ? "Couldn't copy: use your browser's share button instead." : "Anyone with the link sees this page, address included."}
      </p>
    </div>
  );
}
