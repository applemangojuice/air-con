"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { fetchKnownAddresses, type KnownAddress } from "@/lib/address-lookup";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";

/**
 * The address capture on marketing pages: postcode and house, then Start,
 * and the price is the next thing they see. Once the postcode is valid we
 * fetch the addresses we know there and offer them as suggestions under the
 * house field (a native datalist: tap to pick, or just type "12" and we
 * match it to the street on the next page). With no address data at all the
 * house number or name on its own is enough.
 *
 * Client-side navigation so the prefetched /quote opens instantly; before
 * hydration the native form still works (GET /quote?postcode=…&address=…).
 */
export function AddressForm() {
  const router = useRouter();
  const id = useId();
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [known, setKnown] = useState<KnownAddress[]>([]);

  useEffect(() => {
    router.prefetch("/quote");
  }, [router]);

  // Known addresses at this postcode, fetched once it's a valid postcode.
  useEffect(() => {
    if (!isValidUkPostcode(postcode)) {
      setKnown([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchKnownAddresses(normalisePostcode(postcode), controller.signal).then((list) => {
        if (!controller.signal.aborted) setKnown(list);
      });
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [postcode]);

  const ready = isValidUkPostcode(postcode) && address.trim().length > 0;

  return (
    <form
      action="/quote"
      method="get"
      className="mt-8 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const pc = normalisePostcode(postcode);
        const line = address.trim();
        const picked = known.find((k) => k.line1.toLowerCase() === line.toLowerCase());
        const params = new URLSearchParams({ postcode: pc, address: line });
        if (picked?.intelId) params.set("intel", picked.intelId);
        router.push(`/quote?${params.toString()}`);
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-40 sm:shrink-0">
          <label htmlFor={`${id}-postcode`} className="sr-only">
            Your postcode
          </label>
          <input
            id={`${id}-postcode`}
            type="text"
            name="postcode"
            required
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            onBlur={(e) => setPostcode(normalisePostcode(e.target.value))}
            placeholder="Postcode"
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            className="min-h-12 w-full min-w-0 rounded-full border border-line bg-white px-5 py-3 text-base uppercase shadow-sm outline-none transition placeholder:normal-case placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-address`} className="sr-only">
              House number or name
            </label>
            <input
              id={`${id}-address`}
              type="text"
              name="address"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House number or name"
              autoComplete="address-line1"
              list={known.length > 0 ? `${id}-known` : undefined}
              maxLength={120}
              className="min-h-12 w-full min-w-0 rounded-full border border-line bg-white px-5 py-3 text-base shadow-sm outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
            {known.length > 0 && (
              <datalist id={`${id}-known`}>
                {known.map((k) => (
                  <option key={k.line1} value={k.line1} />
                ))}
              </datalist>
            )}
          </div>
          <button
            type="submit"
            className="min-h-12 shrink-0 rounded-full bg-ink-900 px-5 py-3 font-semibold text-white transition hover:bg-ink-700"
          >
            Start
          </button>
        </div>
      </div>
    </form>
  );
}
