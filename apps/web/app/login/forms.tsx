"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { breakGlassSignIn, requestMagicLink, type BreakGlassState, type LinkState } from "./actions";

const inputCls =
  "w-full rounded-full border border-line bg-white px-5 py-3 text-base text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

const primaryCls =
  "inline-flex min-h-12 w-full items-center justify-center rounded-full bg-accent-600 px-6 py-3 font-semibold text-white transition hover:bg-accent-700 disabled:cursor-wait disabled:opacity-70";

function SubmitButton({ children, pending: pendingLabel }: { children: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={primaryCls} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
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
              works once and lasts 20 minutes.
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
