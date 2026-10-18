"use client";

import Link from "next/link";

/** Field errors: say what happened in plain words, and offer the way back. Nothing captured is lost: it's on the phone. */
export default function FieldError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-3xl border border-red-200 bg-white p-6">
      <h1 className="font-display text-2xl text-ink-900">That page didn&apos;t load</h1>
      <p className="mt-2 text-base text-ink-700">
        Usually it&apos;s the signal. Anything you captured is safe on this phone and will sync when you&apos;re back online.
      </p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={reset} className="min-h-12 rounded-full bg-accent-600 px-6 font-semibold text-white">
          Try again
        </button>
        <Link href="/field" className="flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-6 font-semibold text-ink-900">
          Back to Today
        </Link>
      </div>
    </div>
  );
}
