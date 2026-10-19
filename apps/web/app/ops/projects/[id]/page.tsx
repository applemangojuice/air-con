import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CANCELLATION_RULE_STATUS,
  GATE_LABEL,
  ISSUE_KIND_LABEL,
  LEARNING_PROMPTS,
  LEARNING_STATUS_LABEL,
  PROJECT_STAGES,
  ROLE_LABEL,
  STAGE_INFO,
  TIME_KIND_LABEL,
  can,
  diffAccuracyPct,
  cancellationCopy,
  cancellationStatus,
  currentStage,
  earlyStartRequestedOf,
  earlyStartWording,
  isOpen,
  nextGate,
  runsheetProgress,
  schedule2Missing,
  stageState,
  surveyCompleteness,
  type Issue,
} from "@aircon/domain";
import { Badge, StatusChip } from "@/components/kit/badge";
import { BlockerList } from "@/components/kit/blocker-list";
import { LinkButton } from "@/components/kit/button";
import { Money } from "@/components/kit/money";
import { fmtInstant, hoursLabel, mapsUrl, telHref, timeTotals, upcomingWorkingDays } from "@/components/ops/command/model";
import { Facts, MessageBody, Note, Quiet, SectionCard } from "@/components/ops/command/sections";
import {
  AssignSurveyorForm,
  BookSurveyForm,
  CancellationForm,
  CloseForm,
  ConsentForm,
  ContactForm,
  Disclosure,
  LearningForm,
  LearningStatusForm,
  NextActionForm,
  NoteForm,
  OwnerForm,
  PilotForm,
  RaiseIssueForm,
  ResendForm,
} from "@/components/ops/command/forms";
import { requireStaff } from "@/lib/auth/server";
import { ElectricalCertificateForms, WarrantyRegistrationForm } from "./certificate-forms";
import { EarlyStartForm } from "./early-start-form";
import { listDocuments } from "@/lib/documents-server";
import { fmtDate, fmtDay, fmtDayTime, fmtInstantDay } from "@/lib/format";
import { blockersByGate, issueKindDefaults, loadCommandRecords, selfSurveyDiff } from "@/lib/ops-core-server";
import { SelfSurveyDiff } from "@/components/field/survey/self-survey-diff";
import { buildReadinessContext, loadProject, londonToday } from "@/lib/project-service";
import { listForProject as messagesForProject } from "@/lib/repo/messages";
import { getSettings } from "@/lib/settings-server";
import {
  addLearningAction,
  addNoteAction,
  assignSurveyorAction,
  bookSurveyAction,
  cancellationAction,
  closeProjectAction,
  documentsConsentAction,
  earlyStartEvidenceAction,
  electricalCertAction,
  raiseIssueAction,
  resendMessageAction,
  setContactAction,
  setLearningStatusAction,
  setNextActionAction,
  setOwnerAction,
  setPilotAction,
  warrantyRegisteredAction,
} from "./actions";

export const metadata: Metadata = { title: "Project · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const plain = (s: string) => {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : s;
};

const NAV = [
  ["blocking", "Blocking"],
  ["survey", "Survey"],
  ["design", "Design"],
  ["proposal", "Proposal"],
  ["booking", "Booking"],
  ["kit", "Kit"],
  ["compliance", "Compliance"],
  ["install", "Install"],
  ["handover", "Handover"],
  ["money", "Money"],
  ["issues", "Issues"],
  ["time", "Time"],
  ["learnings", "Learnings"],
  ["documents", "Documents"],
  ["messages", "Messages"],
  ["activity", "Activity"],
] as const;

