import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CANCELLATION_RULE_STATUS, REQUIREMENT_LABEL, ROLE_LABEL, type StepRequirement } from "@aircon/domain";
import { Badge, BlockerList, Card, Section, Stat, StatusChip } from "@/components/kit";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { loadBooking } from "@/lib/booking-server";
import { fmtDate, fmtDay, money } from "@/lib/format";
import { isUuid } from "@/lib/repo/base";
import { ActionForm } from "./_f5/action-form";
import { WrapBadge } from "./_f5/wrap-badge";
import { JobHeader } from "./_f5/job-header";
import { assignCrewAction, confirmBookingAction, earlyStartEvidenceAction, requestDepositAction, setDatesAction } from "./actions";
import { CrewForm, DatesForm } from "./booking-forms";

export const metadata: Metadata = { title: "Booking · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const REQS: StepRequirement[] = ["fgas", "electrical", "tech-lead"];

/**
 * Booking (schedule.edit): set the install block on the customer's behalf,
 * put a qualified crew together, take the deposit if settings ask for one,
 * record the early-start evidence, and confirm. The booking gate decides;
 * this page shows exactly what it's waiting for.
 */
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("schedule.edit");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireProjectAccess(id, { perm: "schedule.edit" });
  if (!access || access.kind !== "staff") notFound();
  const view = await loadBooking(id, staff);
  if (!view) notFound();

  const { project: p, settings } = view;
  const accepted = p.proposal.status === "accepted";
  const started = p.install.status !== "not-started";
  const booked = p.booking.status === "booked";
  const blocking = view.blockers.filter((b) => b.severity === "block");
  const depositRequired = settings.payments.depositPct > 0;
  const depositInvoice = view.deposit.invoice;

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
      <JobHeader
        project={p}
        current="booking"
        title="Booking"
        subtitle={booked ? `Booked for ${p.booking.dates.map(fmtDay).join(", ")}.` : "Dates, crew and deposit, then confirm."}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Booking" value={booked ? "Confirmed" : "Not confirmed"} tone={booked ? "success" : "neutral"} />
        <Stat
          label="Install dates"
          value={p.booking.dates.length ? `${fmtDay(p.booking.dates[0]!)}` : "Not set"}
          hint={p.booking.dates.length ? `${p.booking.dates.length} working day${p.booking.dates.length === 1 ? "" : "s"}` : `A ${p.booking.installDays}-day block`}
        />
        <Stat label="Crew" value={String(p.booking.crew.length)} hint={p.booking.crew.map((c) => c.name).join(", ") || "Nobody yet"} />
        <Stat
          label="Deposit"
          value={p.booking.depositStatus === "paid" ? "Paid" : p.booking.depositStatus === "requested" ? "Requested" : depositRequired ? "Not requested" : "None needed"}
          tone={p.booking.depositStatus === "paid" ? "success" : depositRequired ? "warn" : "neutral"}
          hint={depositInvoice ? `Invoice ${depositInvoice.number}` : depositRequired ? `${settings.payments.depositPct}% of the contract` : "Settings ask for no deposit"}
        />
      </div>

      {!accepted && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <p className="font-semibold text-amber-900">Waiting for the customer to accept the proposal.</p>
          <p className="mt-1 text-sm text-amber-900">
            Dates, crew and deposit open up once there&apos;s a signed contract.{" "}
            <Link className="font-semibold underline" href={`/ops/projects/${p.id}/proposal`}>
              Go to the proposal
            </Link>
          </p>
        </Card>
      )}

      {/* The one next step: confirm, or what stands in the way. */}
      <Section className="mt-8" title={booked ? "Booked" : "Confirm the booking"} description={booked ? "The customer has their dates and the team." : "The booking gate checks everything below before it lets this through."}>
        <Card>
          {booked ? (
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip status="booked" label="Booking confirmed" />
              <p className="text-sm text-ink-700">
                {p.booking.dates.map((d) => fmtDay(d)).join(" · ")}. Moving dates below re-tells the customer.
              </p>
            </div>
          ) : (
            <>
              <BlockerList
                blockers={view.blockers}
                empty={<p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Everything&apos;s in place: confirm and the customer is told.</p>}
              />
              <ActionForm flash
                action={confirmBookingAction.bind(null, p.id)}
                submitLabel="Confirm booking and tell the customer"
                busyLabel="Confirming…"
                disabled={!accepted || blocking.length > 0}
                confirm="Confirm the booking? The customer gets their dates and the team by email."
              />
            </>
          )}
        </Card>
      </Section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <Section title="Install dates" description={`A ${p.booking.installDays}-day block on working days. Customers can pick too; you can set it for them.`}>
          <Card>
            <DatesForm
              action={setDatesAction.bind(null, p.id)}
              earliest={view.earliestStart}
              current={p.booking.startDate}
              installDays={p.booking.installDays}
              workingDays={settings.scheduling.workingDays}
              locked={!accepted ? "Opens once the proposal is accepted." : started ? "The install has started, so the dates are fixed." : undefined}
            />
            {view.crewClashes.length > 0 && (
              <p role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                Double-booked: {view.crewClashes.map((c) => `${c.name} on ${fmtDay(c.date)} (${c.customer})`).join("; ")}.
              </p>
            )}
          </Card>
        </Section>

        <Section title="Cancellation and early start" description="Work starts after the cancellation period, or sooner only on the customer's written request.">
          <Card>
            <p className="text-sm text-ink-900">{accepted ? view.cancellation.copy : "Applies once the proposal is accepted."}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-500">Period ends</dt>
              <dd className="font-medium text-ink-900">{view.cancellation.endsOn ? fmtDate(view.cancellation.endsOn) : view.cancellation.basis === "goods-delivery" ? "14 days after the kit arrives" : "Not known yet"}</dd>
              <dt className="text-ink-500">Contract copy sent</dt>
              <dd className="font-medium text-ink-900">{p.proposal.confirmationSentAt ? fmtDate(p.proposal.confirmationSentAt) : "Not yet"}</dd>
              <dt className="text-ink-500">Early start</dt>
              <dd className="font-medium text-ink-900">
                {view.earlyStart.evidenced ? (
                  <Badge tone="success">Requested, evidence on file</Badge>
                ) : view.earlyStart.requested ? (
                  <Badge tone="warn">Ticked, no written request yet</Badge>
                ) : (
                  "Not requested"
                )}
              </dd>
            </dl>
            {accepted && !view.earlyStart.evidenced && !started && (
              <details className="mt-4 rounded-2xl border border-line bg-surface/50 px-4 py-3">
                <summary className="min-h-10 cursor-pointer text-sm font-semibold text-ink-900">Record the customer&apos;s written early-start request</summary>
                <p className="mt-2 text-xs text-ink-500">The customer&apos;s own email, or a signed form, with these words:</p>
                <blockquote className="mt-1 rounded-xl border-l-4 border-accent-500 bg-white px-3 py-2 text-sm text-ink-700">{view.earlyStart.wording}</blockquote>
                <ActionForm flash action={earlyStartEvidenceAction.bind(null, p.id)} submitLabel="Record the request" variant="secondary" className="mt-3" resetOnSuccess>
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-semibold text-ink-900">It came as</legend>
                    <div className="flex flex-wrap gap-4">
                      {(["email", "paper"] as const).map((c) => (
                        <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                          <input type="radio" name="channel" value={c} defaultChecked={c === "email"} className="h-4 w-4 accent-accent-600" />
                          {c === "email" ? "Their email" : "A signed form"}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label htmlFor="evidenceRef" className="mb-1.5 mt-3 block text-sm font-semibold text-ink-900">
                    Which one
                  </label>
                  <input id="evidenceRef" name="evidenceRef" required maxLength={200} placeholder="e.g. Email of 21 Oct, subject 'Start early'" className="min-h-12 w-full rounded-full border border-line bg-white px-4 text-base outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100" />
                </ActionForm>
              </details>
            )}
            {view.earlyStart.evidenced && (
              <p className="mt-3 text-xs text-ink-500">
                On file: {view.earlyStart.evidenceRef}
                {view.earlyStart.recordedBy ? `, recorded by ${view.earlyStart.recordedBy}` : ""}.
              </p>
            )}
            <p className="mt-4 text-xs text-ink-500">{CANCELLATION_RULE_STATUS}</p>
          </Card>
        </Section>
      </div>

      <Section className="mt-8" title="Crew" description="Each person's certificates are checked on the install dates. F-gas and Part P are required; a technical lead signs commissioning.">
        <Card>
          <ul className="mb-4 flex flex-wrap gap-2">
            {REQS.map((r) => {
              const covered = view.coverage[r].length > 0;
              return (
                <li key={r} className="max-w-full">
                  <WrapBadge tone={covered ? "success" : r === "tech-lead" ? "warn" : "danger"}>
                    {REQUIREMENT_LABEL[r]}: {covered ? view.coverage[r].join(", ") : "nobody on the crew"}
                  </WrapBadge>
                </li>
              );
            })}
          </ul>
          <CrewForm
            action={assignCrewAction.bind(null, p.id)}
            team={view.team}
            crew={p.booking.crew.map((c) => ({ staffId: c.staffId, role: c.role }))}
            checkOn={view.checkOn}
            locked={!accepted ? "Opens once the proposal is accepted." : started ? "The install has started." : undefined}
          />
          {p.booking.crew.some((c) => !view.team.some((t) => t.id === c.staffId)) && (
            <p className="mt-3 text-xs text-ink-500">
              Also on the job (not on the staff list):{" "}
              {p.booking.crew
                .filter((c) => !view.team.some((t) => t.id === c.staffId))
                .map((c) => `${c.name} (${ROLE_LABEL[c.role]})`)
                .join(", ")}
              . Saving the crew replaces them.
            </p>
          )}
        </Card>
      </Section>

      {(depositRequired || depositInvoice) && (
        <Section
          className="mt-8"
          title="Deposit"
          description={
            !depositRequired
              ? "Settings don't ask for a deposit now; this one was raised earlier."
              : settings.payments.depositTiming === "on-acceptance"
                ? "Needed before the booking is confirmed."
                : "Needed before the kit is ordered."
          }
        >
          <Card>
            {depositInvoice ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink-900">
                    Invoice {depositInvoice.number}: {money(depositInvoice.totalPence)}
                  </p>
                  <p className="text-sm text-ink-500">
                    Issued {depositInvoice.issuedAt ? fmtDate(depositInvoice.issuedAt) : ""}
                    {depositInvoice.paidPence > 0 ? `, ${money(depositInvoice.paidPence)} received` : ", nothing received yet"}.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusChip status={depositInvoice.status} />
                  <Link href={`/ops/projects/${p.id}/money`} className="text-sm font-semibold text-accent-700 underline">
                    Record a payment
                  </Link>
                </div>
              </div>
            ) : view.deposit.plan.available ? (
              <ActionForm flash
                action={requestDepositAction.bind(null, p.id)}
                submitLabel={`Send the deposit invoice (${money(view.deposit.plan.totalPence)})`}
                busyLabel="Issuing…"
                confirm={`Issue a deposit invoice for ${money(view.deposit.plan.totalPence)} and email it to the customer?`}
              >
                <input type="hidden" name="expectedTotal" value={(view.deposit.plan.totalPence / 100).toFixed(2)} />
                <p className="text-sm text-ink-700">
                  {settings.payments.depositPct}% of {money(p.money.contractTotalPence ?? 0)}: {money(view.deposit.plan.totalPence)}. The customer pays from their
                  payment page; nothing is marked paid until the money has actually arrived.
                </p>
              </ActionForm>
            ) : (
              <p className="text-sm text-ink-500">{view.deposit.plan.reason}</p>
            )}
          </Card>
        </Section>
      )}
    </main>
  );
}
