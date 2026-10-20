"use client";

import { useId } from "react";
import { ActionForm, SubmitButton } from "@/components/ops/command/action-form";
import { Disclosure, compactInput } from "@/components/ops/command/forms";
import type { ActionResult } from "@/components/ops/command/types";
import { PhotoUpload } from "./booking/_f5/photo-upload";

/**
 * The electrical certificate and the warranty registration, recorded with
 * the things themselves: the file (PDF or photo) and its number go into the
 * customer's documents before anything tells them it's there.
 */

type Action = (fd: FormData) => Promise<ActionResult>;

const LABEL = "mb-1 block text-xs font-semibold text-ink-700";

export function ElectricalCertificateForms({ action, projectId, current }: { action: Action; projectId: string; current: string }) {
  const id = useId();
  // No "not required": every install adds a new circuit, which always needs its certificate.
  const others = [{ value: "pending", label: "Pending" }].filter((o) => o.value !== current);
  return (
    <div className="space-y-2">
      {current !== "received" && (
        <Disclosure summary="Electrical certificate received">
          <ActionForm action={action} resetOnSuccess>
            <input type="hidden" name="status" value="received" />
            <div className="space-y-3">
              <PhotoUpload projectId={projectId} tag="document" label="The certificate (PDF or a photo)" caption="Electrical installation certificate" hint="It goes into the customer's documents." />
              <div>
                <label htmlFor={`${id}-ref`} className={LABEL}>
                  Certificate number <span className="font-normal text-ink-500">(or the scheme notification reference)</span>
                </label>
                <input id={`${id}-ref`} name="reference" required minLength={3} maxLength={80} className={compactInput} />
              </div>
              <div>
                <label htmlFor={`${id}-iss`} className={LABEL}>
                  Issued by <span className="font-normal text-ink-500">(the electrician&apos;s scheme, optional)</span>
                </label>
                <input id={`${id}-iss`} name="issuer" maxLength={120} placeholder="e.g. NICEIC" className={compactInput} />
              </div>
              <SubmitButton variant="secondary">Add to their documents</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      )}
      {others.length > 0 && (
        <ActionForm action={action}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink-700">Mark as</span>
            {others.map((o) => (
              <SubmitButton key={o.value} name="status" value={o.value} variant="secondary" busyLabel="…">
                {o.label}
              </SubmitButton>
            ))}
          </div>
        </ActionForm>
      )}
    </div>
  );
}

export function WarrantyRegistrationForm({ action, projectId }: { action: Action; projectId: string }) {
  const id = useId();
  return (
    <Disclosure summary="Warranty registered">
      <ActionForm action={action} resetOnSuccess confirm="Only mark it registered once the manufacturer has confirmed it. Carry on?">
        <div className="space-y-3">
          <div>
            <label htmlFor={`${id}-ref`} className={LABEL}>
              Registration reference
            </label>
            <input id={`${id}-ref`} name="reference" required minLength={3} maxLength={80} className={compactInput} />
          </div>
          <div>
            <label htmlFor={`${id}-iss`} className={LABEL}>
              Manufacturer <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <input id={`${id}-iss`} name="issuer" maxLength={120} className={compactInput} />
          </div>
          <PhotoUpload projectId={projectId} tag="document" label="The confirmation (optional: PDF or a screenshot)" caption="Warranty registration" />
          <SubmitButton variant="secondary">Add to their documents</SubmitButton>
        </div>
      </ActionForm>
    </Disclosure>
  );
}
