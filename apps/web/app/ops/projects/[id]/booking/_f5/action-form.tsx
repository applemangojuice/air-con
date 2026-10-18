"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { BlockerList, Button, type ButtonSize, type ButtonVariant } from "@/components/kit";
import type { ActionState } from "./action-state";

/**
 * One form, one server action, every state said out loud: busy while it
 * runs, the result (or the blockers that stopped it) in an aria-live region,
 * and a calm message when the phone has no signal, never a crash. Typed
 * values survive an error (the form only resets after a success, and only
 * when asked). Each render carries a one-off `requestId`, so a double tap
 * or a retry after a dropped connection can't do the same thing twice.
 */

const OFFLINE: ActionState = {
  error: "Couldn't reach the server. Check your signal and try again: nothing was saved twice.",
};

export function ActionForm({
  action,
  submitLabel,
  busyLabel = "Saving…",
  variant = "primary",
  size = "md",
  block = false,
  resetOnSuccess = false,
  refresh = true,
  className = "",
  submitClassName = "",
  children,
  confirm,
  disabled = false,
  footer,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: ReactNode;
  busyLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  resetOnSuccess?: boolean;
  /** Re-render the page from the server after a success (default). */
  refresh?: boolean;
  className?: string;
  submitClassName?: string;
  children?: ReactNode;
  /** Ask before running (destructive or customer-facing steps). */
  confirm?: string;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // Minted after hydration (a random value in the server HTML wouldn't match the browser's).
  const [requestId, setRequestId] = useState("");
  useEffect(() => setRequestId(newId()), []);
  const [state, run, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    try {
      return await action(prev, form);
    } catch {
      return OFFLINE;
    }
  }, {});

  useEffect(() => {
    if (!state.ok) return;
    setRequestId(newId());
    if (resetOnSuccess) formRef.current?.reset();
    if (refresh) router.refresh();
  }, [state, refresh, resetOnSuccess, router]);

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <input type="hidden" name="requestId" value={requestId} />
      {children}
      <div className={`flex flex-wrap items-center gap-3 ${children ? "mt-4" : ""}`.trim()}>
        <Button type="submit" variant={variant} size={size} block={block} busy={pending} busyLabel={busyLabel} disabled={disabled || !requestId} className={submitClassName}>
          {submitLabel}
        </Button>
        {footer}
      </div>
      <div aria-live="polite" className="empty:hidden">
        {!pending && state.error && (
          <p role="alert" className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {state.error}
          </p>
        )}
        {!pending && state.blockers && state.blockers.length > 0 && (
          <div className="mt-3">
            <BlockerList blockers={state.blockers} />
          </div>
        )}
        {!pending && state.ok && state.message && (
          <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{state.message}</p>
        )}
        {!pending && state.warning && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">{state.warning}</p>
        )}
      </div>
    </form>
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
