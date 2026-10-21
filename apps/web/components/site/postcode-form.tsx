"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

/**
 * The postcode capture on marketing pages. Client-side navigation instead of
 * a plain form action: /quote is prefetched, so the funnel opens instantly.
 * The native form still works before hydration (GET /quote?postcode=…).
 */
export function PostcodeForm() {
  const router = useRouter();
  const id = useId();
  const [postcode, setPostcode] = useState("");

  useEffect(() => {
    router.prefetch("/quote");
  }, [router]);

  return (
    <form
      action="/quote"
      method="get"
      className="mt-8 flex max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = postcode.trim();
        if (!clean) return;
        router.push(`/quote?postcode=${encodeURIComponent(clean)}`);
      }}
    >
      <label htmlFor={id} className="sr-only">
        Your postcode
      </label>
      <input
        id={id}
        type="text"
        name="postcode"
        required
        value={postcode}
        onChange={(e) => setPostcode(e.target.value)}
        placeholder="Your postcode"
        autoComplete="postal-code"
        autoCapitalize="characters"
        spellCheck={false}
        className="min-h-13 w-full min-w-0 rounded-l-sm border border-r-0 border-ink-300 bg-white px-4 py-3 text-base uppercase outline-none transition placeholder:normal-case placeholder:text-ink-500 focus:border-ink-900"
      />
      <button
        type="submit"
        className="min-h-13 shrink-0 rounded-r-sm bg-accent-700 px-6 py-3 font-semibold text-white transition hover:bg-accent-800"
      >
        Get my price
      </button>
    </form>
  );
}
