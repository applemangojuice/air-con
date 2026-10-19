"use client";

import { useId, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ops/command/action-form";
import { compactInput } from "@/components/ops/command/forms";
import type { ActionResult } from "@/components/ops/command/types";
import { PhotoUpload } from "./booking/_f5/photo-upload";

/**
 * The customer's early-start request, recorded with the thing itself: their
 * email (saved as a PDF, or a screenshot showing who sent it and when) or
 * the signed form goes into the project's files, with the day it reached us,
 * the address an email came from, and a tick that it uses the words we gave
 * them. We carry the burden of proof if they later cancel (CCR reg 17), so
 * a typed reference on its own isn't enough. The server checks it all again
 * (booking-server recordEarlyStartEvidence).
 *
 * Used by the command centre and the booking page.
 */

const LABEL = "mb-1 block text-xs font-semibold text-ink-700";

export function EarlyStartFields({ projectId, customerEmail, today, wording }: { projectId: string; customerEmail?: string; today: string; wording?: string }) {
  const id = useId();
  const [channel, setChannel] = useState<"email" | "paper">("email");
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className={LABEL}>It came as</legend>
        <div className="flex flex-wrap gap-4">
          {(["email", "paper"] as const).map((c) => (
            <label key={c} className="flex min-h-10 items-center gap-2 text-sm text-ink-900">
              <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} className="h-4 w-4 accent-accent-700" />
              {c === "email" ? "Their email" : "A signed form"}
            </label>
          ))}
        </div>
      </fieldset>
      <PhotoUpload
        projectId={projectId}
        tag="document"
        label={channel === "email" ? "Their email, saved as a PDF or a screenshot" : "The signed form (a scan or a photo)"}
        hint={channel === "email" ? "Show who it's from, when it was sent and the words they used." : "All of it, signature included."}
        caption="Early-start request"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-d`} className={LABEL}>
            It reached us on
          </label>
          <input id={`${id}-d`} name="receivedOn" type="date" required max={today} defaultValue={today} className={compactInput} />
        </div>
        {channel === "email" && (
          <div>
            <label htmlFor={`${id}-f`} className={LABEL}>
              From <span className="font-normal text-ink-500">(the address on the contract)</span>
            </label>
            <input id={`${id}-f`} name="fromAddress" type="email" required defaultValue={customerEmail ?? ""} autoComplete="off" className={compactInput} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-r`} className={LABEL}>
            Which one <span className="font-normal text-ink-500">({channel === "email" ? "its date and subject" : "the form's reference"})</span>
          </label>
          <input
            id={`${id}-r`}
            name="evidenceRef"
            required
            minLength={3}
            maxLength={200}
            placeholder={channel === "email" ? "e.g. 3 Nov, Re: Your contract" : "e.g. Early-start form, signed 3 Nov"}
            className={compactInput}
          />
        </div>
      </div>
      {wording && <blockquote className="rounded-xl border-l-4 border-accent-500 bg-white px-3 py-2 text-sm text-ink-700">{wording}</blockquote>}
      <label className="flex min-h-10 items-start gap-2 text-sm text-ink-900">
        <input type="checkbox" name="wording" required className="mt-0.5 h-4 w-4 shrink-0 accent-accent-700" />
        <span>It asks us to start before their cancellation period ends, in the words we gave them{wording ? " (above)" : ""}.</span>
      </label>
    </div>
  );
}

type Action = (fd: FormData) => Promise<ActionResult>;

/** The command centre's version: the fields above, posted to its action. */
export function EarlyStartForm({ action, requested, projectId, customerEmail, today, wording }: { action: Action; requested: boolean; projectId: string; customerEmail?: string; today: string; wording?: string }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <p className="mb-2 text-sm text-ink-700">
        {requested
          ? "They ticked “start early” on the portal. It only counts once their own email (with the early-start wording) or a signed form is on file."
          : "If they've asked us by email or on the signed form to start early, record it here."}
      </p>
      <EarlyStartFields projectId={projectId} customerEmail={customerEmail} today={today} wording={wording} />
      <div className="mt-3">
        <SubmitButton variant="secondary">Record</SubmitButton>
      </div>
    </ActionForm>
  );
}
