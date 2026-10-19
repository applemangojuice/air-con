import {
  QUALIFICATION_LABEL,
  ROLE_LABEL,
  blockersFor,
  cancellationCopy,
  cancellationStatus,
  earliestKitArrival,
  earliestStartForKit,
  EARLY_START_WORDING_VERSION,
  earlyStartEvidenceProblem,
  earlyStartRequestedOf,
  earlyStartWording,
  contractTaxCode,
  hasCurrentQualification,
  meetsRequirement,
  qualificationStatus,
  type Blocker,
  type CancellationStatus,
  type CrewMember,
  type Invoice,
  type PilotSettings,
  type Project,
  type QualificationKind,
  type ReadinessContext,
  type StaffMember,
  type StaffRole,
  type StepRequirement,
} from "@aircon/domain";
import { bookingClashes, workingDatesFrom, type BookingClash } from "@/app/ops/calendar/calendar-model";
import { audit } from "./audit";
import { demoLoginAllowed } from "./auth/access";
import { agreedTerms, creditedInFull, issueInvoice, planInvoices, type InvoicePlan } from "./money-server";
import { listDocuments } from "./documents-server";
import { loadOpsProjects } from "./ops-server";
import { buildReadinessContext, dispatch, londonToday, loadProject } from "./project-service";
import { fail, syncKitStatus, type Outcome } from "./purchasing-server";
import * as invoicesRepo from "./repo/invoices";
import * as mediaRepo from "./repo/media";
import * as issuesRepo from "./repo/issues";
import * as proposalsRepo from "./repo/proposals";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";
import * as staffRepo from "./repo/staff";
import { SETTINGS_UNAVAILABLE, getSettings, settingsForWrite } from "./settings-server";
import { fmtDay } from "./format";

/**
 * Booking on the server (F5): install dates set on the customer's behalf,
 * the crew with their qualifications checked on the install dates, the
 * deposit, the early-start evidence, and the confirmation itself.
 *
 * The reducer owns the rules (lead time, working days, the cancellation
 * period, the booking gate); this module adds what needs the database:
 * nobody on the crew can be booked onto two jobs on the same day.
 *
 * Permissions are the caller's job (schedule.edit).
 */

export interface QualificationView {
  kind: QualificationKind;
  label: string;
  reference: string;
  expiresOn?: string;
  /** Current on the day it's checked against (the install's first day, or today). */
  current: boolean;
  /** Not checked against the certificate yet (or no certificate on file), so it counts for nothing. */
  unverified?: boolean;
}

export interface TeamMemberView {
  id: string;
  name: string;
  roles: StaffRole[];
  external: boolean;
  qualifications: QualificationView[];
  meets: Record<StepRequirement, boolean>;
  /** Install days this person is already booked on elsewhere, among this job's dates. */
  clashes: BookingClash[];
}

export interface BookingView {
  project: Project;
  settings: PilotSettings;
  /**
   * The payment schedule the customer agreed (the contract's frozen terms,
   * agreedTerms), else today's settings before there's a contract. The
   * deposit is planned and described from this, never from a later change.
   */
  payments: PilotSettings["payments"];
  /** True when `payments` comes from an accepted contract. */
  paymentsAgreed: boolean;
  today: string;
  /** The day qualifications are checked against: the last install day, or today. */
  checkOn: string;
  earliestStart: string;
  cancellation: CancellationStatus & { copy: string };
  earlyStart: {
    requested: boolean;
    evidenced: boolean;
    wording: string;
    evidenceRef?: string;
    recordedBy?: string;
    receivedOn?: string;
    fromAddress?: string;
    /** How many files of the copy are stored with the project. */
    files: number;
    /** The address on the contract, which an emailed request must come from. */
    customerEmail?: string;
  };
  blockers: Blocker[];
  team: TeamMemberView[];
  crewClashes: BookingClash[];
  coverage: Record<StepRequirement, string[]>;
  /** `credited`: an earlier deposit invoice cancelled in full by a credit note, so a fresh one can go. */
  deposit: { plan: InvoicePlan; invoice?: Invoice; credited?: Invoice };
  ctx: ReadinessContext;
}

