"use client";

import { useEffect } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics-client";

/**
 * Route-level error boundary: on-brand, apologetic, recoverable. Also logs
 * the failure to analytics so crashes are visible in /ops/analytics rather
 * than only in the browser consoles of confused customers.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    track("client_error", { message: error.message?.slice(0, 300), digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-cream px-4 text-center">
      <p className="text-6xl font-display">Well.</p>
      <h1 className="mt-3 text-2xl font-display">Something broke, and it wasn&apos;t the heat</h1>
      <p className="mt-2 max-w-md text-ink-500">
        That&apos;s on us. Trying again usually fixes it; if it keeps
        happening, we&apos;d genuinely like to know.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
        >
          Try again
        </button>
        <Link href="/" className="text-sm font-semibold text-accent-700 hover:underline">
          Back to the homepage →
        </Link>
      </div>
    </div>
  );
}
