"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { fetchKnownAddresses, type KnownAddress } from "@/lib/address-lookup";
import { isValidUkPostcode, normalisePostcode } from "@/lib/format";

/**
 * The address capture on marketing pages: a postcode, and the addresses we
 * know there (EPC records in the Property Intelligence Engine, plus the
 * licensed list when configured) appear as a dropdown to pick from. Press
 * Start and the price is the next thing they see. Nothing to type but the
 * postcode. Only when we know no addresses at that postcode does a house
 * number field appear instead.
 *
 * Client-side navigation so the prefetched /quote opens instantly; before
 * hydration the native form still works (GET /quote?postcode=…, which
 * opens the address screen).
 */
export function AddressForm() {
  const router = useRouter();
  const id = useId();
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [known, setKnown] = useState<KnownAddress[]>([]);
  const [lookup, setLookup] = useState<"idle" | "loading" | "done">("idle");
  const [manual, setManual] = useState(false);

  useEffect(() => {
    router.prefetch("/quote");
  }, [router]);

  // Known addresses at this postcode, fetched once it's a valid postcode.
  useEffect(() => {
    setAddress("");
    setManual(false);
    if (!isValidUkPostcode(postcode)) {
      setKnown([]);
      setLookup("idle");
      return;
    }
    const controller = new AbortController();
    setLookup("loading");
    const timer = setTimeout(() => {
      fetchKnownAddresses(normalisePostcode(postcode), controller.signal).then((list) => {
        if (controller.signal.aborted) return;
        setKnown(list);
        setLookup("done");
      });
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [postcode]);

  const valid = isValidUkPostcode(postcode);
  const showPicker = valid && lookup === "done" && known.length > 0 && !manual;
  const showManual = valid && lookup === "done" && (known.length === 0 || manual);
  const ready = valid && address.trim().length > 0;

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
        const picked = known.find((k) => k.line1 === line);
        const params = new URLSearchParams({ postcode: pc, address: line });
        if (picked?.intelId) params.set("intel", picked.intelId);
        router.push(`/quote?${params.toString()}`);
      }}
    >
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
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
            placeholder="Your postcode"
            autoComplete="postal-code"
            autoCapitalize="characters"
            spellCheck={false}
            className="min-h-12 w-full min-w-0 rounded-full border border-line bg-white px-5 py-3 text-base uppercase shadow-sm outline-none transition placeholder:normal-case placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>
        {/* Before an address is picked the button is the postcode's: it opens the address screen. */}
        {!showPicker && !showManual && (
          <button
            type="submit"
            className="min-h-12 shrink-0 rounded-full bg-ink-900 px-5 py-3 font-semibold text-white transition hover:bg-ink-700"
          >
            Start
          </button>
        )}
      </div>

      <div aria-live="polite">
        {valid && lookup === "loading" && <p className="mt-2 text-sm text-ink-500">Finding your street…</p>}

        {showPicker && (
          <div className="mt-2 flex gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-address`} className="sr-only">
                Your address
              </label>
              <select
                id={`${id}-address`}
                name="address"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="min-h-12 w-full min-w-0 appearance-none rounded-full border border-line bg-white px-5 py-3 text-base shadow-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              >
                <option value="" disabled>
                  Choose your address…
                </option>
                {known.map((k) => (
                  <option key={k.line1} value={k.line1}>
                    {k.line1}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={!ready}
              className="min-h-12 shrink-0 rounded-full bg-ink-900 px-5 py-3 font-semibold text-white transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start
            </button>
          </div>
        )}
        {showPicker && (
          <button
            type="button"
            onClick={() => {
              setManual(true);
              setAddress("");
            }}
            className="mt-2 min-h-9 text-sm font-semibold text-accent-700 underline-offset-2 hover:underline"
          >
            My address isn&apos;t listed
          </button>
        )}

        {showManual && (
          <div className="mt-2 flex gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-house`} className="sr-only">
                House number or name
              </label>
              <input
                id={`${id}-house`}
                type="text"
                name="address"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="House number or name"
                autoComplete="address-line1"
                maxLength={120}
                className="min-h-12 w-full min-w-0 rounded-full border border-line bg-white px-5 py-3 text-base shadow-sm outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
              />
            </div>
            <button
              type="submit"
              disabled={!ready}
              className="min-h-12 shrink-0 rounded-full bg-ink-900 px-5 py-3 font-semibold text-white transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