function qualificationsOf(s: StaffMember, on: string): QualificationView[] {
  return s.qualifications.map((q) => ({
    kind: q.kind,
    label: QUALIFICATION_LABEL[q.kind] ?? q.kind,
    reference: q.reference,
    ...(q.expiresOn ? { expiresOn: q.expiresOn } : {}),
    current: hasCurrentQualification({ qualifications: [q] }, q.kind, on),
    // A typed number nobody checked against the certificate counts for nothing: say so beside it.
    ...(qualificationStatus(q, on) === "unverified" ? { unverified: true } : {}),
  }));
}

const REQUIREMENTS: StepRequirement[] = ["fgas", "electrical", "tech-lead"];

/** Everyone who can be put on a crew (active; DEMO accounts only where demo sign-in is allowed). */
async function teamList(): Promise<StaffMember[]> {
  const all = await staffRepo.list({ activeOnly: true, ...(demoLoginAllowed(process.env) ? {} : { includeDemo: false }) });
  return all.filter((s) => s.roles.some((r) => r !== "surveyor") || s.roles.includes("admin"));
}

export async function loadBooking(projectId: string, staff: StaffMember): Promise<BookingView | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const [settings, ctx, team, others, invoices, issues, proposal, contracts, pos] = await Promise.all([
    getSettings(),
    buildReadinessContext(project, staff),
    teamList(),
    loadOpsProjects(),
    invoicesRepo.listForProject(projectId),
    issuesRepo.listForProject(projectId),
    proposalsRepo.acceptedForProject(projectId),
    listDocuments(projectId, { kind: "contract" }),
    purchaseOrdersRepo.listForProject(projectId),
  ]);
  const today = londonToday();
  const checkOn = project.booking.dates.at(-1) ?? today;
  const otherProjects = others.map((o) => o.project).filter((p) => p.id !== projectId);
  const dates = project.booking.dates;

  const views: TeamMemberView[] = team.map((s) => ({
    id: s.id,
    name: s.name,
    roles: s.roles,
    external: s.external,
    qualifications: qualificationsOf(s, checkOn),
    meets: Object.fromEntries(REQUIREMENTS.map((r) => [r, meetsRequirement(s, r, checkOn)])) as Record<StepRequirement, boolean>,
    clashes: dates.length ? bookingClashes({ projectId, dates, crew: [{ staffId: s.id, name: s.name }] }, otherProjects) : [],
  }));
  const crewStaff = ctx.crew;
  const coverage = Object.fromEntries(
    REQUIREMENTS.map((r) => [r, crewStaff.filter((m) => meetsRequirement(m, r, checkOn)).map((m) => m.name)]),
  ) as Record<StepRequirement, string[]>;

  const taxCode = contractTaxCode(proposal, settings);
  // Planned on the terms the customer agreed, as the money page does.
  const contractDoc = contracts.filter((d) => d.status === "final").sort((a, b) => b.version - a.version)[0];
  const agreed = agreedTerms(settings, proposal, contractDoc);
  const frozenDeposit = (contractDoc?.snapshot as { payments?: { depositPence?: unknown } } | undefined)?.payments?.depositPence;
  const plans = planInvoices({
    project,
    invoices,
    issues,
    settings: agreed,
    taxCode,
    ...(typeof frozenDeposit === "number" && Number.isInteger(frozenDeposit) && frozenDeposit >= 0 ? { contractDepositPence: frozenDeposit } : {}),
  });
  // The deposit invoice in force: one credited in full (raised wrong, then cancelled) gives way to its replacement.
  const liveDeposits = invoices.filter((i) => i.kind === "deposit" && i.status !== "void" && i.status !== "draft");
  const depositInvoice = liveDeposits.find((i) => !creditedInFull(i, invoices));
  const creditedDeposit = depositInvoice ? undefined : liveDeposits.at(-1);
  const cs = cancellationStatus(project, today, settings);

  return {
    project,
    settings,
    payments: agreed.payments,
    paymentsAgreed: Boolean(proposal && proposal.status === "accepted"),
    today,
    checkOn,
    // Lead time, the period once known, and (while it waits on delivery) the kit's earliest arrival plus the period.
    earliestStart: earliestStartForKit(project, today, settings, earliestKitArrival(pos, today, settings.scheduling.workingDays)),
    cancellation: { ...cs, copy: cancellationCopy(project, { settings, today }) },
    earlyStart: {
      requested: earlyStartRequestedOf(project),
      evidenced: Boolean(project.proposal.earlyStart?.evidencedAt),
      wording: earlyStartWording(project.proposal.contractType),
      ...(project.proposal.earlyStart?.evidenceRef ? { evidenceRef: project.proposal.earlyStart.evidenceRef } : {}),
      ...(project.proposal.earlyStart?.receivedOn ? { receivedOn: project.proposal.earlyStart.receivedOn } : {}),
      ...(project.proposal.earlyStart?.fromAddress ? { fromAddress: project.proposal.earlyStart.fromAddress } : {}),
      files: project.proposal.earlyStart?.mediaIds?.length ?? 0,
      ...(project.customer.email ? { customerEmail: project.customer.email } : {}),
      ...(project.proposal.earlyStart?.recordedBy ? { recordedBy: project.proposal.earlyStart.recordedBy } : {}),
    },
    blockers: blockersFor(project, ctx, "booking"),
    team: views,
    crewClashes: dates.length
      ? bookingClashes({ projectId, dates, crew: project.booking.crew.map((c) => ({ staffId: c.staffId, name: c.name })) }, otherProjects)
      : [],
    coverage,
    deposit: { plan: plans.deposit, ...(depositInvoice ? { invoice: depositInvoice } : {}), ...(creditedDeposit ? { credited: creditedDeposit } : {}) },
    ctx,
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

function clashMessage(clashes: BookingClash[]): string {
  const first = clashes[0]!;
  const more = clashes.length > 1 ? ` (and ${clashes.length - 1} more clash${clashes.length === 2 ? "" : "es"})` : "";
  return `${first.name} is already down for ${first.customer} on ${first.date}${first.confirmed ? "" : " (not confirmed yet)"}${more}. Pick other dates or other people.`;
}

/**
 * Would this surveyor be double-booked by a survey on this slot? Checked
 * against every other live project's install crew on the survey's date
 * (confirmed or not). The message for the office, or null when they're free.
 */
export async function surveyorClash(projectId: string, surveyor: { staffId: string; name: string }, scheduledFor: string | undefined): Promise<string | null> {
  if (!scheduledFor) return null;
  const date = scheduledFor.slice(0, 10);
  const others = (await loadOpsProjects()).map((o) => o.project);
  const clashes = bookingClashes({ projectId, dates: [date], crew: [surveyor] }, others);
  if (!clashes.length) return null;
  const c = clashes[0]!;
  return `${c.name} is on the install for ${c.customer} on ${fmtDay(date)}${c.confirmed ? "" : " (not confirmed yet)"}, so can't do this survey. Pick someone else, or move the survey to another day.`;
}

/** Set the install block from its first day: the next N working days, on the customer's behalf. */
export async function setInstallDates(projectId: string, startDate: string, staff: StaffMember): Promise<Outcome<Project>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail("Pick the first install day.");
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  // The dates and the cancellation period are worked out on settings: never on the fallback defaults.
  const settings = await settingsForWrite();
  if (!settings) return fail(SETTINGS_UNAVAILABLE, 503);
  const dates = workingDatesFrom(startDate, project.booking.installDays, settings.scheduling.workingDays);
  if (dates[0] !== startDate) return fail("The first install day must be a working day.");
  // Supply-and-install with no early start: the period runs from the kit's
  // delivery, so day 1 has to wait for the orders' real delivery dates plus
  // the period (the reducer only knows delivery can't be before tomorrow).
  const today = londonToday();
  if (!earlyStartRequestedOf(project) && !cancellationStatus(project, today, settings).endsOn) {
    const arrival = earliestKitArrival(await purchaseOrdersRepo.listForProject(projectId), today, settings.scheduling.workingDays);
    const floor = earliestStartForKit(project, today, settings, arrival);
    if (startDate < floor) {
      return fail(
        `No early start was requested, so day 1 has to come after the cancellation period, which runs ${settings.scheduling.cancellationDays} days from the kit's delivery to the customer's home. The kit can't be there before ${fmtDay(arrival)} (the orders' dates and lead times), so the earliest start is ${fmtDay(floor)}. If the supplier can deliver sooner, put their date on the order's ETA (Kit page); if the customer wants to start sooner, record their early-start request.`,
      );
    }
  }
  const others = (await loadOpsProjects()).map((o) => o.project);
  const clashes = bookingClashes({ projectId, dates, crew: project.booking.crew.map((c) => ({ staffId: c.staffId, name: c.name })) }, others);
  if (clashes.length) return fail(clashMessage(clashes));
  const r = await dispatch(projectId, { type: "install-dates-set", startDate, dates }, staff);
  if ("error" in r) return fail(r.error, r.status, r.blockers);
  return { ok: true, value: r.project, message: `Install dates set: ${dates.length} day${dates.length === 1 ? "" : "s"} from ${startDate}.` };
}

