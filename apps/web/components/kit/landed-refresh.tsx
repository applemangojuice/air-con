"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * router.refresh() that knows whether it landed. A form shows its own
 * result from the action's answer; the refresh after it brings the rest of
 * the page up to date. On Next 15.5 that in-place refresh can stall for good
 * (components/field/server-answer.ts has the story), leaving the page as it
 * was before the save: the form says "Payment recorded" over a balance that
 * still shows it owed, and a second press would record it twice. So when
 * the refresh hasn't landed after `behindMs`, `behind` says so: the form
 * holds its button and BehindNote offers to load the page afresh.
 */
export function useLandedRefresh(behindMs = 12_000): { refresh: () => void; behind: boolean } {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [behind, setBehind] = useState(false);
  useEffect(() => {
    if (!pending) {
      setBehind(false);
      return;
    }
    const t = window.setTimeout(() => setBehind(true), behindMs);
    return () => window.clearTimeout(t);
  }, [pending, behindMs]);
  const refresh = useCallback(() => start(() => router.refresh()), [router]);
  return { refresh, behind };
}

/** Said under a form whose save worked but whose page hasn't caught up with it. */
export function BehindNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      <span>Saved, but this page hasn&apos;t caught up with it yet, so it may show things as they were.</span>
      <button type="button" onClick={() => window.location.reload()} className="min-h-10 rounded-full bg-ink-900 px-4 font-semibold text-white">
        Show the latest
      </button>
    </p>
  );
}
