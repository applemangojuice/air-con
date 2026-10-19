"use client";

import { useState } from "react";
import { primaryCls } from "./bits";

/**
 * Asking for a sign-in link. The server answers the same way whatever we
 * hold, so the screen does too: it never says whether a project or an
 * address exists, and never shows an address back.
 */

type Target = { projectId: string } | { documentId: string } | { email: string };

type State =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; devLink?: string; emailLive: boolean }
  | { status: "error"; message: string };

async function requestLink(target: Target): Promise<State> {
  try {
    const res = await fetch("/api/portal/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
      credentials: "same-origin",
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; devLink?: string; emailLive?: boolean } | null;
    if (res.status === 429) return { status: "error", message: "That's a few requests in a row. Give it a few minutes and try again." };
    if (!res.ok || !data?.ok) return { status: "error", message: data?.error ?? "We couldn't send a link just now. Please try again." };
    return { status: "sent", emailLive: data.emailLive ?? false, ...(data.devLink ? { devLink: data.devLink } : {}) };
  } catch {
    return { status: "error", message: "We couldn't reach our server. Check your signal and try again." };
  }
}

/** `phone` is null while settings hold only the placeholder number; then `email` is how to reach us. */
type Contact = { phone: string | null; email?: string };

function Sent({ state, again, phone, email, byEmail }: { state: Extract<State, { status: "sent" }>; again: () => void; byEmail?: boolean } & Contact) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      {state.devLink ? (
        <div className="rounded-2xl border border-accent-100 bg-accent-50 p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-accent-700">Email isn&apos;t set up here (DEMO)</p>
          <p className="mt-1 text-sm text-ink-700">Nothing was emailed. Here&apos;s the link it would have sent. It works once.</p>
          <a href={state.devLink} className={`${primaryCls()} mt-3`}>
            Open my sign-in link
          </a>
        </div>
      ) : (
        <div className="rounded-2xl border border-sage-200 bg-sage-50 p-5">
          <p className="font-semibold text-ink-900">Check your inbox</p>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-700">
            {byEmail
              ? "If that address is one we have for a project, a sign-in link is on its way."
              : "If this is your project, we've sent a sign-in link to the email address we have for you."}{" "}
            It works once and lasts an hour. Check your spam folder if it hasn&apos;t arrived in a few minutes.
          </p>
          {!state.emailLive && (
            <p className="mt-2 text-sm text-ink-700">
              Email sending isn&apos;t switched on yet, so please {phone ? "call us" : email ? `email us at ${email}` : "get in touch"} and we&apos;ll help you in.
            </p>
          )}
        </div>
      )}
      <p className="text-sm text-ink-500">
        Not arrived, or it&apos;s an old address?{" "}
        {phone ? (
          <>
            Call us on{" "}
            <a href={`tel:${phone.replace(/\s+/g, "")}`} className="font-semibold text-accent-700 underline underline-offset-2">
              {phone}
            </a>
            .{" "}
          </>
        ) : email ? (
          <>
            Email us at{" "}
            <a href={`mailto:${email}`} className="font-semibold text-accent-700 underline underline-offset-2">
              {email}
            </a>
            .{" "}
          </>
        ) : null}
        <button type="button" onClick={again} className="min-h-11 font-semibold text-accent-700 underline underline-offset-2">
          Send another link
        </button>
      </p>
    </div>
  );
}

/** For a project or document page: one button, the link goes to the address we hold. */
export function LinkRequest({ target, phone, email, label = "Email me a sign-in link" }: { target: Target; label?: string } & Contact) {
  const [state, setState] = useState<State>({ status: "idle" });
  const send = async () => {
    setState({ status: "sending" });
    setState(await requestLink(target));
  };
  if (state.status === "sent") return <Sent state={state} again={() => void send()} phone={phone} {...(email ? { email } : {})} />;
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => void send()} disabled={state.status === "sending"} aria-busy={state.status === "sending" || undefined} className={primaryCls()}>
        {state.status === "sending" ? "Sending…" : label}
      </button>
      <div aria-live="polite">
        {state.status === "error" && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** For /portal: an email box. */
export function EmailSignIn({ phone, email: supportEmail }: Contact) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const send = async () => {
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setState({ status: "error", message: "That doesn't look like an email address." });
      return;
    }
    setState({ status: "sending" });
    setState(await requestLink({ email: clean }));
  };
  if (state.status === "sent") return <Sent state={state} again={() => void send()} phone={phone} {...(supportEmail ? { email: supportEmail } : {})} byEmail />;
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-ink-900">Your email address</span>
        <span className="mb-2 block text-sm text-ink-500">The one you gave us for your quote.</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={state.status === "error" ? true : undefined}
          aria-describedby={state.status === "error" ? "email-error" : undefined}
          placeholder="you@example.com"
          className="min-h-12 w-full rounded-full border border-line bg-white px-5 py-3 text-base text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 aria-invalid:border-red-600"
        />
      </label>
      <div aria-live="polite">
        {state.status === "error" && (
          <p id="email-error" role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}
      </div>
      <button type="submit" disabled={state.status === "sending"} className={primaryCls()}>
        {state.status === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