/** Put the crew together: each person in one of their own roles, nobody double-booked. */
export async function assignCrew(projectId: string, members: { staffId: string; role: StaffRole }[], staff: StaffMember): Promise<Outcome<Project>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  if (project.install.status !== "not-started") return fail("The install has started; change the crew from the field app's job.");
  const ids = [...new Set(members.map((m) => m.staffId))];
  if (ids.length !== members.length) return fail("Each person can only be on the crew once.");
  if (ids.length > 8) return fail("That's a big crew: eight people at most.");
  const people = await staffRepo.listByIds(ids);
  const crew: CrewMember[] = [];
  for (const m of members) {
    const person = people.find((p) => p.id === m.staffId);
    if (!person || !person.active) return fail("One of those people isn't an active member of staff.");
    if (!person.roles.includes(m.role) && !(m.role === "installer" && (person.roles.includes("tech-lead") || person.roles.includes("admin")))) {
      return fail(`${person.name} isn't a ${ROLE_LABEL[m.role].toLowerCase()}. Pick one of their roles.`);
    }
    crew.push({ staffId: person.id, name: person.name, role: m.role, external: person.external });
  }
  if (project.booking.dates.length) {
    const others = (await loadOpsProjects()).map((o) => o.project);
    const clashes = bookingClashes({ projectId, dates: project.booking.dates, crew }, others);
    if (clashes.length) return fail(clashMessage(clashes));
  }
  const r = await dispatch(projectId, { type: "crew-assigned", crew }, staff);
  if ("error" in r) return fail(r.error, r.status, r.blockers);
  return { ok: true, value: r.project, message: crew.length ? "Crew saved." : "Crew cleared." };
}

