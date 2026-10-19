"use client";

import { useState } from "react";
import { Button, Textarea } from "@/components/kit";
import { reachUs } from "@/components/site/claims";
import type { ProposalPageData } from "./types";

/**
 * "Ask for changes" and "Decline", the two other answers to a proposal.
 * Both are calm, optional and reversible in conversation: the page says
 * what happens next. Safe to retry.
 */

type Mode = "none" | "changes" | "decline";
type Done = "changes" | "decline" | null;

export function Respond({ data, onDone }: { data: ProposalPageData; onDone?: (kind: "changes" | "decline") => void }) {
  const [mode, setMode] = useState<Mode>("none");
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done>(null);
  const readOnly = data.viewer !== "customer";

  async function send(kind: "changes" | "decline") {
    if (readOnly) return;
    if (kind === "changes" && text.trim().length < 3) {
      setError("Tell us what you'd like changed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${data.proposalId}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "changes" ? { text } : { reason }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "That didn't go through. Please try again, or call us.");
        return;
      }
      setDone(kind);
      setMode("none");
      onDone?.(kind);
    } catch {
      setError("We couldn't reach our server. Check your signal and try again: it's safe to send twice.");
    } finally {
      setBusy(false);
    }
  }

  if (done === "changes") {
    return (
      <div role="status" className="rounded-2xl border border-sage-200 bg-sage-50 p-5 text-sage-900">
        <p className="font-semibold">Thanks, we&apos;ve got your request.</p>
        <p className="mt-1 text-sm">
          We&apos;ll look at it and send you a revised proposal by email. If anything&apos;s urgent, {reachUs(data.company)}.
        </p>
      </div>
    );
  }
  if (done === "decline") {
    return (
      <div role="status" className="rounded-2xl border border-line bg-white p-5">
        <p className="font-semibold text-ink-900">Thanks for letting us know.</p>
        <p className="mt-1 text-sm text-ink-700">We won&apos;t chase you about this proposal. If you change your mind, {reachUs(data.company)}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {readOnly && (
        <p className="rounded-2xl border border-dashed border-line bg-cream p-4 text-sm text-ink-700">
          {data.viewer === "preview" ? "Preview only: the customer can ask for changes or decline here." : "Only the customer can ask for changes or decline, from their own link."}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          size="lg"
          aria-expanded={mode === "changes"}
          aria-controls="changes-form"
          disabled={readOnly}
          onClick={() => {
            setError(null);
            setMode(mode === "changes" ? "none" : "changes");
          }}
        >
          Ask for changes
        </Button>
        <Button
          variant="ghost"
          size="lg"
          aria-expanded={mode === "decline"}
          aria-controls="decline-form"
          disabled={readOnly}
          onClick={() => {
            setError(null);
            setMode(mode === "decline" ? "none" : "decline");
          }}
        >
          No thanks, decline
        </Button>
      </div>

      {mode === "changes" && (
        <div id="changes-form" className="space-y-3 rounded-2xl border border-line bg-white p-5">
          <Textarea
            label="What would you like changed?"
            hint="For example a different spot for a unit, another room, or a question about the price. You can still accept this version later."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={5}
          />
          <Button onClick={() => send("changes")} busy={busy} busyLabel="Sending…">
            Send my request
          </Button>
        </div>
      )}

      {mode === "decline" && (
        <div id="decline-form" className="space-y-3 rounded-2xl border border-line bg-white p-5">
          <Textarea
            label="Anything you'd like to tell us? (optional)"
            hint="It helps us get better. You don't have to give a reason."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
          />
          <Button variant="danger" onClick={() => send("decline")} busy={busy} busyLabel="Sending…">
            Decline this proposal
          </Button>
        </div>
      )}

      <div aria-live="polite" role="status">
        {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">{error}</p>}
      </div>
    </div>
  );
}
