"use client";

import { useId, useState, type ReactNode } from "react";
import { ISSUE_KIND_LABEL, LEARNING_PROMPTS, PROJECT_STAGES, ROLE_LABEL, STAFF_ROLES, STAGE_INFO, TIME_KINDS, TIME_KIND_LABEL, GATE_IDS, GATE_LABEL, type IssueKind } from "@aircon/domain";
import { ActionForm, SubmitButton } from "./action-form";
import type { ActionResult } from "./types";

/**
 * The command centre's small forms. Each one posts to a bound server action
 * (app/ops/projects/[id]/actions.ts) through ActionForm, so they all lock
 * while saving, keep what was typed when the signal drops and show the
 * reducer's blockers when a gate says no.
 */

type Action = (fd: FormData) => Promise<ActionResult>;

const CONTROL =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink-900 outline-none transition placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 disabled:bg-surface";
export const compactInput = `${CONTROL} min-h-10`;
const LABEL = "mb-1 block text-xs font-semibold text-ink-700";

function L({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={LABEL}>
      {children}
      {hint && <span className="ml-1 font-normal text-ink-500">{hint}</span>}
    </label>
  );
}

/** A small "Edit" disclosure: the form stays out of the way until it's wanted. */
export function Disclosure({ summary, children, open = false, className = "" }: { summary: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  return (
    <details className={`group ${className}`.trim()} open={open || undefined}>
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-1 text-sm font-semibold text-accent-700 hover:text-accent-600 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function OwnerForm({ action, staff, current }: { action: Action; staff: { id: string; name: string }[]; current?: string }) {
  const id = useId();
  return (
    <ActionForm action={action} className="min-w-0">
      <L htmlFor={id}>Owner</L>
      <div className="flex gap-2">
        <select id={id} name="staffId" defaultValue={current ?? ""} className={compactInput}>
          <option value="">Nobody yet</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary" busyLabel="…">
          Set
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function NextActionForm({ action, current }: { action: Action; current?: { text: string; dueOn?: string; ownerRole?: string } }) {
  const id = useId();
  return (
    <ActionForm action={action}>
      <div className="grid gap-2 sm:grid-cols-[1fr_9.5rem_9rem_auto] sm:items-end">
        <div>
          <L htmlFor={`${id}-t`}>Next action</L>
          <input id={`${id}-t`} name="text" defaultValue={current?.text ?? ""} maxLength={200} placeholder="What happens next, in a few words" className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-d`}>Due</L>
          <input id={`${id}-d`} name="dueOn" type="date" defaultValue={current?.dueOn ?? ""} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-o`}>Whose move</L>
          <select id={`${id}-o`} name="ownerRole" defaultValue={current?.ownerRole ?? ""} className={compactInput}>
            <option value="">Anyone</option>
            <option value="customer">Customer</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton variant="secondary">Save</SubmitButton>
      </div>
      <p className="mt-1 text-xs text-ink-500">Leave the text empty to clear it. The board then shows the top blocker instead.</p>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Survey                                                              */
/* ------------------------------------------------------------------ */

export function AssignSurveyorForm({ action, surveyors, current }: { action: Action; surveyors: { id: string; name: string }[]; current?: string }) {
  const id = useId();
  if (surveyors.length === 0) {
    return <p className="text-sm text-ink-500">Nobody on the team can survey yet. Add a surveyor in Staff.</p>;
  }
  return (
    <ActionForm action={action}>
      <L htmlFor={id}>Surveyor</L>
      <div className="flex gap-2">
        <select id={id} name="staffId" defaultValue={current ?? ""} required className={compactInput}>
          <option value="" disabled>
            Choose…
          </option>
          {surveyors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary" busyLabel="…">
          Assign
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function BookSurveyForm({
  action,
  dates,
  slots,
  surveyors,
  moving,
  fmt,
}: {
  action: Action;
  dates: string[];
  slots: string[];
  surveyors: { id: string; name: string }[];
  moving: boolean;
  /** dates pre-formatted on the server ("Tue 3 Nov"), so nothing formats in the browser */
  fmt: Record<string, string>;
}) {
  const id = useId();
  const [date, setDate] = useState(dates[0] ?? "");
  return (
    <ActionForm action={action}>
      <fieldset className="min-w-0">
        <legend className={LABEL}>Day</legend>
        <div className="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {dates.map((d) => (
            <label
              key={d}
              className={`relative flex min-h-10 shrink-0 cursor-pointer items-center rounded-full border px-3 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 ${
                date === d ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-700 hover:border-ink-300"
              }`}
            >
              <input type="radio" name="date" value={d} checked={date === d} onChange={() => setDate(d)} className="sr-only" />
              {fmt[d] ?? d}
            </label>
          ))}
          <label className="flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-2 text-sm text-ink-700">
            <span className="sr-only">Another date</span>
            <input
              type="date"
              aria-label="Another date"
              value={dates.includes(date) ? "" : date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-8 bg-transparent text-sm outline-none"
            />
          </label>
        </div>
        {!dates.includes(date) && date && <input type="hidden" name="date" value={date} />}
      </fieldset>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div>
          <L htmlFor={`${id}-time`}>Time</L>
          <select id={`${id}-time`} name="time" defaultValue={slots[0]} className={compactInput}>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-mode`}>Visit</L>
          <select id={`${id}-mode`} name="mode" defaultValue="in-person" className={compactInput}>
            <option value="in-person">In person</option>
            <option value="video">Video call</option>
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-s`}>Surveyor</L>
          <select id={`${id}-s`} name="surveyorId" defaultValue="" className={compactInput}>
            <option value="">Decide later</option>
            {surveyors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <SubmitButton>{moving ? "Move the survey" : "Book the survey"}</SubmitButton>
      </div>
      <p className="mt-1.5 text-xs text-ink-500">Times are London time. The customer gets a confirmation email{moving ? " with the new time" : " with a calendar invite"}.</p>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Contract facts                                                      */
/* ------------------------------------------------------------------ */

export function ConsentForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action}>
      <fieldset>
        <legend className={LABEL}>The customer agreed to get documents by email</legend>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="channel" value="in-person" variant="secondary">
            They told us in person
          </SubmitButton>
          <SubmitButton name="channel" value="email" variant="secondary">
            They said so by email
          </SubmitButton>
        </div>
      </fieldset>
    </ActionForm>
  );
}

export function OneButton({ action, label, confirm, variant = "secondary" }: { action: Action; label: string; confirm?: string; variant?: "primary" | "secondary" }) {
  return (
    <ActionForm action={action} confirm={confirm}>
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export function PilotForm({ action, current }: { action: Action; current?: { number: number; label: string } }) {
  const id = useId();
  return (
    <ActionForm action={action}>
      <div className="grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
        <div>
          <L htmlFor={`${id}-n`}>Pilot no.</L>
          <input id={`${id}-n`} name="number" type="number" min={1} max={999} required defaultValue={current?.number ?? ""} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-l`}>Label</L>
          <input id={`${id}-l`} name="label" required maxLength={80} defaultValue={current?.label ?? ""} placeholder="e.g. Croydon semi" className={compactInput} />
        </div>
        <SubmitButton variant="secondary">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ContactForm({ action, current }: { action: Action; current: { email?: string; phone?: string; accessNotes?: string; parkingNotes?: string } }) {
  const id = useId();
  return (
    <ActionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <L htmlFor={`${id}-e`}>Email</L>
          <input id={`${id}-e`} name="email" type="email" autoComplete="off" defaultValue={current.email ?? ""} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-p`}>Phone</L>
          <input id={`${id}-p`} name="phone" type="tel" autoComplete="off" defaultValue={current.phone ?? ""} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-a`}>Access notes</L>
          <textarea id={`${id}-a`} name="accessNotes" rows={2} maxLength={500} defaultValue={current.accessNotes ?? ""} className={CONTROL} />
        </div>
        <div>
          <L htmlFor={`${id}-k`}>Parking notes</L>
          <textarea id={`${id}-k`} name="parkingNotes" rows={2} maxLength={500} defaultValue={current.parkingNotes ?? ""} className={CONTROL} />
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-500">Changing the email moves the project to that address&apos;s customer record: sign-in links go there from now on.</p>
      <div className="mt-2">
        <SubmitButton variant="secondary">Save contact details</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** The customer cancelled their contract: when and how it reached us, and where it's on file. */
export function CancellationForm({ action, today }: { action: Action; today: string }) {
  const id = useId();
  return (
    <ActionForm
      action={action}
      confirm="Record the cancellation? The project closes as cancelled, unpaid invoices are voided, the refund and collection tasks are raised and the customer is emailed an acknowledgement."
    >
      <p className="mb-2 text-xs text-ink-500">
        Any clear statement counts: an email, a letter, a call. The refund is due within 14 days of the day it reached us.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <L htmlFor={`${id}-d`}>Reached us on</L>
          <input id={`${id}-d`} name="receivedOn" type="date" required max={today} defaultValue={today} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-t`} hint="(if known)">
            At
          </L>
          <input id={`${id}-t`} name="receivedTime" type="time" className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-c`}>How</L>
          <select id={`${id}-c`} name="channel" required defaultValue="email" className={compactInput}>
            <option value="email">Email</option>
            <option value="phone">Phone call</option>
            <option value="letter">Letter</option>
            <option value="in-person">In person</option>
            <option value="portal">Their project page</option>
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-e`} hint="(the email's date and subject, the letter, the call note)">
            On file as
          </L>
          <input id={`${id}-e`} name="evidenceRef" required minLength={3} maxLength={200} className={compactInput} />
        </div>
      </div>
      <div className="mt-2">
        <SubmitButton variant="secondary">Record the cancellation</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CloseForm({ action, contracted = false }: { action: Action; contracted?: boolean }) {
  const id = useId();
  return (
    <ActionForm action={action} confirm="Close this project? Delivery steps stop; money, certificates and aftercare can still be recorded.">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <L htmlFor={`${id}-r`} hint="(optional)">
            Closing note
          </L>
          <input id={`${id}-r`} name="reason" maxLength={300} className={compactInput} />
        </div>
        <SubmitButton variant="secondary">Close project</SubmitButton>
      </div>
      {contracted ? (
        <p className="mt-2 text-xs text-ink-500">Customer cancelling the contract? Use &ldquo;Record a cancellation&rdquo; instead.</p>
      ) : (
        <label className="mt-2 flex min-h-10 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="cancelled" className="h-4 w-4 accent-accent-600" />
          The customer withdrew before any contract (closes it now)
        </label>
      )}
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: Action }) {
  const id = useId();
  return (
    <ActionForm action={action} resetOnSuccess>
      <L htmlFor={id}>Internal note</L>
      <div className="flex gap-2">
        <input id={id} name="text" required maxLength={2000} placeholder="Only the team sees this" className={compactInput} />
        <SubmitButton variant="secondary">Add</SubmitButton>
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

const ISSUE_KINDS = Object.keys(ISSUE_KIND_LABEL) as IssueKind[];

export function RaiseIssueForm({ action, defaults }: { action: Action; defaults: Partial<Record<IssueKind, { severity: string; blocking: boolean; ownerRole: string; customerVisible: boolean }>> }) {
  const id = useId();
  const [kind, setKind] = useState<IssueKind>("defect");
  const d = defaults[kind];
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <L htmlFor={`${id}-k`}>Kind</L>
          <select id={`${id}-k`} name="kind" value={kind} onChange={(e) => setKind(e.target.value as IssueKind)} className={compactInput}>
            {ISSUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ISSUE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-s`}>Severity</L>
          <select key={`sev-${kind}`} id={`${id}-s`} name="severity" defaultValue={d?.severity ?? "medium"} className={compactInput}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <L htmlFor={`${id}-t`}>Title</L>
          <input id={`${id}-t`} name="title" required minLength={3} maxLength={140} placeholder="What's wrong, in a line" className={compactInput} />
        </div>
        <div className="sm:col-span-2">
          <L htmlFor={`${id}-d`} hint="(optional)">
            Detail
          </L>
          <textarea id={`${id}-d`} name="detail" rows={2} maxLength={2000} className={CONTROL} />
        </div>
        <div>
          <L htmlFor={`${id}-o`}>Owner</L>
          <select key={`own-${kind}`} id={`${id}-o`} name="ownerRole" defaultValue={d?.ownerRole ?? "ops"} className={compactInput}>
            <option value="ops">Ops</option>
            <option value="customer">Customer</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-g`} hint="(when blocking)">
            Holds gate
          </L>
          <select id={`${id}-g`} name="gate" defaultValue="" className={compactInput}>
            <option value="">Ready to install (default)</option>
            {GATE_IDS.map((g) => (
              <option key={g} value={g}>
                {GATE_LABEL[g]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-n`} hint="(optional)">
            Next action
          </L>
          <input id={`${id}-n`} name="nextAction" maxLength={200} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-due`} hint="(optional)">
            Due
          </L>
          <input id={`${id}-due`} name="dueOn" type="date" className={compactInput} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6">
        <label key={`b-${kind}`} className="flex min-h-10 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="blocking" defaultChecked={d?.blocking ?? false} className="h-4 w-4 accent-accent-600" />
          Blocks progress until resolved
        </label>
        <label key={`v-${kind}`} className="flex min-h-10 items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="customerVisible" defaultChecked={d?.customerVisible ?? false} className="h-4 w-4 accent-accent-600" />
          Customer can see it
        </label>
      </div>
      <div className="mt-2">
        <SubmitButton>Raise issue</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function IssueTransitionForm({ action, issueId, options }: { action: Action; issueId: string; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <ActionForm action={action} resetOnSuccess>
      <input type="hidden" name="issueId" value={issueId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <L htmlFor={`${id}-n`} hint="(needed to resolve or reject)">
            Note
          </L>
          <input id={`${id}-n`} name="note" maxLength={1000} className={compactInput} />
        </div>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <SubmitButton key={o.value} name="to" value={o.value} variant="secondary" busyLabel="…">
              {o.label}
            </SubmitButton>
          ))}
        </div>
      </div>
    </ActionForm>
  );
}

/**
 * A variation proposed on site waits here: the office checks the installer's
 * estimate (and the words the customer reads), then sends it. Until then
 * the customer can't see it.
 */
export function VariationSendForm({
  action,
  issueId,
  title,
  description,
  netPence,
  vatNote,
}: {
  action: Action;
  issueId: string;
  title: string;
  description: string;
  netPence: number;
  vatNote: string;
}) {
  const id = useId();
  return (
    <ActionForm action={action}>
      <input type="hidden" name="issueId" value={issueId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <L htmlFor={`${id}-t`}>The change, in a few words (the customer reads this)</L>
          <input id={`${id}-t`} name="title" required minLength={3} maxLength={140} defaultValue={title} className={compactInput} />
        </div>
        <div className="sm:col-span-2">
          <L htmlFor={`${id}-d`}>Why it&apos;s needed (the customer reads this)</L>
          <textarea id={`${id}-d`} name="description" required rows={3} maxLength={2000} defaultValue={description} className={CONTROL} />
        </div>
        <div>
          <L htmlFor={`${id}-p`} hint={vatNote}>
            Price change, £ before VAT
          </L>
          <input id={`${id}-p`} name="pounds" inputMode="decimal" required defaultValue={(netPence / 100).toFixed(2)} className={compactInput} />
        </div>
        <div className="flex items-end">
          <SubmitButton busyLabel="Sending…">Send to the customer for their OK</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

export function TimeForm({ action, staff, today, me }: { action: Action; staff: { id: string; name: string }[]; today: string; me: string }) {
  const id = useId();
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <L htmlFor={`${id}-p`}>Who</L>
          <select id={`${id}-p`} name="staffId" defaultValue={me} required className={compactInput}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-k`}>Kind</L>
          <select id={`${id}-k`} name="kind" defaultValue="install" className={compactInput}>
            {TIME_KINDS.map((k) => (
              <option key={k} value={k}>
                {TIME_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-d`}>Date</L>
          <input id={`${id}-d`} name="date" type="date" required defaultValue={today} max={today} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-s`} hint="(optional)">
            Started
          </L>
          <input id={`${id}-s`} name="start" type="time" className={compactInput} />
        </div>
        <fieldset className="min-w-0">
          <legend className={LABEL}>How long</legend>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center gap-1 text-sm text-ink-700">
              <input name="hours" type="number" min={0} max={16} step={1} defaultValue="" placeholder="0" aria-label="Hours" className={compactInput} />h
            </label>
            <label className="flex flex-1 items-center gap-1 text-sm text-ink-700">
              <input name="minutes" type="number" min={0} max={59} step={5} defaultValue="" placeholder="0" aria-label="Minutes" className={compactInput} />m
            </label>
          </div>
        </fieldset>
        <div>
          <L htmlFor={`${id}-n`} hint="(optional)">
            Install day
          </L>
          <input id={`${id}-n`} name="dayN" type="number" min={1} max={10} className={compactInput} />
        </div>
        <div className="sm:col-span-3">
          <L htmlFor={`${id}-note`} hint="(optional)">
            Note
          </L>
          <input id={`${id}-note`} name="note" maxLength={300} className={compactInput} />
        </div>
      </div>
      <div className="mt-3">
        <SubmitButton>Log time</SubmitButton>
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Learnings                                                           */
/* ------------------------------------------------------------------ */

export function LearningForm({ action, stage }: { action: Action; stage: string }) {
  const id = useId();
  return (
    <ActionForm action={action} resetOnSuccess>
      <p className="mb-3 text-sm text-ink-500">Two minutes, any of the eight. Skip the ones that don&apos;t apply.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {LEARNING_PROMPTS.map((p) => (
          <div key={p.id}>
            <L htmlFor={`${id}-${p.id}`}>{p.question}</L>
            <textarea id={`${id}-${p.id}`} name={`answer:${p.id}`} rows={2} maxLength={1000} className={CONTROL} />
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <L htmlFor={`${id}-st`}>Stage</L>
          <select id={`${id}-st`} name="stage" defaultValue={stage} className={compactInput}>
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_INFO[s].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <L htmlFor={`${id}-day`} hint="(optional)">
            Install day
          </L>
          <input id={`${id}-day`} name="dayN" type="number" min={1} max={10} className={compactInput} />
        </div>
        <div>
          <L htmlFor={`${id}-tags`} hint="(comma separated)">
            Tags
          </L>
          <input id={`${id}-tags`} name="tags" maxLength={200} placeholder="e.g. survey, tools" className={compactInput} />
        </div>
      </div>
      <div className="mt-3">
        <SubmitButton>Save learning</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function LearningStatusForm({ action, learningId, status }: { action: Action; learningId: string; status: string }) {
  const id = useId();
  return (
    <ActionForm action={action}>
      <input type="hidden" name="learningId" value={learningId} />
      {status === "open" ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <L htmlFor={id} hint="(needed to mark applied)">
              What changed
            </L>
            <input id={id} name="appliedNote" maxLength={500} placeholder="e.g. Added loft hatch size to the survey" className={compactInput} />
          </div>
          <div className="flex gap-2">
            <SubmitButton name="status" value="applied" variant="secondary" busyLabel="…">
              Applied
            </SubmitButton>
            <SubmitButton name="status" value="wont-fix" variant="ghost" busyLabel="…">
              Won&apos;t fix
            </SubmitButton>
          </div>
        </div>
      ) : (
        <SubmitButton name="status" value="open" variant="ghost" busyLabel="…">
          Reopen
        </SubmitButton>
      )}
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export function ResendForm({ action, messageId, label }: { action: Action; messageId: string; label: string }) {
  return (
    <ActionForm action={action} confirm={label === "Send again" ? "Send this message to the customer again?" : undefined}>
      <input type="hidden" name="messageId" value={messageId} />
      <SubmitButton variant="secondary" busyLabel="Sending…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