/** Confirm the booking (the booking gate decides), then catch the kit status up. */
export async function confirmBooking(projectId: string, staff: StaffMember): Promise<Outcome<Project>> {
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  if (project.booking.dates.length) {
    const others = (await loadOpsProjects()).map((o) => o.project);
    const clashes = bookingClashes({ projectId, dates: project.booking.dates, crew: project.booking.crew }, others);
    if (clashes.length) return fail(clashMessage(clashes));
  }
  const r = await dispatch(projectId, { type: "booking-confirmed" }, staff);
  if ("error" in r) return fail(r.error, r.status, r.blockers);
  const sync = await syncKitStatus(projectId, staff);
  return { ok: true, value: r.project, message: "Booking confirmed. The customer has been told.", ...(sync.warning ? { warning: sync.warning } : {}) };
}

/** Ask for the deposit settings require: issues the deposit invoice (which records the request and emails it). */
export async function requestDeposit(projectId: string, expectedTotalPence: number | undefined, requestId: string, staff: StaffMember): Promise<Outcome<Invoice>> {
  return issueInvoice(projectId, { kind: "deposit", ...(expectedTotalPence !== undefined ? { expectedTotalPence } : {}), requestId }, staff);
}

/** The early-start evidence forms' fields (booking page and command centre), as the server reads them. */
export function earlyStartEvidenceFromForm(form: FormData): EarlyStartEvidenceInput {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    channel: str("channel") === "paper" ? "paper" : "email",
    evidenceRef: str("evidenceRef"),
    mediaIds: form.getAll("mediaId").map(String),
    receivedOn: str("receivedOn"),
    ...(str("fromAddress") ? { fromAddress: str("fromAddress").slice(0, 200) } : {}),
    wordingConfirmed: str("wording") === "on",
  };
}

