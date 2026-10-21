"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { BlockerList } from "@/components/kit/blocker-list";
import { Button, type ButtonProps } from "@/components/kit/button";
import { BehindNote, useLandedRefresh } from "@/components/kit/landed-refresh";
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
 * connection. Until the page's script has loaded the submit button stays
 * disabled, so a tap on a slow connection can't fall through to a plain
 * browser submit (which would put the form's contents in the URL).
 *
 * The page refresh after a success is watched (components/kit/landed-refresh.tsx):
 * one that never lands holds the form and offers to load the page afresh,
 * rather than leave it acting on a page that still shows the step undone.
 */

const PendingContext = createContext(false);
const ReadyContext = createContext(false);

export const OFFLINE_ERROR = "We couldn't reach the server, so nothing was saved. Check your signal and try again.";

export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
  confirm,
  onResult,
  quietSuccess = false,
  refreshOnSuccess = true,
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
  /** Re-render the page's server data after a success (off when the form navigates away instead). */
  refreshOnSuccess?: boolean;
  id?: string;
}) {
  const [pending, start] = useTransition();
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  useEffect(() => setReady(true), []);
  const formRef = useRef<HTMLFormElement>(null);
  const landed = useLandedRefresh();

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
        if (refreshOnSuccess) landed.refresh();
      }
    });
  }

  return (
    <PendingContext.Provider value={pending}>
      <ReadyContext.Provider value={ready}>
      <form ref={formRef} id={id} method="post" onSubmit={onSubmit} className={className} aria-busy={pending || undefined}>
        <fieldset disabled={pending || landed.behind} className="m-0 min-w-0 border-0 p-0">
          {children}
        </fieldset>
        <ResultNote result={result} quietSuccess={quietSuccess} />
        <BehindNote show={landed.behind} />
      </form>
      </ReadyContext.Provider>
    </PendingContext.Provider>
  );
}

/** The form's submit button: locks and says so while the action runs. */
export function SubmitButton({ children, busyLabel = "Saving…", disabled, ...rest }: ButtonProps & { busyLabel?: ReactNode }) {
  const pending = useContext(PendingContext);
  const ready = useContext(ReadyContext);
  return (
    <Button type="submit" busy={pending} busyLabel={busyLabel} disabled={disabled || !ready} {...rest}>
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
