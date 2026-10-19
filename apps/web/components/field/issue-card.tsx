"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, SEVERITY_LABEL } from "@aircon/domain";
import type { FieldIssue } from "./types";
import { money } from "./format";

/** One issue in the field: what, how bad, whether it holds the job, and the installer's two moves (on it / fixed). */

const SEV: Record<string, string> = {
  critical: "bg-red-700 text-white",
  high: "bg-red-50 text-red-800 border border-red-200",
  medium: "bg-amber-50 text-amber-900 border border-amber-200",
  low: "bg-surface text-ink-700 border border-line",
};

const VARIATION: Record<string, { text: string; tone: string }> = {
  draft: { text: "With the office to check the price: don't do this work yet", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  proposed: { text: "Waiting for the customer's OK: don't do this work yet", tone: "bg-amber-50 text-amber-900 border-amber-200" },
  accepted: { text: "Customer approved: go ahead", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  declined: { text: "Customer declined: don't do this work", tone: "bg-red-50 text-red-800 border-red-200" },
};

export function IssueCard({ issue, showJob = false, canUpdate = true }: { issue: FieldIssue; showJob?: boolean; canUpdate?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "in-progress" | "resolved">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What was just saved, shown until the refreshed issue arrives (so the buttons don't come back meanwhile).
  const [saved, setSaved] = useState<null | "in-progress" | "resolved">(null);
  const open = issue.status === "open" || issue.status === "in-progress" || issue.status === "awaiting-customer";
  useEffect(() => setSaved(null), [issue.status]);

  async function save() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/field/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: mode, note }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "That didn't save.");
      setSaved(mode);
      setMode(null);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No connection: try again when you have signal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`rounded-2xl border bg-white p-4 ${issue.blocking && open ? "border-red-300" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink-500">#{issue.number}</span>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink-700">{ISSUE_KIND_LABEL[issue.kind]}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEV[issue.severity]}`}>{SEVERITY_LABEL[issue.severity]}</span>
        {issue.blocking && open && <span className="rounded-full bg-red-700 px-2.5 py-0.5 text-xs font-semibold text-white">Holds the job</span>}
        <span className="ml-auto text-xs font-semibold text-ink-700">{ISSUE_STATUS_LABEL[issue.status]}</span>
      </div>
      <h3 className="mt-2 text-lg font-semibold leading-snug text-ink-900">{issue.title}</h3>
      {issue.detail && <p className="mt-1 text-base text-ink-700">{issue.detail}</p>}
      {issue.variation && (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-sm font-semibold ${VARIATION[issue.variation.status]!.tone}`}>
          {VARIATION[issue.variation.status]!.text}
          {issue.variation.totalDeltaPence !== undefined ? ` · ${issue.variation.totalDeltaPence >= 0 ? "+" : ""}${money(issue.variation.totalDeltaPence)}` : ""}
        </p>
      )}
      {issue.mediaUrls.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {issue.mediaUrls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="Issue photo" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
          ))}
        </div>
      )}
      <p className="mt-2 text-sm text-ink-500">
        Raised by {issue.raisedBy}
        {showJob && issue.customerName ? ` · ` : ""}
        {showJob && issue.customerName && (
          <Link href={`/field/jobs/${issue.projectId}`} className="font-semibold text-accent-700 underline underline-offset-2">
            {issue.customerName}
          </Link>
        )}
        {issue.customerVisible ? " · the customer can see this" : ""}
      </p>

      {saved && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          {saved === "resolved" ? "Marked fixed. The office sees it now." : "Marked as in hand."}
        </p>
      )}
      {canUpdate && open && !saved && issue.kind !== "variation" && (
        <div className="mt-3">
          {mode ? (
            <div className="space-y-2">
              <label htmlFor={`note-${issue.id}`} className="block text-sm font-semibold text-ink-900">
                {mode === "resolved" ? "What was done?" : "Note (optional)"}
              </label>
              <textarea
                id={`note-${issue.id}`}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
              />
              {error && (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setMode(null)} className="min-h-12 flex-1 rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || (mode === "resolved" && note.trim().length < 3)}
                  onClick={save}
                  className="min-h-12 flex-1 rounded-full bg-accent-600 px-4 font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "Saving…" : mode === "resolved" ? "Mark fixed" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {issue.status !== "in-progress" && (
                <button type="button" onClick={() => setMode("in-progress")} className="min-h-12 flex-1 rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
                  I&apos;m on it
                </button>
              )}
              <button type="button" onClick={() => setMode("resolved")} className="min-h-12 flex-1 rounded-full border border-line bg-white px-4 font-semibold text-ink-900">
                Fixed
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
