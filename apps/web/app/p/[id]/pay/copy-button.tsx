"use client";

import { useState } from "react";

/** Copy one bank detail, with the result said out loud. Falls back quietly where the clipboard isn't allowed. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2500);
      }}
      className="inline-flex min-h-11 min-w-16 items-center justify-center rounded-full border border-line bg-white px-3 text-sm font-semibold text-ink-900 transition hover:bg-surface"
      aria-label={`Copy ${label}`}
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy"}</span>
    </button>
  );
}
