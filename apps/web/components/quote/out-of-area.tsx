"use client";

import Link from "next/link";
import { useState } from "react";
import { areaLaunchConsentText, listOutcodes } from "@/components/site/claims";
import { track } from "@/lib/analytics-client";
import { TextField, inputCls, primaryBtn } from "./ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "We're not in {district} yet": the honest answer for a postcode outside the
 * service area, with an optional "tell me when you are". That stores the lead
 * as declined (reason: out of area) with the exact words they agreed to, and
 * nothing else happens until we get there. Never fake coverage.
 */
export function OutOfArea({
  outcode,
  district,
  serviceArea,
  email: initialEmail,
  postcode,
  addressLine,
  draftId,
}: {
  outcode: string;
  district?: string;
  serviceArea: string[];
  email: string;
  postcode: string;
  addressLine: string;
  draftId?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const place = district ? `${district} (${outcode})` : outcode;

  async function submit() {
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/quotes/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          postcode,
          addressLine: addressLine.trim() || undefined,
          district,
          draftId,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
      track("out_of_area_waitlist", { outcode });
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <p className="font-semibold text-ink-900">Sorry, we&apos;re not in {place} yet.</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
        We&apos;re starting small, in a handful of London postcodes, so every home gets our full attention. Right now
        we install in {listOutcodes(serviceArea)}.
      </p>

      {state === "done" ? (
        <p role="status" className="mt-4 rounded-xl bg-sage-50 px-4 py-3 text-sm font-medium text-sage-900">
          Thanks. We&apos;ll email {email.trim()} once, when we start installing in {outcode}.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <TextField
            label="Want a heads-up when we get there?"
            hint={areaLaunchConsentText(outcode)}
            error={error}
          >
            {(c) => (
              <input
                {...c}
                className={inputCls}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                data-no-submit=""
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </TextField>
          <button
            type="button"
            onClick={submit}
            disabled={state === "sending"}
            aria-busy={state === "sending" || undefined}
            className={`${primaryBtn} w-full`}
          >
            {state === "sending" ? "Saving…" : "Tell me when you're here"}
          </button>
          <p aria-live="polite" className="text-sm">
            {state === "error" && (
              <span className="font-medium text-red-700">That didn&apos;t go through. Check your signal and try again.</span>
            )}
          </p>
        </div>
      )}

      <p className="mt-3 text-sm text-ink-700">
        Curious about cost anyway?{" "}
        <Link href="/guides/air-conditioning-cost-uk" className="font-semibold text-accent-700 underline-offset-2 hover:underline">
          See typical prices
        </Link>
        . Typed the postcode wrong? Just change it above.
      </p>
    </div>
  );
}
