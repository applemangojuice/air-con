"use client";

import { useState } from "react";
import { badgeState, getFieldOutbox } from "@/lib/field-outbox";
import { Sheet, SlotPortal } from "./sheet";
import { useOutboxState } from "./use-outbox";

/**
 * The header's sync badge (#field-sync-badge): "All synced", "3 waiting to
 * sync", "Offline · 3 waiting", "1 needs attention". Tapping it lists what's
 * on the phone, with Retry and Discard for anything the server refused.
 */

const TONE = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  waiting: "border-amber-200 bg-amber-50 text-amber-900",
  offline: "border-ink-300 bg-surface text-ink-900",
  attention: "border-red-200 bg-red-50 text-red-800",
} as const;

const DOT = { ok: "bg-emerald-600", waiting: "bg-amber-500", offline: "bg-ink-500", attention: "bg-red-600" } as const;

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function SyncBadge() {
  const state = useOutboxState();
  const [open, setOpen] = useState(false);
  const badge = badgeState({ online: state.online, items: state.items, storageOk: state.durable });
  const outbox = typeof window === "undefined" ? null : getFieldOutbox();
  return (
    <SlotPortal slot="field-sync-badge">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${TONE[badge.tone]}`}
        aria-label={`Sync status: ${badge.text}. Open details.`}
      >
        <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[badge.tone]} ${state.syncing ? "animate-pulse" : ""}`} />
        <span className="max-w-[9.5rem] truncate">{state.syncing && badge.waiting ? "Syncing…" : badge.text}</span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="On this phone"
        description={
          state.durable
            ? "Captures are kept here until the server confirms them, even if the page is closed."
            : "This browser won't keep captures if the page closes (private browsing or storage blocked). Keep this page open until everything has synced."
        }
        footer={
          state.online ? (
            <button
              type="button"
              disabled={state.items.length === 0 || state.syncing}
              onClick={() => void outbox?.flush(true)}
              className="min-h-12 w-full rounded-full bg-accent-700 px-6 font-semibold text-white disabled:opacity-40"
            >
              {state.syncing ? "Syncing…" : state.items.length ? "Sync now" : "Nothing to sync"}
            </button>
          ) : (
            <p className="rounded-2xl bg-surface px-4 py-3 text-center text-base font-semibold text-ink-900">Offline: everything here syncs when you&apos;re back in signal.</p>
          )
        }
      >
        <p aria-live="polite" className="mb-4 text-sm text-ink-700">
          {state.online ? "Online." : "Offline."} {state.lastSyncedAt ? `Last synced ${ago(state.lastSyncedAt)}.` : ""}
        </p>
        {state.items.length === 0 ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-800">Everything is saved on the server.</p>
        ) : (
          <ul className="space-y-2">
            {state.items.map((i) => (
              <li key={i.id} className={`rounded-2xl border px-4 py-3 ${i.state === "failed" ? "border-red-200 bg-red-50" : "border-line bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">{i.label}</p>
                    <p className="text-sm text-ink-500">
                      {i.kind === "media" ? "Photo" : i.op?.type === "evidence" ? "Capture" : i.op?.type === "step-status" ? "Outcome" : i.op?.type?.startsWith("time") ? "Clock" : "Issue"} · added {ago(i.createdAt)}
                    </p>
                    {i.lastError && <p className={`mt-1 text-sm ${i.state === "failed" ? "font-medium text-red-800" : "text-ink-700"}`}>{i.lastError}</p>}
                  </div>
                  {i.state === "failed" ? (
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-red-800">Not saved</span>
                  ) : (
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-amber-800">Waiting</span>
                  )}
                </div>
                {i.state === "failed" && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => void outbox?.retry(i.id)} className="min-h-11 flex-1 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900">
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Discard "${i.label}"? It isn't on the server, so it will be lost.`)) void outbox?.discard(i.id);
                      }}
                      className="min-h-11 flex-1 rounded-full px-4 text-sm font-semibold text-red-800 hover:bg-red-100"
                    >
                      Discard
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </SlotPortal>
  );
}

/** The job title in the field header. */
export function HeaderTitle({ children }: { children: string }) {
  return <SlotPortal slot="field-header-title">{children}</SlotPortal>;
}
