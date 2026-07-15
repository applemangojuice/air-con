"use client";

import { useMemo, useState } from "react";
import {
  DELIVERY_LEAD_DAYS,
  INSTALL_LEAD_DAYS,
  SITE_VISIT,
  SITE_VISIT_MODE_LABEL,
  daysBetween,
  rescheduleFeeGbp,
  stageState,
  type Project,
  type ProjectAction,
  type SiteVisitMode,
} from "@aircon/domain";
import { fmtDay, fmtDayTime, gbp } from "@/lib/format";
import {
  Explainer,
  GhostButton,
  InfoRow,
  LockedNote,
  PrimaryButton,
  StagePanel,
  dateInputCls,
} from "./bits";

export interface PanelProps {
  project: Project;
  demo: boolean;
  busy: boolean;
  dispatch: (action: ProjectAction) => void;
}

const isoDatePlus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------ */
/* 1 · Quote                                                          */
/* ------------------------------------------------------------------ */

export function QuoteStagePanel({ project, demo }: PanelProps) {
  const q = project.quoteSummary;
  return (
    <StagePanel stage="quote" state="complete">
      <div className="rounded-2xl bg-surface/60 p-4">
        <InfoRow label="Fixed price (inc. VAT)">{gbp(q.totalGbp)}</InfoRow>
        <div className="mt-2 space-y-2">
          <InfoRow label="Rooms">{q.roomCount}</InfoRow>
          <InfoRow label="Install time">
            {q.installDays === 1 ? "1 day" : `${q.installDays} days`}
          </InfoRow>
          <InfoRow label={q.systems.length > 1 ? "Outdoor units" : "Outdoor unit"}>
            {q.systems.join(" · ")}
          </InfoRow>
        </div>
      </div>
      <Explainer stage="quote" />
      {!demo && (
        <a
          href={`/q/${project.quoteId}`}
          className="inline-block text-sm font-semibold text-accent-700 hover:underline"
        >
          See the full quote: breakdown, finance, warranty →
        </a>
      )}
    </StagePanel>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Floor plan                                                     */
/* ------------------------------------------------------------------ */

const FLOOR_LABEL: Record<string, string> = {
  ground: "Ground floor",
  first: "First floor",
  "second-plus": "Second floor +",
  loft: "Loft",
};

export function FloorPlanPanel({ project, busy, dispatch }: PanelProps) {
  const state = stageState(project, "floor-plan");
  const byFloor = useMemo(() => {
    const groups = new Map<string, { name: string; unitLabel: string }[]>();
    for (const room of project.quoteSummary.roomDesigns) {
      const list = groups.get(room.floor) ?? [];
      list.push(room);
      groups.set(room.floor, list);
    }
    return [...groups.entries()];
  }, [project.quoteSummary.roomDesigns]);

  return (
    <StagePanel stage="floor-plan" state={state}>
      {project.floorPlan.archetypeName && (
        <p className="text-sm text-ink-500">
          Based on the proven layout for a{" "}
          <strong className="text-ink-900">{project.floorPlan.archetypeName}</strong>. We fit
          this house type week in, week out.
        </p>
      )}

      {/* Schematic: rooms by floor with their units */}
      <div className="grid gap-3 sm:grid-cols-2">
        {byFloor.map(([floor, rooms]) => (
          <div key={floor} className="rounded-2xl border border-line p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
              {FLOOR_LABEL[floor] ?? floor}
            </p>
            <ul className="mt-2 space-y-2">
              {rooms.map((room) => (
                <li key={room.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{room.name}</span>
                  <span className="rounded-full bg-sage-50 px-2.5 py-0.5 text-xs font-semibold text-sage-700">
                    {room.unitLabel}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {project.floorPlan.pattern && (
        <div className="rounded-2xl bg-surface/60 p-4 text-sm">
          <p className="font-semibold">{project.floorPlan.pattern.label}</p>
          <p className="mt-1 text-ink-500">{project.floorPlan.pattern.summary}</p>
          <p className="mt-2 text-ink-700">
            <span className="font-semibold">Pipe route:</span> {project.floorPlan.pattern.pipeRoute}
          </p>
        </div>
      )}

      {state === "current" ? (
        <>
          <PrimaryButton onClick={() => dispatch({ type: "approve-floor-plan" })} busy={busy}>
            Approve my floor plan
          </PrimaryButton>
          <p className="text-xs text-ink-300">
            Not quite right? Nothing is final yet. The site visit walks every position with you,
            and changing your mind there is free.
          </p>
        </>
      ) : state === "complete" ? (
        <p className="text-sm text-sage-700">
          Approved {project.floorPlan.approvedAt ? fmtDay(project.floorPlan.approvedAt) : ""}. Any
          tweaks get picked up at your site visit.
        </p>
      ) : null}
    </StagePanel>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Final quote                                                    */
/* ------------------------------------------------------------------ */

export function FinalQuotePanel({ project, busy, dispatch }: PanelProps) {
  const state = stageState(project, "final-quote");
  const fq = project.finalQuote;

  return (
    <StagePanel stage="final-quote" state={state}>
      {state === "upcoming" && (
        <>
          <Explainer stage="final-quote" />
          <LockedNote>Approve your floor plan first and this step unlocks right after.</LockedNote>
        </>
      )}

      {state === "current" && fq.status === "pending" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">We&apos;re checking your survey now.</p>
          <p className="mt-1">
            Your final quote lands within <strong>1 working day</strong> of you approving your
            floor plan. That&apos;s a promise, not an aim. If we miss it, £50 comes off your
            install.
          </p>
        </div>
      )}

      {fq.status !== "pending" && (
        <div className="rounded-2xl bg-surface/60 p-4">
          <InfoRow label="Final fixed price (inc. VAT)">{gbp(fq.totalGbp ?? 0)}</InfoRow>
          {fq.totalGbp !== project.quoteSummary.totalGbp && (
            <p className="mt-2 text-xs text-ink-500">
              Your instant quote was {gbp(project.quoteSummary.totalGbp)}. The change comes from
              our photo review{fq.note ? `: ${fq.note}` : "."}
            </p>
          )}
          {fq.note && fq.totalGbp === project.quoteSummary.totalGbp && (
            <p className="mt-2 text-xs text-ink-500">{fq.note}</p>
          )}
        </div>
      )}

      {state === "current" && fq.status === "issued" && (
        <>
          <PrimaryButton onClick={() => dispatch({ type: "accept-final-quote" })} busy={busy}>
            Accept my final quote
          </PrimaryButton>
          <p className="text-xs text-ink-300">
            Accepting costs nothing and doesn&apos;t tie you in. It just unlocks site visit
            booking, and the site visit is where you decide for real.
          </p>
        </>
      )}

      {state === "complete" && (
        <p className="text-sm text-sage-700">
          Accepted {fq.acceptedAt ? fmtDay(fq.acceptedAt) : ""}. This price is now in writing and
          only ever changes if you change the plan.
        </p>
      )}
    </StagePanel>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Site visit                                                     */
/* ------------------------------------------------------------------ */

/** Bookable slots: next 10 weekdays, three slots a day. */
function siteVisitSlots(): { day: string; times: string[] }[] {
  const days: { day: string; times: string[] }[] = [];
  const cursor = new Date();
  while (days.length < 10) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    days.push({ day: cursor.toISOString().slice(0, 10), times: ["10:00", "13:00", "16:00"] });
  }
  return days;
}

export function SiteVisitPanel({ project, busy, dispatch }: PanelProps) {
  const state = stageState(project, "site-visit");
  const sv = project.siteVisit;
  const [mode, setMode] = useState<SiteVisitMode>(sv.mode);
  const [day, setDay] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [rescheduling, setRescheduling] = useState(false);
  const slots = useMemo(siteVisitSlots, []);

  const slotIso = day && time ? `${day}T${time}:00.000Z` : null;
  const canBook = state === "current" && sv.status === "not-booked";
  const moveFee =
    sv.status === "booked" && sv.scheduledFor
      ? rescheduleFeeGbp("site-visit", daysBetween(new Date().toISOString(), sv.scheduledFor))
      : 0;

  const purposeList = (
    <div className="rounded-2xl bg-surface/60 p-4">
      <p className="text-sm font-semibold">One hour with our founder. Here&apos;s what it&apos;s for</p>
      <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
        {SITE_VISIT.purposes.map((purpose) => (
          <li key={purpose} className="flex gap-2.5">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
            {purpose}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-500">
        {gbp(SITE_VISIT.feeGbp)}, and every penny comes off your install price. It&apos;s the one
        fixed step before installation. Nothing gets built without it.
      </p>
    </div>
  );

  const slotPicker = (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-semibold">How would you like to do it?</p>
        <div className="grid grid-cols-2 gap-2">
          {(["video", "in-person"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${
                mode === m
                  ? "border-accent-600 bg-accent-50 ring-2 ring-accent-100"
                  : "border-line bg-white hover:border-ink-300"
              }`}
            >
              <span className={`block font-semibold ${mode === m ? "text-accent-700" : ""}`}>
                {SITE_VISIT_MODE_LABEL[m]}
              </span>
              <span className="mt-0.5 block text-xs text-ink-300">
                {m === "video"
                  ? "A guided video call where you're the camera"
                  : "We come to you, for when access needs real eyes"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Pick a day</p>
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <button
              key={s.day}
              type="button"
              aria-pressed={day === s.day}
              onClick={() => setDay(s.day)}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                day === s.day
                  ? "border-accent-600 bg-accent-50 font-semibold text-accent-700"
                  : "border-line bg-white hover:border-ink-300"
              }`}
            >
              {fmtDay(s.day)}
            </button>
          ))}
        </div>
      </div>
      {day && (
        <div>
          <p className="mb-1.5 text-sm font-semibold">Pick a time</p>
          <div className="flex gap-2">
            {(slots.find((s) => s.day === day)?.times ?? []).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={time === t}
                onClick={() => setTime(t)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  time === t
                    ? "border-accent-600 bg-accent-50 font-semibold text-accent-700"
                    : "border-line bg-white hover:border-ink-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <StagePanel stage="site-visit" state={state}>
      {purposeList}

      {state === "upcoming" && (
        <LockedNote>
          Unlocks once your final quote is accepted, but this is exactly what booking will look
          like.
        </LockedNote>
      )}

      {canBook && (
        <>
          {slotPicker}
          <PrimaryButton
            onClick={() => {
              if (!slotIso) return;
              dispatch({ type: "book-site-visit", scheduledFor: slotIso, mode });
            }}
            disabled={!slotIso}
            busy={busy}
          >
            Book my site visit
          </PrimaryButton>
        </>
      )}

      {sv.status === "booked" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4">
            <InfoRow label="Booked for">{sv.scheduledFor ? fmtDayTime(sv.scheduledFor) : "-"}</InfoRow>
            <div className="mt-2 space-y-2">
              <InfoRow label="Format">{SITE_VISIT_MODE_LABEL[sv.mode]}</InfoRow>
              <InfoRow label="Fee">
                {sv.paymentStatus === "paid" ? (
                  <span className="text-sage-700">{gbp(sv.feeGbp)} paid ✓</span>
                ) : (
                  `${gbp(sv.feeGbp)} to confirm`
                )}
              </InfoRow>
            </div>
          </div>

          {sv.paymentStatus === "unpaid" && (
            <>
              <PrimaryButton onClick={() => dispatch({ type: "pay-site-visit" })} busy={busy}>
                Pay {gbp(sv.feeGbp)} &amp; confirm the slot
              </PrimaryButton>
              <p className="text-xs text-ink-300">
                Every penny comes off your install price. Card payments are coming soon, so for
                now this confirms your slot and we send you an invoice.
              </p>
            </>
          )}

          {rescheduling ? (
            <>
              {slotPicker}
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton
                  onClick={() => {
                    if (!slotIso) return;
                    dispatch({ type: "reschedule-site-visit", scheduledFor: slotIso });
                    setRescheduling(false);
                  }}
                  disabled={!slotIso}
                  busy={busy}
                >
                  Move it{moveFee > 0 ? ` (${gbp(moveFee)} change fee)` : " (free)"}
                </PrimaryButton>
                <GhostButton onClick={() => setRescheduling(false)}>Cancel</GhostButton>
              </div>
            </>
          ) : (
            <GhostButton onClick={() => setRescheduling(true)}>
              Need to move it?{moveFee > 0 ? ` (${gbp(moveFee)} this close)` : " (free right now)"}
            </GhostButton>
          )}
        </div>
      )}

      {sv.status === "completed" && sv.outcome && (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            sv.outcome.approvedForInstall
              ? "border-sage-200 bg-sage-50 text-sage-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <p className="font-semibold">
            {sv.outcome.approvedForInstall
              ? "✓ Approved for installation"
              : "A couple of things to resolve first"}
          </p>
          <p className="mt-1">{sv.outcome.summary}</p>
        </div>
      )}

      <ElectricsCard project={project} />
    </StagePanel>
  );
}

/** The power connection: assessed from the survey, settled at the site visit. */
export function ElectricsCard({ project }: { project: Project }) {
  const e = project.electrics;
  const chip =
    e.status === "validated"
      ? { cls: "bg-sage-50 text-sage-700", label: "Validated at site visit" }
      : e.status === "attention"
        ? { cls: "bg-amber-50 text-amber-700", label: "Needs a closer look" }
        : { cls: "bg-surface text-ink-500", label: "Provisional, confirmed at site visit" };

  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">⚡ Your power connection</p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.cls}`}>
          {chip.label}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-500">{e.summary}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Delivery                                                       */
/* ------------------------------------------------------------------ */

export function DeliveryPanel({ project, busy, dispatch }: PanelProps) {
  const state = stageState(project, "delivery");
  const d = project.delivery;
  const [newDate, setNewDate] = useState("");
  const canAdjust = d.status === "scheduled" && project.installation.status === "booked";
  const moveFee = d.expectedDate
    ? rescheduleFeeGbp("delivery", daysBetween(new Date().toISOString(), d.expectedDate))
    : 0;

  return (
    <StagePanel stage="delivery" state={state}>
      <Explainer stage="delivery" />

      {d.status === "pending" && (
        <LockedNote>
          Your delivery date gets set automatically when you book your install. Your kit lands
          two days before, and you can slide it from here.
        </LockedNote>
      )}

      {d.expectedDate && (
        <div className="rounded-2xl bg-surface/60 p-4">
          <InfoRow label="Expected delivery">{fmtDay(d.expectedDate)}</InfoRow>
          <div className="mt-2 space-y-2">
            {d.courier && <InfoRow label="Courier">{d.courier}</InfoRow>}
            {d.trackingRef && <InfoRow label="Tracking">{d.trackingRef}</InfoRow>}
          </div>
          {d.status === "scheduled" && (
            <p className="mt-3 text-xs text-ink-500">
              Courier tracking shows up here the moment your kit ships, and the time windows
              update straight from the courier&apos;s feed.
            </p>
          )}
        </div>
      )}

      {d.trackingEvents.length > 0 && (
        <ol className="space-y-3">
          {d.trackingEvents
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.at + event.label} className="flex gap-3 text-sm">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
                <span>
                  <span className="font-semibold">{event.label}</span>
                  {event.location && <span className="text-ink-500"> · {event.location}</span>}
                  <span className="block text-xs text-ink-300">{fmtDayTime(event.at)}</span>
                </span>
              </li>
            ))}
        </ol>
      )}

      {d.status === "delivered" && (
        <p className="rounded-2xl border border-sage-200 bg-sage-50 p-4 text-sm text-sage-800">
          ✓ Delivered. Leave everything boxed where it landed, your installer checks it all off
          on the day.
        </p>
      )}

      {canAdjust && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Need a different delivery day?</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              className={dateInputCls}
              value={newDate}
              min={isoDatePlus(DELIVERY_LEAD_DAYS)}
              max={project.installation.date}
              onChange={(e) => setNewDate(e.target.value)}
              aria-label="New delivery date"
            />
            <PrimaryButton
              onClick={() => newDate && dispatch({ type: "set-delivery-date", date: newDate })}
              disabled={!newDate}
              busy={busy}
            >
              Move delivery{moveFee > 0 ? ` (${gbp(moveFee)} fee)` : " (free)"}
            </PrimaryButton>
          </div>
          <p className="text-xs text-ink-300">
            Needs {DELIVERY_LEAD_DAYS}+ days for the courier, and must land at least the day
            before installation. Fees rise as the booked date gets close.
          </p>
        </div>
      )}
    </StagePanel>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Installation                                                   */
/* ------------------------------------------------------------------ */

export function InstallationPanel({ project, busy, dispatch }: PanelProps) {
  const state = stageState(project, "installation");
  const inst = project.installation;
  const [date, setDate] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const unlocked =
    project.siteVisit.status === "completed" && project.siteVisit.outcome?.approvedForInstall;
  const moveFee = inst.date
    ? rescheduleFeeGbp("installation", daysBetween(new Date().toISOString(), inst.date))
    : 0;

  const datePicker = (label: string, action: "book-installation" | "reschedule-installation") => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          className={dateInputCls}
          value={date}
          min={isoDatePlus(INSTALL_LEAD_DAYS)}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Installation date"
        />
        <PrimaryButton
          onClick={() => {
            if (!date) return;
            dispatch({ type: action, date });
            setRescheduling(false);
          }}
          disabled={!date}
          busy={busy}
        >
          {label}
        </PrimaryButton>
        {action === "reschedule-installation" && (
          <GhostButton onClick={() => setRescheduling(false)}>Cancel</GhostButton>
        )}
      </div>
      <p className="text-xs text-ink-300">
        At least {INSTALL_LEAD_DAYS} days out, the courier needs a head start. Booking sets your
        delivery for two days before, and you can tweak that on the delivery step.
      </p>
    </div>
  );

  return (
    <StagePanel stage="installation" state={state}>
      {inst.status !== "completed" && <Explainer stage="installation" />}

      {!unlocked && inst.status === "not-booked" && (
        <>
          <LockedNote>
            Your install date unlocks after the site visit. That one hour is what makes this day
            run like clockwork.
          </LockedNote>
          <div aria-disabled className="pointer-events-none opacity-50">
            {datePicker("Book installation day", "book-installation")}
          </div>
        </>
      )}

      {unlocked && inst.status === "not-booked" && (
        <>
          <p className="text-sm font-semibold">
            You&apos;re approved. Pick your install day.
          </p>
          {datePicker("Book installation day", "book-installation")}
        </>
      )}

      {inst.status === "booked" && inst.date && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sage-200 bg-sage-50 p-4">
            <InfoRow label="Installation day">{fmtDay(inst.date)}</InfoRow>
            <div className="mt-2 space-y-2">
              <InfoRow label="Duration">
                {inst.installDays === 1 ? "1 day (8am–5pm)" : `${inst.installDays} days`}
              </InfoRow>
              {project.delivery.expectedDate && (
                <InfoRow label="Kit arrives">{fmtDay(project.delivery.expectedDate)}</InfoRow>
              )}
            </div>
          </div>

          {rescheduling ? (
            datePicker(
              moveFee > 0 ? `Move it (${gbp(moveFee)} change fee)` : "Move it (free)",
              "reschedule-installation",
            )
          ) : (
            <GhostButton onClick={() => setRescheduling(true)}>
              Need to move it?{moveFee > 0 ? ` (${gbp(moveFee)} this close)` : " (free right now)"}
            </GhostButton>
          )}
        </div>
      )}

      {inst.installer ? (
        <div className="rounded-2xl border border-line p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
            Your installer
          </p>
          <p className="mt-1.5 font-bold">
            {inst.installer.name}{" "}
            <span className="font-normal text-ink-500">
              · {inst.installer.role} · {inst.installer.yearsExperience} yrs
            </span>
          </p>
          <p className="mt-1.5 text-sm text-ink-500">{inst.installer.bio}</p>
        </div>
      ) : (
        inst.status === "booked" && (
          <p className="text-sm text-ink-500">
            Your installer&apos;s profile lands here about a week before the day. Photo, name,
            track record, so you know exactly who&apos;s knocking.
          </p>
        )
      )}

      {inst.status !== "completed" && (
        <div>
          <p className="text-sm font-bold">Getting your home ready</p>
          <ul className="mt-2 space-y-2">
            {inst.prep.map((item) => (
              <li key={item.id} className="rounded-2xl border border-line p-3">
                <label className={`flex gap-3 ${item.confirmable ? "cursor-pointer" : ""}`}>
                  {item.confirmable ? (
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={(e) =>
                        dispatch({ type: "toggle-prep", itemId: item.id, done: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent-600"
                    />
                  ) : (
                    <span aria-hidden className="mt-0.5 w-4 shrink-0 text-center text-xs">
                      ℹ️
                    </span>
                  )}
                  <span className="text-sm">
                    <span className={`font-semibold ${item.done ? "text-ink-300 line-through" : ""}`}>
                      {item.label}
                    </span>
                    <span className="block text-xs text-ink-500">{item.detail}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ElectricsCard project={project} />

      {inst.status === "completed" && (
        <div className="rounded-2xl border border-sage-200 bg-sage-50 p-5 text-sage-800">
          <p className="font-display text-lg">You&apos;re installed 🎉</p>
          <p className="mt-1.5 text-sm">
            Warranty, commissioning data and care guides are on their way to your inbox, and
            they&apos;ll live in your portal, along with monitoring, once it opens.
          </p>
        </div>
      )}
    </StagePanel>
  );
}
