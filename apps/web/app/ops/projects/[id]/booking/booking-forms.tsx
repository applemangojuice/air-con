"use client";

import { useMemo, useState } from "react";
import { REQUIREMENT_LABEL, ROLE_LABEL, type StaffRole, type StepRequirement } from "@aircon/domain";
import { Badge, Fieldset, inputClass } from "@/components/kit";
import { fmtDate, fmtDay } from "@/lib/format";
import { workingDatesFrom } from "../../../calendar/calendar-model";
import { ActionForm } from "./_f5/action-form";
import type { ActionState } from "./_f5/action-state";
import type { TeamMemberView } from "@/lib/booking-server";
import { WrapBadge } from "./_f5/wrap-badge";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Pick day 1; the block fills in the working days after it, shown before saving. */
export function DatesForm({
  action,
  earliest,
  current,
  installDays,
  workingDays,
  locked,
}: {
  action: Action;
  earliest: string;
  current?: string;
  installDays: number;
  workingDays: number[];
  locked?: string;
}) {
  const [start, setStart] = useState(current && current >= earliest ? current : earliest);
  const preview = useMemo(() => (start ? workingDatesFrom(start, installDays, workingDays) : []), [start, installDays, workingDays]);
  const notWorking = Boolean(start) && preview[0] !== start;
  if (locked) return <p className="text-sm text-ink-500">{locked}</p>;
  return (
    <ActionForm flash action={action} submitLabel={current ? "Move the install" : "Set install dates"} busyLabel="Checking the diary…" confirm={current ? "Move the install to these dates? The customer will be told once the booking is confirmed." : undefined}>
      <label htmlFor="startDate" className="mb-1.5 block text-sm font-semibold text-ink-900">
        First install day
      </label>
      <input
        id="startDate"
        name="startDate"
        type="date"
        min={earliest}
        value={start}
        onChange={(e) => setStart(e.target.value)}
        required
        aria-describedby="startDate-hint"
        className={`${inputClass} max-w-xs`}
      />
      <p id="startDate-hint" className="mt-1.5 text-xs text-ink-500">
        Earliest possible: {fmtDay(earliest)} (lead time, working days and the cancellation rules).
      </p>
      {start && (
        <div className="mt-3 rounded-2xl border border-line bg-surface/60 px-4 py-3 text-sm" aria-live="polite">
          {notWorking ? (
            <p className="font-medium text-amber-800">{fmtDay(start)} isn&apos;t a working day: pick a weekday.</p>
          ) : start < earliest ? (
            <p className="font-medium text-amber-800">That&apos;s before the earliest date the rules allow ({fmtDate(earliest)}).</p>
          ) : (
            <p className="text-ink-700">
              <span className="font-semibold text-ink-900">{installDays}-day block:</span> {preview.map((d) => fmtDay(d)).join(" · ")}
            </p>
          )}
        </div>
      )}
    </ActionForm>
  );
}

const REQS: StepRequirement[] = ["fgas", "electrical", "tech-lead"];
const SHORT: Record<StepRequirement, string> = { fgas: "F-gas", electrical: "Part P", "tech-lead": "Tech lead" };

/** The crew: tick who's on the job and in which role, with each person's certificates for the install dates. */
export function CrewForm({
  action,
  team,
  crew,
  checkOn,
  locked,
}: {
  action: Action;
  team: TeamMemberView[];
  crew: { staffId: string; role: StaffRole }[];
  checkOn: string;
  locked?: string;
}) {
  const [picked, setPicked] = useState<Record<string, StaffRole | null>>(() =>
    Object.fromEntries(team.map((t) => [t.id, crew.find((c) => c.staffId === t.id)?.role ?? null])),
  );
  const chosen = team.filter((t) => picked[t.id]);
  const covered = Object.fromEntries(REQS.map((r) => [r, chosen.some((t) => t.meets[r])])) as Record<StepRequirement, boolean>;
  const rolesFor = (t: TeamMemberView): StaffRole[] => {
    const own = t.roles.filter((r) => r !== "surveyor");
    if ((t.roles.includes("tech-lead") || t.roles.includes("admin")) && !own.includes("installer")) own.push("installer");
    return own.filter((r) => r !== "admin");
  };

  if (team.length === 0) {
    return <p className="text-sm text-ink-500">Nobody is on the staff list yet. Add people and their certificates on the Staff page.</p>;
  }
  return (
    <ActionForm flash action={action} submitLabel="Save the crew" busyLabel="Checking qualifications…" disabled={Boolean(locked)}>
      {locked && <p className="mb-3 text-sm text-ink-500">{locked}</p>}
      <Fieldset legend="Who's on the job" hint={`Certificates are checked against ${fmtDate(checkOn)}, the last install day.`}>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {team.map((t) => {
            const role = picked[t.id];
            const options = rolesFor(t);
            return (
              <li key={t.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-accent-600"
                    checked={Boolean(role)}
                    disabled={Boolean(locked) || options.length === 0}
                    onChange={(e) => setPicked((p) => ({ ...p, [t.id]: e.target.checked ? options[0] ?? null : null }))}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink-900">
                      {t.name}
                      {t.external && <span className="ml-2 align-middle"><Badge tone="neutral">Subcontractor</Badge></span>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {REQS.map((r) => (
                        <Badge key={r} tone={t.meets[r] ? "success" : "neutral"} dot>
                          {SHORT[r]} {t.meets[r] ? "✓" : "–"}
                        </Badge>
                      ))}
                    </span>
                    {t.qualifications.length > 0 ? (
                      <span className="mt-1.5 block text-xs text-ink-500">
                        {t.qualifications.map((q) => (
                          <span key={`${q.kind}-${q.reference}`} className={`mr-3 inline-block ${q.current ? "" : "font-semibold text-red-700"}`}>
                            {q.label} {q.reference}
                            {q.unverified ? ", NOT VERIFIED (upload it on Staff and tick that it's checked)" : q.expiresOn ? `, ${q.current ? "until" : "EXPIRED"} ${fmtDate(q.expiresOn)}` : ""}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="mt-1.5 block text-xs text-ink-500">No certificates on record.</span>
                    )}
                    {t.clashes.length > 0 && (
                      <span className="mt-1.5 block text-xs font-semibold text-red-700">
                        Already booked on {t.clashes.map((c) => `${fmtDay(c.date)} (${c.customer})`).join(", ")}
                      </span>
                    )}
                  </span>
                </label>
                {role && options.length > 1 && (
                  <label className="flex items-center gap-2 text-sm sm:shrink-0">
                    <span className="text-ink-500">Role</span>
                    <select
                      className="min-h-11 rounded-full border border-line bg-white px-3 text-sm"
                      value={role}
                      onChange={(e) => setPicked((p) => ({ ...p, [t.id]: e.target.value as StaffRole }))}
                    >
                      {options.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {role && options.length === 1 && <span className="text-sm text-ink-500 sm:shrink-0">{ROLE_LABEL[role]}</span>}
                {role && <input type="hidden" name="member" value={`${t.id}:${role}`} />}
              </li>
            );
          })}
        </ul>
      </Fieldset>
      <ul className="mt-3 flex flex-wrap gap-2" aria-live="polite">
        {REQS.map((r) => (
          <li key={r} className="max-w-full">
            <WrapBadge tone={covered[r] ? "success" : r === "tech-lead" ? "warn" : "danger"}>
              {covered[r] ? `${REQUIREMENT_LABEL[r]}: covered` : `No ${REQUIREMENT_LABEL[r].toLowerCase()} picked`}
            </WrapBadge>
          </li>
        ))}
      </ul>
    </ActionForm>
  );
}
