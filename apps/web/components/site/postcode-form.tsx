"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The homepage postcode capture. Client-side navigation instead of a plain
 * form action: /quote is already prefetched (the page links to it), so the
 * funnel opens instantly rather than doing a full document load — the first
 * impression of "this thing is fast".
 */
export function PostcodeForm() {
  const router = useRouter();
  const [postcode, setPostcode] = useState("");

  // Belt and braces: make sure the funnel bundle is warm before they submit.
  useEffect(() => {
    router.prefetch("/quote");
  }, [router]);

  return (
    <form
      className="mt-8 flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = postcode.trim();
        if (!clean) return;
        router.push(`/quote?postcode=${encodeURIComponent(clean)}`);
      }}
    >
      <input
        type="text"
        name="postcode"
        required
        value={postcode}
        onChange={(e) => setPostcode(e.target.value)}
        placeholder="Your postcode, e.g. SW1A 1AA"
        autoComplete="postal-code"
        className="w-full rounded-full border border-line bg-white px-5 py-3 text-base shadow-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-ink-900 px-5 py-3 font-semibold text-white transition hover:bg-ink-700"
      >
        Start
      </button>
    </form>
  );
}
