"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { breakGlassSignIn, requestMagicLink, signInWithCode, type BreakGlassState, type CodeState, type LinkState } from "./actions";

const inputCls =
  "w-full rounded-full border border-line bg-white px-5 py-3 text-base text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

const primaryCls =
  "inline-flex min-h-12 w-full items-center justify-center rounded-full bg-accent-700 px-6 py-3 font-semibold text-white transition hover:bg-accent-800 disabled:cursor-wait disabled:opacity-70";

function SubmitButton({ children, pending: pendingLabel }: { children: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={primaryCls} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/**
 * The code from the email (§K45), for signing in on this browser when the
 * link opened somewhere else (an email app's own browser, or this is the Home
 * Screen app with its own sign-in).
 */
function CodeForm({ email, next, devCode }: { email?: string; next: string; devCode?: string }) {
  const [state, action] = useActionState<CodeState, FormData>(signInWithCode, { status: "idle" });
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-line bg-white p-5" aria-labelledby="code-heading">
      {email ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-900">Work email the code went to</span>
          <input type="email" name="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" className={inputCls} />
        </label>
      )}
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span id="code-heading" className="mb-1 block font-semibold text-ink-900">
          Enter the 6-digit code from the email
        </span>
        <span className="mb-2 block text-sm text-ink-700">
          To sign in on this browser (or this Home Screen app) when the link opens somewhere else. It works once, for 15
          minutes.
        </span>
        <input
          type="text"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          placeholder="123 456"
          aria-invalid={state.status === "error" ? true : undefined}
          className={`${inputCls} text-center font-mono text-xl tracking-[0.3em]`}
        />
      </label>
      {devCode && (
        <p className="text-xs text-ink-700">
          Dev / demo: the code that email would carry is <strong className="font-mono">{devCode}</strong>.
        </p>
      )}
      {state.status === "error" && (
        <p className="text-sm font-medium text-red-700" role="alert">
          {state.message}
        </p>
      )}
      <SubmitButton pending="Checking…">Sign in with the code</SubmitButton>
    </form>
  );
}

/** Email in, sign-in link out. On a dev or demo box without email, the link shows here. */
export function MagicLinkForm({ next }: { next: string }) {
  const [state, action] = useActionState<LinkState, FormData>(requestMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        {state.devLink ? (
          <div className="rounded-2xl border border-accent-100 bg-accent-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-accent-700">Dev / demo: email isn&apos;t set up</p>
            <p className="mt-1 text-sm text-ink-700">
              Nothing was emailed. Here&apos;s the link it would have sent to <strong>{state.email}</strong>. It
              works once and lasts 20 minutes.
            </p>
            <a href={state.devLink} className={`${primaryCls} mt-3`}>
              Open my sign-in link
            </a>
          </div>
        ) : state.emailLive ? (
          <div className="rounded-2xl border border-sage-200 bg-sage-50 p-5">
            <p className="font-semibold text-ink-900">Check your inbox</p>
            <p className="mt-1 text-sm text-ink-700">
              If <strong>{state.email}</strong> belongs to someone on the team, a sign-in link is on its way. It
              works once and lasts 20 minutes. The email has a code too, for signing in here instead.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="font-semibold text-ink-900">Email isn&apos;t set up yet</p>
            <p className="mt-1 text-sm text-ink-700">
              This deployment can&apos;t send sign-in links, so nothing was sent. An admin can use break-glass sign-in
              until email is configured.
            </p>
          </div>
        )}
        {(state.devLink || state.emailLive) && state.email && <CodeForm email={state.email} next={next} {...(state.devCode ? { devCode: state.devCode } : {})} />}
        <form action={action}>
          <input type="hidden" name="email" value={state.email ?? ""} />
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="text-sm font-semibold text-accent-700 underline underline-offset-2">
            Send it again
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink-900">Work email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email}
            placeholder="you@example.com"
            className={inputCls}
          />
        </label>
        {state.status === "error" && (
          <p className="text-sm font-medium text-red-700" role="alert">
            {state.message}
          </p>
        )}
        <SubmitButton pending="Sending…">Email me a sign-in link</SubmitButton>
      </form>
      <details className="rounded-2xl border border-line bg-surface p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink-900">Already have a code from a sign-in email?</summary>
        <div className="mt-3">
          <CodeForm next={next} />
        </div>
      </details>
    </div>
  );
}

/** Admin email plus OPS_PASSWORD, for when email is down. */
export function BreakGlassForm({ next }: { next: string }) {
  const [state, action] = useActionState<BreakGlassState, FormData>(breakGlassSignIn, { status: "idle" });
  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-ink-900">Admin email</span>
        <input type="email" name="email" required autoComplete="username" className={inputCls} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-ink-900">Ops password</span>
        <input type="password" name="password" required autoComplete="current-password" className={inputCls} />
      </label>
      {state.status === "error" && (
        <p className="text-sm font-medium text-red-700" role="alert">
          {state.message}
        </p>
      )}
      <SubmitButton pending="Checking…">Sign in</SubmitButton>
    </form>
  );
}
