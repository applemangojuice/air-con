"use client";

import { useActionState } from "react";
import type { StopState } from "./actions";

/** One button: stop follow-up emails. */
export function StopForm({ action }: { action: (prev: StopState, form: FormData) => Promise<StopState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.done) {
    return (
      <p role="status" className="rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-900">
        Done: no more follow-up emails. We&apos;ll still contact you about any open work, problem or payment. Changed your mind? Turn them back on from your project page.
      </p>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      <button type="submit" disabled={pending} className="min-h-12 rounded-sm bg-ink-900 px-6 text-base font-semibold text-white disabled:opacity-50">
        {pending ? "Stopping…" : "Stop follow-up emails"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