export default async function CommandCentrePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff("projects.view-all");
  const { id } = await params;
  const sp = await searchParams;
  const justCreated = sp.created === "1";
  const linkNote = sp.link === "sent" ? " A link to their project is on its way to them." : sp.link === "unsent" ? " No link was sent: email isn't set up, so check Messages before telling them to expect one." : "";
  const areaNote = sp.area === "outside" ? " Their postcode is outside the service area in Settings." : "";
  if (!UUID_RE.test(id)) notFound();
  const project = await loadProject(id);
  if (!project) notFound();

  const [ctx, settings, rec, documents, messages] = await Promise.all([
    buildReadinessContext(project, staff),
    getSettings(),
    loadCommandRecords(project),
    listDocuments(id, { includeSuperseded: true }),
    messagesForProject(id, 100),
  ]);
  const p = project;
  const today = londonToday();
  const canEdit = can(staff, "projects.edit");
  const canMargin = can(staff, "finance.view-margin");
  const canSend = can(staff, "messages.send");
  const stage = currentStage(p);
  const gate = nextGate(p);
  const groups = blockersByGate(p, ctx);
  const nextGroup = groups.find((g) => g.gate === gate);
  const laterGroups = groups.filter((g) => g.gate !== gate);
  const demo = /\(DEMO\)/.test(p.customer.name) || rec.quoteSource === "demo";

  const activeStaff = rec.staff.filter((s) => s.active);
  const staffOptions = activeStaff.map((s) => ({ id: s.id, name: s.name }));
  const surveyors = activeStaff.filter((s) => can(s, "survey.conduct")).map((s) => ({ id: s.id, name: s.name }));
  const bind = <A extends unknown[], R>(fn: (projectId: string, ...rest: A) => R) => fn.bind(null, id) as (...rest: A) => R;

  // Survey
  const slotDates = upcomingWorkingDays(today, settings.scheduling.workingDays, 10);
  const slotFmt = Object.fromEntries(slotDates.map((d) => [d, fmtDay(d)]));
  const diff = selfSurveyDiff(rec.selfSurvey, rec.survey);
  const completeness = rec.survey ? surveyCompleteness(rec.survey.data).pct : null;
  // Proposal
  const s2 = schedule2Missing(settings);
  const proposalOpen = p.proposal.status !== "accepted";
  // Booking
  const cs = cancellationStatus(p, today, settings);
  const earlyRequested = earlyStartRequestedOf(p);
  // Install
  const progress = rec.job ? runsheetProgress(rec.job) : null;
  // Money
  const outstanding = Math.max(0, p.money.invoicedPence - p.money.paidPence);
  // The deposit as the booking gate sees it: due from the contract and settings
  // before anyone has invoiced it, so "Not required" never shows while it blocks.
  const depositDue = ctx.money?.depositDuePence ?? 0;
  const depositPaid = ctx.money?.depositPaidPence ?? 0;
  const depositFact: ReactNode =
    p.booking.depositStatus === "paid" || (depositDue > 0 && depositPaid >= depositDue) ? (
      "Paid"
    ) : depositDue > 0 ? (
      <span key="d">
        <Money pence={depositDue} /> due{depositPaid > 0 ? <>, <Money pence={depositPaid} /> paid</> : null}
        {p.booking.depositStatus === "requested" ? " (invoiced)" : " (not invoiced yet)"}
      </span>
    ) : (
      plain(p.booking.depositStatus)
    );
  // Issues
  const openIssues = rec.issues.filter(isOpen);
  const kindDefaults = issueKindDefaults();
  // Time
  const totals = timeTotals(rec.time);
  const recentTime = [...rec.time].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5);
  // Activity
  const events = [...p.events].reverse();

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {/* Header */}
      <Link href="/ops/projects" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900">
        <span aria-hidden>←</span> Board
      </Link>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {p.pilot && (
              <Badge tone="accent">
                Pilot {p.pilot.number} · {p.pilot.label}
              </Badge>
            )}
            {demo && <Badge tone="warn">DEMO</Badge>}
            {p.closure.closed ? (
              <StatusChip status={p.closure.reason === "cancelled" ? "cancelled" : "closed"} />
            ) : (
              <Badge tone="info" dot>
                {STAGE_INFO[stage].label}
              </Badge>
            )}
          </div>
          <h1 className="font-display text-3xl leading-tight text-ink-900 sm:text-4xl">{p.customer.name || "Unnamed customer"}</h1>
          <p className="mt-1.5 text-base text-ink-700">
            <a href={mapsUrl(p.customer.addressLine, p.customer.postcode)} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-4 hover:text-accent-700">
              {[p.customer.addressLine, p.customer.postcode].filter(Boolean).join(", ") || "No address"}
            </a>
          </p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {p.customer.phone ? (
              <a href={telHref(p.customer.phone)} className="font-semibold text-accent-700 hover:underline">
                {p.customer.phone}
              </a>
            ) : (
              <span className="text-ink-500">No phone</span>
            )}
            {p.customer.email ? (
              <a href={`mailto:${p.customer.email}`} className="break-all font-semibold text-accent-700 hover:underline">
                {p.customer.email}
              </a>
            ) : (
              <span className="font-semibold text-red-700">No email: proposals can&apos;t be issued</span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Started {fmtDate(p.createdAt)} · {p.quoteSummary.roomCount} room{p.quoteSummary.roomCount === 1 ? "" : "s"} · instant price <Money pence={Math.round(p.quoteSummary.totalGbp * 100)} />
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <LinkButton href={`/p/${p.id}`} variant="secondary">
            Customer view
          </LinkButton>
          {UUID_RE.test(p.quoteId) && (
            <LinkButton href={`/ops/quotes/${p.quoteId}`} variant="ghost">
              Original quote
            </LinkButton>
          )}
        </div>
      </header>

      {justCreated && (
        <p role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="font-semibold">Pilot set up.</span>
          {linkNote}
          {areaNote} Next: book their survey below, or let them pick a slot from their project page.
        </p>
      )}

      {/* Stage strip */}
      <ol className="relative mt-5 flex gap-1.5 overflow-x-auto pb-1" aria-label="Stages">
        {PROJECT_STAGES.map((s, i) => {
          const state = stageState(p, s);
          return (
            <li
              key={s}
              aria-current={state === "current" ? "step" : undefined}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                state === "complete"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : state === "current"
                    ? "border-accent-500 bg-accent-50 text-accent-700"
                    : "border-line bg-white text-ink-500"
              }`}
            >
              <span aria-hidden>{state === "complete" ? "✓ " : `${i + 1} `}</span>
              {STAGE_INFO[s].label}
              <span className="sr-only"> ({state})</span>
            </li>
          );
        })}
      </ol>

      {/* Owner + next action */}
      <div className="mt-5 grid gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5 lg:grid-cols-[16rem_1fr]">
        {canEdit ? (
          <>
            <OwnerForm action={bind(setOwnerAction)} staff={staffOptions} current={p.owner?.staffId} />
            <NextActionForm action={bind(setNextActionAction)} current={p.nextAction} />
          </>
        ) : (
          <>
            <Facts items={[["Owner", p.owner?.name]]} />
            <Facts items={[["Next action", p.nextAction?.text], ["Due", p.nextAction?.dueOn ? fmtDate(p.nextAction.dueOn) : null]]} />
          </>
        )}
      </div>

      {/* In-page nav */}
      <nav aria-label="Sections" className="-mx-4 mt-5 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1.5 lg:min-w-0 lg:flex-wrap">
          {NAV.map(([href, label]) => (
            <li key={href}>
              <a href={`#${href}`} className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink-700 hover:border-ink-300 hover:text-ink-900">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {/* What's blocking */}
          <section id="blocking" aria-labelledby="blocking-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="blocking-title" className="font-display text-xl text-ink-900">
                What&apos;s blocking
              </h2>
              {gate ? <p className="text-sm text-ink-500">Next gate: {GATE_LABEL[gate]}</p> : <p className="text-sm text-ink-500">All gates passed</p>}
            </div>
            <div className="mt-3">
              {p.closure.closed ? (
                <>
                  <Quiet>This project is closed{p.closure.closedAt ? ` (${fmtDate(p.closure.closedAt)})` : ""}. Nothing blocks it.</Quiet>
                  {p.cancellation && (
                    <Note tone="warn">
                      Cancelled by the customer: received {fmtDate(p.cancellation.receivedAt)} by {p.cancellation.channel} ({p.cancellation.evidenceRef}). Refund due by{" "}
                      {fmtDate(p.cancellation.refundDueBy)}.{p.cancellation.withinPeriod ? "" : " It arrived after the cancellation period ended: take advice before refunding."}
                    </Note>
                  )}
                </>
              ) : (
                <BlockerList
                  blockers={nextGroup?.blockers ?? []}
                  empty={
                    <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      Nothing stands in the way of {gate ? GATE_LABEL[gate].toLowerCase() : "the next step"}.
                    </p>
                  }
                />
              )}
              {gate && nextGroup && <BlockerLinks blockers={nextGroup.blockers.map((b) => b.code)} projectId={id} />}
              {/* Ready to close: the one next action, here rather than only in the Admin panel. */}
              {gate === "closed" && !p.closure.closed && canEdit && (nextGroup?.blockers ?? []).every((b) => b.severity !== "block") && (
                <div className="mt-3 rounded-2xl border border-line bg-surface/40 p-3">
                  <CloseForm action={bind(closeProjectAction)} contracted={p.proposal.status === "accepted"} />
                </div>
              )}
            </div>
            {laterGroups.length > 0 && (
              <Disclosure summary={`Later gates (${laterGroups.reduce((n, g) => n + g.blockers.length, 0)} items)`} className="mt-3">
                <div className="space-y-4">
                  {laterGroups.map((g) => (
                    <div key={g.gate}>
                      <h3 className="mb-2 text-sm font-semibold text-ink-900">{GATE_LABEL[g.gate]}</h3>
                      <BlockerList blockers={g.blockers} />
                    </div>
                  ))}
                </div>
              </Disclosure>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Survey */}
            <SectionCard id="survey" title="Survey" status={p.survey.status} primary={{ href: `/field/survey/${id}`, label: p.survey.status === "submitted" ? "Open the survey" : "Open the survey app" }}>
              <Facts
                items={[
                  ["When", p.survey.scheduledFor ? `${fmtDayTime(p.survey.scheduledFor)} (${p.survey.mode === "video" ? "video" : "in person"})` : null],
                  ["Surveyor", p.survey.surveyor?.name],
                  ["Record", rec.survey ? `v${rec.survey.version}, ${rec.survey.status}${completeness !== null ? `, ${completeness}% complete` : ""}` : null],
                  ["Submitted", p.survey.submittedAt ? fmtInstant(p.survey.submittedAt) : null],
                ]}
              />
              {canEdit && p.survey.status !== "submitted" && p.survey.status !== "in-progress" && (
                <Disclosure summary={p.survey.status === "booked" ? "Move the survey" : "Book it for the customer"} open={p.survey.status === "not-booked"}>
                  <BookSurveyForm
                    action={bind(bookSurveyAction)}
                    dates={slotDates}
                    slots={settings.scheduling.surveySlotTimes.length ? settings.scheduling.surveySlotTimes : ["10:00"]}
                    surveyors={surveyors}
                    moving={p.survey.status === "booked"}
                    fmt={slotFmt}
                  />
                </Disclosure>
              )}
              {canEdit && p.survey.status !== "submitted" && (
                <Disclosure summary={p.survey.surveyor ? "Change surveyor" : "Assign a surveyor"}>
                  <AssignSurveyorForm action={bind(assignSurveyorAction)} surveyors={surveyors} current={p.survey.surveyor?.staffId} />
                </Disclosure>
              )}
              <Disclosure summary={`Customer's own survey vs measured${"rows" in diff && diffAccuracyPct(diff.rows) !== null ? ` (${diffAccuracyPct(diff.rows)}% right)` : ""}`}>
                {"rows" in diff ? <SelfSurveyDiff rows={diff.rows} compact /> : <Quiet>{diff.unavailable}</Quiet>}
              </Disclosure>
            </SectionCard>

            {/* Design */}
            <SectionCard id="design" title="Design" status={p.design.status} primary={{ href: `/ops/projects/${id}/design`, label: p.design.status === "not-started" ? "Start the design" : "Open the design" }}>
              <Facts
                items={[
                  ["Version", p.design.version ? `v${p.design.version}` : null],
                  ["Signed off", p.design.approvedBy ? `${p.design.approvedBy}, ${p.design.approvedAt ? fmtInstant(p.design.approvedAt) : ""}` : null],
                  ["Compatibility", ctx.design ? (ctx.design.compatibilityErrors.length ? `${ctx.design.compatibilityErrors.length} problem${ctx.design.compatibilityErrors.length === 1 ? "" : "s"}` : "No errors") : null],
                ]}
              />
              {p.survey.status !== "submitted" && <Quiet>The design starts once the survey is submitted.</Quiet>}
            </SectionCard>

            {/* Proposal */}
            <SectionCard id="proposal" title="Proposal" status={p.proposal.status} primary={{ href: `/ops/projects/${id}/proposal`, label: p.proposal.status === "not-issued" ? "Build the proposal" : "Open the proposal" }}>
              <Facts
                items={[
                  ["Version", p.proposal.version ? `v${p.proposal.version}${p.proposal.optionCount ? `, ${p.proposal.optionCount} option${p.proposal.optionCount === 1 ? "" : "s"}` : ""}` : null],
                  ["Issued", p.proposal.issuedAt ? fmtInstant(p.proposal.issuedAt) : null],
                  ["Valid until", p.proposal.validUntil ? fmtDate(p.proposal.validUntil) : null],
                  ["Viewed", p.proposal.viewedAt ? fmtInstant(p.proposal.viewedAt) : p.proposal.issuedAt ? "Not yet" : null],
                  ["Accepted", p.proposal.acceptedAt ? `${p.proposal.acceptedOptionLabel ?? ""}, ${fmtInstant(p.proposal.acceptedAt)}` : null],
                  ["Contract", p.proposal.contractTotalPence !== undefined ? <Money key="c" pence={p.proposal.contractTotalPence} /> : null],
                  ["Documents by email", p.proposal.documentsByEmailConsent ? `Agreed (${p.proposal.documentsByEmailConsent.channel}), ${fmtInstant(p.proposal.documentsByEmailConsent.at)}` : <span key="n" className="font-semibold text-amber-800">Not agreed yet</span>],
                ]}
              />
              {p.proposal.changeRequest && <Note tone="warn">They asked: “{p.proposal.changeRequest}”</Note>}
              {p.proposal.declineReason && <Note tone="danger">Declined: “{p.proposal.declineReason}”</Note>}
              {canMargin && rec.proposal && rec.proposal.options.length > 0 && (
                <div className="rounded-xl bg-surface px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Margin (team only)</p>
                  <ul className="mt-1 space-y-0.5">
                    {rec.proposal.options.map((o) => (
                      <li key={o.id} className="flex flex-wrap justify-between gap-2">
                        <span>{o.label}</span>
                        <span className={o.pricing?.belowMinMargin ? "font-semibold text-red-700" : "text-ink-900"}>
                          {o.pricing ? (
                            <>
                              <Money pence={o.pricing.totalPence} /> · {o.pricing.grossMarginPct.toFixed(1)}%{o.pricing.belowMinMargin ? " (below minimum)" : ""}
                            </>
                          ) : (
                            "Not priced"
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposalOpen && s2.length > 0 && (
                <Note tone="danger">
                  Proposals can&apos;t be issued until settings have: {s2.join(", ")}.{" "}
                  <Link href="/ops/settings#company" className="font-semibold underline">
                    Fill them in
                  </Link>
                </Note>
              )}
              {canEdit && proposalOpen && !p.proposal.documentsByEmailConsent && <ConsentForm action={bind(documentsConsentAction)} />}
            </SectionCard>

            {/* Booking */}
            <SectionCard id="booking" title="Booking and crew" status={p.booking.status} primary={{ href: `/ops/projects/${id}/booking`, label: "Dates, crew and deposit", note: "The calendar shows every job" }}>
              <Facts
                items={[
                  ["Dates", p.booking.dates.length ? p.booking.dates.map((d) => fmtDay(d)).join(", ") : null],
                  ["Crew", p.booking.crew.length ? p.booking.crew.map((c) => crewLabel(c.name, ROLE_LABEL[c.role], c.external)).join("; ") : null],
                  ["Deposit", depositFact],
                  ["Prep ticked", `${p.booking.prep.filter((i) => i.confirmable && i.done).length} of ${p.booking.prep.filter((i) => i.confirmable).length}`],
                ]}
              />
              {p.proposal.status === "accepted" && (
                <div className="space-y-2">
                  <p>
                    <span className="font-semibold text-ink-900">Cancellation (as the customer reads it): </span>
                    {cancellationCopy(p, { settings, today })}
                    {cs.earlyStartEvidenced && " Early start is on file, so work can start sooner."}
                  </p>
                  <p className="text-xs text-ink-500">{CANCELLATION_RULE_STATUS}</p>
                  {p.proposal.earlyStart?.evidencedAt ? (
                    <Note tone="success">
                      Early start on file ({p.proposal.earlyStart.channel === "paper" ? "signed form" : "email"}: {p.proposal.earlyStart.evidenceRef}
                      {p.proposal.earlyStart.receivedOn ? `, received ${fmtDay(p.proposal.earlyStart.receivedOn)}` : ""}
                      {p.proposal.earlyStart.fromAddress ? ` from ${p.proposal.earlyStart.fromAddress}` : ""}
                      {p.proposal.earlyStart.mediaIds?.length ? `; copy stored with the project's files` : ""}), recorded by {p.proposal.earlyStart.recordedBy}.
                    </Note>
                  ) : (
                    canEdit &&
                    p.install.status === "not-started" && (
                      <Disclosure summary={earlyRequested ? "Record their early-start email or form" : "They've asked to start early"} open={earlyRequested}>
                        <EarlyStartForm
                          action={bind(earlyStartEvidenceAction)}
                          requested={earlyRequested}
                          projectId={id}
                          today={today}
                          wording={earlyStartWording(p.proposal.contractType)}
                          {...(p.customer.email ? { customerEmail: p.customer.email } : {})}
                        />
                      </Disclosure>
                    )
                  )}
                  {!p.proposal.confirmationSentAt && <Note tone="warn">The contract confirmation email hasn&apos;t been delivered yet, so the install can&apos;t start. Check Messages below and resend it.</Note>}
                </div>
              )}
            </SectionCard>

            {/* Kit */}
            <SectionCard id="kit" title="Kit" status={p.kit.status} primary={{ href: `/ops/projects/${id}/kit`, label: rec.purchaseOrders.length ? "Open purchase orders" : "Raise purchase orders" }}>
              <Facts
                items={[
                  ["Expected", p.kit.expectedDate ? fmtDate(p.kit.expectedDate) : null],
                  ["Delivered", p.kit.deliveredAt ? fmtInstant(p.kit.deliveredAt) : null],
                  ["Checked", p.kit.inspectedAt ? fmtInstant(p.kit.inspectedAt) : null],
                  ["Orders", rec.purchaseOrders.length ? rec.purchaseOrders.map((po) => `${po.supplier} (${plain(po.status)})`).join(", ") : null],
                  ["Shortages", p.kit.shortages ? String(p.kit.shortages) : "None recorded"],
                ]}
              />
              {p.kit.summary && <Quiet>{p.kit.summary}</Quiet>}
            </SectionCard>

            {/* Compliance */}
            <SectionCard id="compliance" title="Compliance" primary={{ href: `/ops/projects/${id}/compliance`, label: "Open the checklist" }}>
              {rec.compliance.length === 0 ? (
                <Note tone="warn">The compliance checklist hasn&apos;t been set up for this project yet.</Note>
              ) : (
                <ComplianceSummary items={rec.compliance} />
              )}
            </SectionCard>

            {/* Install */}
            <SectionCard id="install" title="Install" status={p.install.status} primary={{ href: `/field/jobs/${id}`, label: "Open the job in the field app" }}>
              {p.install.days.length > 0 ? (
                <ul className="space-y-1">
                  {p.install.days.map((d) => (
                    <li key={d.n} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Day {d.n} · {fmtDay(d.date)}
                      </span>
                      <StatusChip status={d.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <Facts items={[["Planned", p.booking.dates.length ? `${p.booking.dates.length} days from ${fmtDay(p.booking.dates[0]!)}` : null]]} />
              )}
              {rec.job ? (
                progress ? (
                  <Facts
                    items={[
                      ["Runsheet", progress.byDay.map((b) => `Day ${b.day}: ${b.done}/${b.total}`).join(" · ") || "No steps"],
                      ["Missing", String(progress.missing)],
                      ["Blocked", String(progress.blocked)],
                      ["Exceptions", progress.openExceptions ? `${progress.openExceptions} waiting for the technical lead` : "None open"],
                      ["Evidence", `${rec.job.evidence.length} capture${rec.job.evidence.length === 1 ? "" : "s"}`],
                    ]}
                  />
                ) : (
                  <Facts items={[["Evidence", `${rec.job.evidence.length} capture${rec.job.evidence.length === 1 ? "" : "s"}`], ["Runsheet", `${rec.job.runsheet.length} steps (progress shows once the field app is live)`]]} />
                )
              ) : (
                <Quiet>No install job yet. It&apos;s created from the approved design.</Quiet>
              )}
            </SectionCard>

            {/* Handover */}
            <SectionCard id="handover" title="Handover" status={p.handover.status}>
              <Facts
                items={[
                  ["Commissioned", p.handover.commissionedAt ? `${p.handover.commissionedBy ?? ""}, ${fmtInstant(p.handover.commissionedAt)}` : null],
                  [
                    "Handover pack",
                    p.handover.packDocumentId ? (
                      <Link key="pack" href={`/d/${p.handover.packDocumentId}`} className="font-semibold text-accent-700 hover:underline">
                        Open the pack
                      </Link>
                    ) : null,
                  ],
                  ["Customer sign-off", p.handover.signoff ? `${p.handover.signoff.name}: ${p.handover.signoff.outcome === "all-good" ? "all good" : `${p.handover.signoff.snagCount} snag${p.handover.signoff.snagCount === 1 ? "" : "s"}`}` : null],
                  [
                    "Electrical certificate",
                    <span key="ec" className="inline-flex flex-wrap items-center gap-2">
                      <StatusChip status={p.handover.electricalCert} />
                      {p.handover.electricalCertDocumentId && (
                        <Link href={`/d/${p.handover.electricalCertDocumentId}`} className="font-semibold text-accent-700 hover:underline">
                          Open it
                        </Link>
                      )}
                    </span>,
                  ],
                  ["Warranty", p.handover.warrantyRegistered ? "Registered" : p.handover.warrantyDueOn ? `Register by ${fmtDate(p.handover.warrantyDueOn)}` : "Not registered"],
                ]}
              />
              {canEdit && (
                <>
                  <ElectricalCertificateForms action={bind(electricalCertAction)} projectId={id} current={p.handover.electricalCert} />
                  {!p.handover.warrantyRegistered && <WarrantyRegistrationForm action={bind(warrantyRegisteredAction)} projectId={id} />}
                </>
              )}
            </SectionCard>

            {/* Money */}
            <SectionCard id="money" title="Money" primary={{ href: `/ops/projects/${id}/money`, label: "Invoices and payments" }}>
              <Facts
                items={[
                  ["Contract", p.money.contractTotalPence !== undefined ? <Money key="c" pence={p.money.contractTotalPence} /> : null],
                  ["Invoiced", <Money key="i" pence={p.money.invoicedPence} />],
                  ["Paid", <Money key="p" pence={p.money.paidPence} />],
                  ["Outstanding", <Money key="o" pence={outstanding} className={outstanding > 0 ? "font-semibold text-amber-800" : ""} />],
                  ...(p.money.changeFeesPence ? ([["Change fees", <Money key="f" pence={p.money.changeFeesPence} />]] as [string, ReactNode][]) : []),
                ]}
              />
              {rec.invoices.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {rec.invoices.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="font-semibold text-ink-900">
                        {inv.number} <span className="font-normal text-ink-500">{plain(inv.kind)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Money pence={inv.totalPence} />
                        <StatusChip status={inv.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {p.handover.status === "handed-over" && (
              <SectionCard id="aftercare" title="Aftercare">
                <Facts
                  items={[
                    ["7-day check-in", p.aftercare.checkIn7dSentAt ? fmtInstant(p.aftercare.checkIn7dSentAt) : null],
                    ["30-day feedback", p.aftercare.feedback ? `${p.aftercare.feedback.score}/10` : p.aftercare.feedbackRequestedAt ? "Asked, no answer yet" : null],
                    ["Review request", p.aftercare.reviewRequestedAt ? fmtInstant(p.aftercare.reviewRequestedAt) : settings.company.reviewUrl ? null : "Off (no review link in settings)"],
                    ["Season check", p.aftercare.seasonalCheckSentAt ? fmtInstant(p.aftercare.seasonalCheckSentAt) : null],
                    ["Service due", p.aftercare.serviceDueOn ? fmtDate(p.aftercare.serviceDueOn) : null],
                    ["Follow-ups", p.aftercare.followUpsOptedOutAt ? "Opted out" : "On"],
                  ]}
                />
                {p.aftercare.feedback?.comments && <Quiet>“{p.aftercare.feedback.comments}”</Quiet>}
              </SectionCard>
            )}
          </div>

          {/* Issues */}
          <section id="issues" aria-labelledby="issues-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="issues-title" className="font-display text-xl text-ink-900">
                Issues <span className="text-base text-ink-500">({openIssues.length} open)</span>
              </h2>
              <Link href={`/ops/projects/${id}/issues`} className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-700 hover:underline">
                All issues and status changes →
              </Link>
            </div>
            {openIssues.length === 0 ? (
              <Quiet>No open issues.</Quiet>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {openIssues.map((i) => (
                  <IssueRow key={i.id} issue={i} />
                ))}
              </ul>
            )}
            {canEdit && (
              <Disclosure summary="Raise an issue" className="mt-3">
                <RaiseIssueForm action={bind(raiseIssueAction)} defaults={kindDefaults} />
              </Disclosure>
            )}
          </section>

          {/* Time */}
          <section id="time" aria-labelledby="time-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="time-title" className="font-display text-xl text-ink-900">
                Time <span className="text-base text-ink-500">({hoursLabel(totals.totalMinutes)} logged)</span>
              </h2>
              <Link href={`/ops/projects/${id}/time`} className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-700 hover:underline">
                Full log and add time →
              </Link>
            </div>
            {rec.time.length === 0 ? (
              <Quiet>No time logged yet. The field app logs arrive, pause and leave; add anything else by hand.</Quiet>
            ) : (
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">By person</h3>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {totals.byPerson.map((x) => (
                      <li key={x.name} className="flex justify-between gap-2">
                        <span>{x.name}</span>
                        <span className="tabular-nums">{hoursLabel(x.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">By kind</h3>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {totals.byKind.map((x) => (
                      <li key={x.kind} className="flex justify-between gap-2">
                        <span>{x.label}</span>
                        <span className="tabular-nums">{hoursLabel(x.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="sm:col-span-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Latest</h3>
                  <ul className="mt-1 divide-y divide-line text-sm">
                    {recentTime.map((t) => (
                      <li key={t.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span>
                          {t.staffName} · {TIME_KIND_LABEL[t.kind]}
                          {t.dayN ? ` (day ${t.dayN})` : ""}
                        </span>
                        <span className="text-ink-500">
                          {fmtInstant(t.startedAt)} · {t.endedAt || t.minutes !== undefined ? hoursLabel(t.minutes ?? (Date.parse(t.endedAt!) - Date.parse(t.startedAt)) / 60000) : "running"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {totals.running > 0 && <p className="mt-2 text-xs text-amber-800">{totals.running} clock{totals.running === 1 ? " is" : "s are"} still running.</p>}
          </section>

          {/* Learnings */}
          <section id="learnings" aria-labelledby="learnings-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <h2 id="learnings-title" className="font-display text-xl text-ink-900">
              Learnings <span className="text-base text-ink-500">({rec.learnings.filter((l) => l.status === "open").length} open)</span>
            </h2>
            {rec.learnings.length === 0 ? (
              <Quiet>Nothing yet. End-of-day prompts in the field app land here, or add one below.</Quiet>
            ) : (
              <ul className="mt-2 space-y-3">
                {rec.learnings.map((l) => (
                  <li key={l.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-ink-500">
                        {l.author.name} · {fmtInstant(l.createdAt)}
                        {l.stage ? ` · ${STAGE_INFO[l.stage].label}` : ""}
                        {l.dayN ? ` · day ${l.dayN}` : ""}
                      </p>
                      <Badge tone={l.status === "open" ? "warn" : l.status === "applied" ? "success" : "neutral"}>{LEARNING_STATUS_LABEL[l.status]}</Badge>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-sm">
                      {l.answers.map((a) => (
                        <div key={a.promptId}>
                          <dt className="text-xs font-semibold text-ink-500">{LEARNING_PROMPTS.find((x) => x.id === a.promptId)?.question ?? a.promptId}</dt>
                          <dd className="text-ink-900">{a.answer}</dd>
                        </div>
                      ))}
                    </dl>
                    {l.tags.length > 0 && <p className="mt-1 text-xs text-ink-500">Tags: {l.tags.join(", ")}</p>}
                    {l.appliedNote && <p className="mt-1 text-sm text-emerald-800">Changed: {l.appliedNote}</p>}
                    {canEdit && (
                      <div className="mt-2">
                        <LearningStatusForm action={setLearningStatusAction} learningId={l.id} status={l.status} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <Disclosure summary="Add a learning" className="mt-3">
                <LearningForm action={bind(addLearningAction)} stage={stage} />
              </Disclosure>
            )}
          </section>

          {/* Documents */}
          <section id="documents" aria-labelledby="documents-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <h2 id="documents-title" className="font-display text-xl text-ink-900">
              Documents
            </h2>
            {documents.length === 0 ? (
              <Quiet>No documents yet. Proposals, contracts, invoices and the handover pack appear here as they&apos;re made.</Quiet>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/d/${d.id}`} className="min-w-0 font-semibold text-accent-700 hover:underline">
                      {d.title}
                    </Link>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span className="font-mono">{d.ref}</span>
                      <StatusChip status={d.status} />
                      {d.customerVisible ? <Badge tone="info">Customer sees it</Badge> : <Badge>Team only</Badge>}
                      <span>{fmtDate(d.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Messages */}
          <section id="messages" aria-labelledby="messages-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="messages-title" className="font-display text-xl text-ink-900">
                Messages
              </h2>
              <Link href="/ops/messages" className="inline-flex min-h-10 items-center text-sm font-semibold text-accent-700 hover:underline">
                All messages →
              </Link>
            </div>
            {messages.length === 0 ? (
              <Quiet>Nothing sent yet.</Quiet>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {messages.map((m) => (
                  <li key={m.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 text-sm">
                        <span className="font-semibold text-ink-900">{plain(m.event)}</span>
                        <span className="text-ink-500">
                          {" "}
                          · {m.channel === "sms" ? "SMS" : "Email"} to <span className="break-all">{m.to}</span>
                        </span>
                      </p>
                      <span className="flex items-center gap-2 text-xs text-ink-500">
                        {fmtInstant(m.sentAt ?? m.createdAt)}
                        <StatusChip status={m.status} />
                      </span>
                    </div>
                    {m.error && m.status !== "sent" && <p className="mt-1 text-xs text-red-700">{m.error}</p>}
                    <Disclosure summary="Preview">
                      <MessageBody html={m.channel === "email" ? m.bodyHtml : undefined} text={m.bodyText} subject={m.subject} />
                      {canSend && m.event !== "magic-link" && (
                        <div className="mt-2">
                          <ResendForm action={resendMessageAction} messageId={m.id} label={m.status === "sent" ? "Send again" : "Retry"} />
                        </div>
                      )}
                    </Disclosure>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Activity */}
          <section id="activity" aria-labelledby="activity-title" className="scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5">
            <h2 id="activity-title" className="font-display text-xl text-ink-900">
              Activity
            </h2>
            {events.length === 0 ? (
              <Quiet>No activity yet.</Quiet>
            ) : (
              <ol className="mt-2 space-y-2">
                {events.slice(0, 80).map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex gap-3 text-sm">
                    <span className="w-28 shrink-0 text-xs text-ink-500 sm:w-32">{fmtInstant(e.at)}</span>
                    <span className="min-w-0">
                      <span className="text-ink-900">{e.label}</span>
                      <span className="ml-1 text-xs text-ink-500">
                        {e.actorName ? `· ${e.actorName}` : `· ${e.actor}`}
                        {e.internal ? " · internal" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {events.length > 80 && <p className="mt-2 text-xs text-ink-500">Showing the latest 80 of {events.length}.</p>}
          </section>
        </div>

        {/* Side panel */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold text-ink-900">At a glance</h2>
            <div className="mt-2 text-sm">
              <Facts
                items={[
                  ["Value", <Money key="v" pence={p.money.contractTotalPence ?? Math.round(p.quoteSummary.totalGbp * 100)} />],
                  ["Basis", p.money.contractTotalPence !== undefined ? "Contract" : "Instant price"],
                  ["Survey", p.survey.scheduledFor ? fmtDayTime(p.survey.scheduledFor) : null],
                  [
                    "Install",
                    // What really happened once it has (a crew can start before the booked day), else the booking.
                    p.install.startedAt
                      ? `${p.install.completedAt ? "Done" : "Started"} ${fmtInstantDay(p.install.completedAt ?? p.install.startedAt)}`
                      : p.booking.startDate
                        ? fmtDay(p.booking.startDate)
                        : null,
                  ],
                  ["Open issues", String(openIssues.length)],
                  ["Messages", String(messages.length)],
                ]}
              />
            </div>
          </div>
          {canEdit && (
            <div className="space-y-4 rounded-2xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold text-ink-900">Admin</h2>
              <NoteForm action={bind(addNoteAction)} />
              <Disclosure summary={p.pilot ? "Change pilot tag" : "Tag as a pilot"}>
                <PilotForm action={bind(setPilotAction)} current={p.pilot} />
              </Disclosure>
              <Disclosure summary="Edit contact and access">
                <ContactForm action={bind(setContactAction)} current={p.customer} />
              </Disclosure>
              {!p.closure.closed && p.proposal.status === "accepted" && (
                <Disclosure summary="Record a cancellation">
                  <CancellationForm action={bind(cancellationAction)} today={today} />
                </Disclosure>
              )}
              {!p.closure.closed && (
                <Disclosure summary="Close the project">
                  <CloseForm action={bind(closeProjectAction)} contracted={p.proposal.status === "accepted"} />
                </Disclosure>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function IssueRow({ issue: i }: { issue: Issue }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-900">
          #{i.number} {i.title}
        </p>
        <p className="text-xs text-ink-500">
          {ISSUE_KIND_LABEL[i.kind]} · {plain(i.severity)} · {i.ownerName ?? (i.ownerRole === "ops" ? "Ops" : i.ownerRole === "customer" ? "Customer" : ROLE_LABEL[i.ownerRole])}
          {i.dueOn ? ` · due ${fmtDate(i.dueOn)}` : ""}
          {i.nextAction ? ` · next: ${i.nextAction}` : ""}
        </p>
      </div>
      <span className="flex flex-wrap gap-1.5">
        {i.blocking && <Badge tone="danger">Blocking</Badge>}
        {i.variation?.status === "draft" && <Badge tone="warn">Variation to check and send</Badge>}
        <StatusChip status={i.status} />
      </span>
    </li>
  );
}

function ComplianceSummary({ items }: { items: { status: string; statutory: boolean; label: string }[] }) {
  const done = items.filter((c) => c.status === "approved" || c.status === "not-applicable");
  const outstanding = items.filter((c) => !(c.status === "approved" || c.status === "not-applicable"));
  const statutory = outstanding.filter((c) => c.statutory);
  return (
    <>
      <Facts
        items={[
          ["Done", `${done.length} of ${items.length}`],
          ["Statutory open", statutory.length ? String(statutory.length) : "None"],
        ]}
      />
      {outstanding.length > 0 && (
        <ul className="space-y-1">
          {outstanding.slice(0, 5).map((c) => (
            <li key={c.label} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {c.label}
                {c.statutory && <span className="ml-1 text-xs font-semibold text-red-700">statutory</span>}
              </span>
              <StatusChip status={c.status} />
            </li>
          ))}
          {outstanding.length > 5 && <li className="text-xs text-ink-500">and {outstanding.length - 5} more</li>}
        </ul>
      )}
    </>
  );
}

/** Where to go for the blockers on screen: one link per area they're about. */
function BlockerLinks({ blockers, projectId }: { blockers: string[]; projectId: string }) {
  const areas = new Map<string, { href: string; label: string }>();
  for (const code of blockers) {
    const c = code.split(":")[0]!;
    if (c.startsWith("survey")) areas.set("survey", { href: `/field/survey/${projectId}`, label: "Survey" });
    else if (c.startsWith("design")) areas.set("design", { href: `/ops/projects/${projectId}/design`, label: "Design" });
    else if (["proposal-not-drafted", "margin-below-minimum", "costs-unpriced", "validity-passed", "proposal-not-issued", "proposal-expired", "tax-unconfirmed"].includes(c))
      areas.set("proposal", { href: `/ops/projects/${projectId}/proposal`, label: "Proposal" });
    else if (["schedule2-incomplete", "terms-unreviewed"].includes(c)) areas.set("settings", { href: "/ops/settings#company", label: "Settings" });
    else if (c === "compliance" || c === "compliance-missing") areas.set("compliance", { href: `/ops/projects/${projectId}/compliance`, label: "Compliance" });
    else if (c.startsWith("kit")) areas.set("kit", { href: `/ops/projects/${projectId}/kit`, label: "Kit" });
    else if (["no-fgas-engineer", "no-electrician", "no-tech-lead", "dates-not-chosen", "dates-inside-cancellation", "booking-not-confirmed"].includes(c))
      areas.set("booking", { href: `/ops/projects/${projectId}/booking`, label: "Booking" });
    else if (["deposit-unpaid", "balance-outstanding", "money-unknown", "balance-not-invoiced", "customer-in-credit"].includes(c))
      areas.set("money", { href: `/ops/projects/${projectId}/money`, label: "Money" });
    else if (c === "issue") areas.set("issues", { href: `/ops/projects/${projectId}/issues`, label: "Issues" });
    else if (["runsheet-missing", "runsheet-incomplete", "exceptions-open", "install-not-started", "walkthrough-not-done", "commissioning-unsigned"].includes(c))
      areas.set("install", { href: `/field/jobs/${projectId}`, label: "Field job" });
    else if (c === "confirmation-not-sent") areas.set("messages", { href: "#messages", label: "Messages" });
  }
  if (areas.size === 0) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-500">Go to:</span>
      {[...areas.values()].map((a) => (
        <Link key={a.href} href={a.href} className="inline-flex min-h-9 items-center rounded-full border border-line px-3 font-semibold text-accent-700 hover:border-accent-400">
          {a.label}
        </Link>
      ))}
    </p>
  );
}

/** "Name (Role, external)", without repeating a role the name already carries. */
function crewLabel(name: string, role: string, external?: boolean): string {
  const parts = name.toLowerCase().includes(role.toLowerCase()) ? [] : [role];
  if (external) parts.push("external");
  return parts.length ? `${name} (${parts.join(", ")})` : name;
}
