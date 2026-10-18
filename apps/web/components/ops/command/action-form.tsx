"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { BlockerList } from "@/components/kit/blocker-list";
import { Button, type ButtonProps } from "@/components/kit/button";
import type { ActionResult } from "./types";

/**
 * A form that runs a server action and says what happened, built for patchy
 * signal: nothing is cleared until the server says it's saved, a dropped
 * connection is reported as "not saved" (never as success), the controls
 * lock while it's in flight so a nervous double tap can't send it twice,
 * and gate refusals list their blockers right under the form.
 *
 * Not React's form `action` prop on purpose: that resets the form however
 * the action ended, which would throw away what someone typed on a bad
 * connection.
 */

const PendingContext = createContext(false);

export const OFFLINE_ERROR = "We couldn't reach the server, so nothing was saved. Check your signal and try again.";

export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
  confirm,
  onResult,
  quietSuccess = false,
  id,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Ask before sending (irreversible steps). */
  confirm?: string;
  onResult?: (result: ActionResult) => void;
  /** Don't show the success line (the page change says it). */
  quietSuccess?: boolean;
  id?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (confirm && !window.confirm(confirm)) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) data.set(submitter.name, submitter.value);
    start(async () => {
      let r: ActionResult;
      try {
        r = await action(data);
      } catch {
        r = { ok: false, error: OFFLINE_ERROR };
      }
      setResult(r);
      onResult?.(r);
      if (r.ok) {
        if (resetOnSuccess) formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <PendingContext.Provider value={pending}>
      <form ref={formRef} id={id} onSubmit={onSubmit} className={className} aria-busy={pending || undefined}>
        <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
          {children}
        </fieldset>
        <ResultNote result={result} quietSuccess={quietSuccess} />
      </form>
    </PendingContext.Provider>
  );
}

/** The form's submit button: locks and says so while the action runs. */
export function SubmitButton({ children, busyLabel = "Saving…", ...rest }: ButtonProps & { busyLabel?: ReactNode }) {
  const pending = useContext(PendingContext);
  return (
    <Button type="submit" busy={pending} busyLabel={busyLabel} {...rest}>
      {children}
    </Button>
  );
}

export function useFormPending(): boolean {
  return useContext(PendingContext);
}

/** The outcome, announced to screen readers. */
export function ResultNote({ result, quietSuccess = false }: { result: ActionResult | null; quietSuccess?: boolean }) {
  return (
    <div aria-live="polite">
      {result && !result.ok && (
        <div className="mt-3 space-y-3">
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {result.error ?? "That didn't work."}
          </p>
          {result.blockers && result.blockers.length > 0 && <BlockerList blockers={result.blockers} showGate />}
        </div>
      )}
      {result?.ok && !quietSuccess && (
        <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">
          {result.message ?? "Saved."}
          {result.href && (
            <>
              {" "}
              <a href={result.href} className="font-semibold underline">
                Open it
              </a>
            </>
          )}
          {result.detail && <span className="mt-1 block break-all text-xs font-normal text-emerald-900">{result.detail}</span>}
        </p>
      )}
    </div>
  );
}
