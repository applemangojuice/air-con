"use client";

import { getFieldOutbox } from "@/lib/field-outbox";
import { useOutboxState } from "./use-outbox";

/**
 * Sign out, from the Me page. Anything still waiting on this phone stays
 * here under the name of whoever captured it and sends only when they sign
 * in again (never as the next person to sign in), so with captures waiting
 * it offers Sync now first and asks before signing out.
 */
export function SignOut() {
  const state = useOutboxState();
  const waiting = state.items.length;
  return (
    <>
      {waiting > 0 && (
        <div role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
          <p className="font-semibold">
            {waiting === 1 ? "1 capture is" : `${waiting} captures are`} still waiting on this phone.
          </p>
          <p className="mt-1 text-sm">Sync them before you sign out. If you can&apos;t, they wait here and send next time you sign in on this phone.</p>
          {state.online && (
            <button
              type="button"
              disabled={state.syncing}
              onClick={() => void getFieldOutbox().flush(true)}
              className="mt-3 min-h-12 w-full rounded-full bg-accent-700 px-6 font-semibold text-white disabled:opacity-40"
            >
              {state.syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      )}
      <form
        action="/auth/logout"
        method="post"
        className="mt-4"
        onSubmit={(e) => {
          const left = getFieldOutbox().state().items.length;
          if (left > 0 && !window.confirm(`${left === 1 ? "1 capture hasn't" : `${left} captures haven't`} reached the server yet. They'll wait on this phone for you, and send next time you sign in here. Sign out anyway?`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="next" value="/login?signedOut=1" />
        <button type="submit" className="min-h-12 w-full rounded-full border border-line bg-white px-6 font-semibold text-ink-900 hover:bg-surface">
          Sign out
        </button>
      </form>
    </>
  );
}
