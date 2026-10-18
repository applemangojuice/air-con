"use client";

import { useEffect, useState } from "react";
import { getFieldOutbox, newOpId } from "@/lib/field-outbox";
import { nowIso } from "./capture";
import { londonTime, personName } from "./format";
import type { PackMaterial } from "./types";
import { useOutboxState, useRefreshOnSync } from "./use-outbox";

/** The RAMS acknowledgement in the job pack: one tap, recorded against the runsheet's RAMS step. */
export function RamsAck({
  projectId,
  specId,
  acknowledged,
  mine,
  meName,
}: {
  projectId: string;
  specId?: string;
  acknowledged: { by: string; at: string }[];
  mine: boolean;
  meName: string;
}) {
  useRefreshOnSync();
  const state = useOutboxState();
  const [busy, setBusy] = useState(false);
  const waiting = state.items.some((i) => i.op?.type === "evidence" && i.op.specId === specId && i.state === "queued");
  const failed = state.items.find((i) => i.op?.type === "evidence" && i.op.specId === specId && i.state === "failed");
  const done = mine || waiting;
  return (
    <div>
      {acknowledged.length > 0 ? (
        <ul className="mb-3 space-y-1 text-base text-ink-700">
          {acknowledged.map((a) => (
            <li key={`${a.by}-${a.at}`}>
              ✓ {personName(a.by)} <span className="text-sm text-ink-500">at {londonTime(a.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-base text-ink-700">Nobody has acknowledged them yet.</p>
      )}
      {failed && (
        <p role="alert" className="mb-2 text-sm font-medium text-red-700">
          Not saved: {failed.lastError}
        </p>
      )}
      {!specId ? (
        <p className="text-sm text-ink-500">The runsheet isn&apos;t ready yet, so there&apos;s nothing to acknowledge against.</p>
      ) : done ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-800" role="status">
          {waiting ? "Acknowledged: waiting to sync." : `You've acknowledged them, ${personName(meName)}.`}
        </p>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await getFieldOutbox().enqueue({ type: "evidence", id: newOpId(), projectId, specId, at: nowIso() }, "RAMS acknowledged");
            setBusy(false);
          }}
          className="min-h-12 w-full rounded-full bg-accent-600 px-6 font-semibold text-white shadow-sm disabled:opacity-40"
        >
          I&apos;ve read the RAMS and the risks
        </button>
      )}
    </div>
  );
}

/** Materials and tools to load: ticks kept on this phone only (they're a packing list, not a record). */
export function LoadList({ projectId, kind, items }: { projectId: string; kind: "materials" | "tools"; items: (PackMaterial | { key: string; label: string; why?: string })[] }) {
  const storageKey = `dih-field-${kind}-${projectId}`;
  const [ticked, setTicked] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setTicked(JSON.parse(raw) as string[]);
    } catch {
      // Private browsing: ticks just won't persist.
    }
  }, [storageKey]);
  const toggle = (key: string) => {
    setTicked((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
  return (
    <div>
      <p className="mb-2 text-sm text-ink-500" aria-live="polite">
        {ticked.length} of {items.length} loaded · ticks are kept on this phone only
      </p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {items.map((m) => {
          const on = ticked.includes(m.key);
          const mat = m as PackMaterial;
          return (
            <li key={m.key}>
              <label className="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3">
                <input type="checkbox" checked={on} onChange={() => toggle(m.key)} className="mt-1 h-5 w-5 shrink-0 accent-accent-600" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-base ${on ? "text-ink-500 line-through" : "text-ink-900"}`}>
                    {mat.qty !== undefined ? <span className="font-semibold tabular-nums">{mat.qty}{mat.unit ? ` ${mat.unit}` : ""} × </span> : null}
                    {m.label}
                  </span>
                  {mat.status && <span className="block text-sm text-ink-500">{mat.status}</span>}
                  {"why" in m && m.why && <span className="block text-sm text-ink-500">{m.why}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
