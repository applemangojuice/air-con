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
  | { status: "sent"; devLink?: string; devCode?: string; emailLive: boolean }
  | { status: "error"; message: string };

async function requestLink(target: Target): Promise<State> {
  try {
    const res = await fetch("/api/portal/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(target),
      credentials: "same-origin",
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; devLink?: string; devCode?: string; emailLive?: boolean } | null;
    if (res.status === 429) return { status: "error", message: "That's a few requests in a row. Give it a few minutes and try again." };
    if (!res.ok || !data?.ok) return { status: "error", message: data?.error ?? "We couldn't send a link just now. Please try again." };
    return {
      status: "sent",
      emailLive: data.emailLive ?? false,
      ...(data.devLink ? { devLink: data.devLink, ...(data.devCode ? { devCode: data.devCode } : {}) } : {}),
    };
  } catch {
    return { status: "error", message: "We couldn't reach our server. Check your signal and try again." };
  }
}

/**
 * The 6-digit code from the email (§K45): for signing in on this browser
 * when the link opened in another (an email app's own browser, or the Home
 * Screen app). Checked against the same address the link went to; on
 * success the server sets the sign-in and says where to go.
 */
function CodeEntry({ target, devCode }: { target: Target | "ask-email"; devCode?: string }) {
  const [code, setCode] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [state, setState] = useState<{ status: "idle" | "checking" | "done" } | { status: "error"; message: string }>({ status: "idle" });
  const submit = async () => {
    setState({ status: "checking" });
    try {
      const res = await fetch("/auth/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(target === "ask-email" ? { email: typedEmail.trim().toLowerCase() } : target), code }),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; next?: string } | null;
      if (res.ok && data?.ok && data.next) {
        setState({ status: "done" });
        window.location.assign(data.next);
        return;
      }
      setState({ status: "error", message: data?.error ?? "That code didn't work. Please try again, or tap the link in the email." });
    } catch {
      setState({ status: "error", message: "We couldn't reach our server. Check your signal and try again." });
    }
  };
  const busy = state.status === "checking" || state.status === "done";
  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-white p-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {target === "ask-email" && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-900">The email address the code went to</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-h-12 w-full rounded-full border border-line bg-white px-5 py-3 text-base text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block font-semibold text-ink-900">Enter the 6-digit code from the email</span>
        <span className="mb-2 block text-sm text-ink-700">
          If the link opens in a different browser or app, type the code here instead to sign in on this one. It works once, for 15 minutes.
        </span>
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456"
          aria-invalid={state.status === "error" ? true : undefined}
          aria-describedby={state.status === "error" ? "code-error" : undefined}
          className="min-h-12 w-full rounded-full border border-line bg-white px-5 py-3 text-center font-mono text-xl tracking-[0.3em] text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 aria-invalid:border-red-600"
        />
      </label>
      {devCode && (
        <p className="text-xs text-ink-700">
          DEMO: the code that email would carry is <strong className="font-mono">{devCode}</strong>.
        </p>
      )}
      <div aria-live="polite">
        {state.status === "error" && (
          <p id="code-error" role="alert" className="text-sm font-medium text-red-700">
            {state.message}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={busy || code.replace(/[\s-]/g, "").length !== 6 || (target === "ask-email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail.trim()))}
        className={primaryCls()}
      >
        {busy ? "Signing you in…" : "Sign in with the code"}
      </button>
    </form>
  );
}

/** `phone` is null while settings hold only the placeholder number; then `email` is how to reach us. */
type Contact = { phone: string | null; email?: string };

function Sent({ state, again, phone, email, byEmail, target }: { state: Extract<State, { status: "sent" }>; again: () => void; byEmail?: boolean; target: Target } & Contact) {
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
            It works once and lasts an hour, and the email has a code too. Check your spam folder if it hasn&apos;t arrived in a few minutes.
          </p>
          {!state.emailLive && (
            <p className="mt-2 text-sm text-ink-700">
              Email sending isn&apos;t switched on yet, so please {phone ? "call us" : email ? `email us at ${email}` : "get in touch"} and we&apos;ll help you in.
            </p>
          )}
        </div>
      )}
      {(state.devLink || state.emailLive) && <CodeEntry target={target} {...(state.devCode ? { devCode: state.devCode } : {})} />}
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
  if (state.status === "sent") return <Sent state={state} again={() => void send()} phone={phone} target={target} {...(email ? { email } : {})} />;
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
  if (state.status === "sent") {
    return <Sent state={state} again={() => void send()} phone={phone} target={{ email: email.trim().toLowerCase() }} {...(supportEmail ? { email: supportEmail } : {})} byEmail />;
  }
  return (
    <div className="space-y-4">
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
      <details className="rounded-2xl border border-line bg-surface p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink-900">Already have a code from a sign-in email?</summary>
        <div className="mt-3">
          <CodeEntry target="ask-email" />
        </div>
      </details>
    </div>
  );
}
