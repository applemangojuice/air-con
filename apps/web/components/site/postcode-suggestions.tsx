"use client";

import { useEffect, useState } from "react";
import { isValidUkPostcode } from "@/lib/format";

/** Postcode suggestions while typing, from postcodes.io (free, no key). */
export function usePostcodeSuggestions(partial: string): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const compact = partial.replace(/\s+/g, "");
    if (compact.length < 2 || compact.length > 7 || isValidUkPostcode(partial)) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}/autocomplete?limit=8`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { result: string[] | null };
        setSuggestions(data.result ?? []);
      } catch {
        // Offline or aborted: no suggestions, typing still works.
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [partial]);
  return suggestions;
}

/** The suggestions as a <datalist>; give the postcode input `list={id}` when there are any. */
export function PostcodeSuggestions({ id, suggestions }: { id: string; suggestions: string[] }) {
  return (
    <datalist id={id}>
      {suggestions.map((p) => (
        <option key={p} value={p} />
      ))}
    </datalist>
  );
}