export interface EarlyStartEvidenceInput {
  channel: "email" | "paper";
  /** Which email or form: its date and subject, or the form's reference. */
  evidenceRef: string;
  /** The copy, uploaded to this project: the email as a PDF or screenshot, or the signed form. */
  mediaIds: string[];
  /** The London day it reached us. */
  receivedOn: string;
  /** For an email: the address it came from. */
  fromAddress?: string;
  /** The person recording it checked it uses the early-start wording we gave the customer. */
  wordingConfirmed: boolean;
}

/**
 * The customer's early-start request on a durable medium (their email with
 * the wording, or a signed form), recorded by the signed-in person who has
 * it, with the copy itself stored on the project (we carry the burden of
 * proof). Everything is checked before anything is recorded; a request made
 * by email or on paper (not ticked on the portal) is then recorded first,
 * then its evidence. The one path for the booking page and the command
 * centre.
 */
export async function recordEarlyStartEvidence(projectId: string, input: EarlyStartEvidenceInput, staff: StaffMember): Promise<Outcome<Project>> {
  const ref = input.evidenceRef.trim().slice(0, 200);
  if (!ref) return fail("Say which email or form it is (date and subject, or the form's reference).");
  const project = await loadProject(projectId);
  if (!project) return fail("Project not found.", 404);
  // Only this project's own uploads count as its copy.
  const wanted = [...new Set(input.mediaIds.filter((id) => typeof id === "string" && id.length <= 64))].slice(0, 8);
  const media = wanted.length ? (await mediaRepo.listByIds(wanted)).filter((m) => m.projectId === projectId) : [];
  const evidence = {
    channel: input.channel,
    mediaIds: media.map((m) => m.id),
    receivedOn: input.receivedOn,
    ...(input.fromAddress?.trim() ? { fromAddress: input.fromAddress.trim() } : {}),
    // The version they were asked to use, once someone has checked the words.
    wordingVersion: input.wordingConfirmed ? (project.proposal.earlyStart?.wordingVersion ?? EARLY_START_WORDING_VERSION) : "",
  };
  if (project.proposal.status === "accepted" && !project.proposal.earlyStart?.evidencedAt) {
    const problem = earlyStartEvidenceProblem(project, evidence, londonToday());
    if (problem) return fail(problem);
  }
  if (!earlyStartRequestedOf(project)) {
    const req = await dispatch(projectId, { type: "early-start-requested", channel: input.channel }, staff);
    if ("error" in req) return fail(req.error, req.status, req.blockers);
  }
  const r = await dispatch(projectId, { type: "early-start-evidenced", evidenceRef: ref, by: staff.name, ...evidence }, staff);
  if ("error" in r) return fail(r.error, r.status, r.blockers);
  await audit({ actor: staff, action: "booking.early-start-evidence", entity: "project", entityId: projectId, detail: { channel: input.channel, files: media.length, receivedOn: input.receivedOn } });
  return { ok: true, value: r.project, message: "Early-start request recorded with its evidence." };
}
