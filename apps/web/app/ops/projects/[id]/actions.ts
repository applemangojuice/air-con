"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  CANCELLATION_CHANNELS,
  GATE_IDS,
  ISSUE_KIND_LABEL,
  LEARNING_PROMPTS,
  PROJECT_STAGES,
  STAFF_ROLES,
  TIME_KINDS,
  can,
  defaultsForKind,
  isOpen,
  transitionIssue,
  type CancellationChannel,
  type Issue,
  type IssueKind,
  type IssueStatus,
  type Learning,
  type Permission,
  type ProjectAction,
  type StaffMember,
  type TimeEntry,
} from "@aircon/domain";
import { done, refused, type ActionResult } from "@/components/ops/command/types";
import { londonToUtcIso, slotIso } from "@/components/ops/command/model";
import { audit } from "@/lib/audit";
import { earlyStartEvidenceFromForm, recordEarlyStartEvidence, surveyorClash } from "@/lib/booking-server";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { recordCancellation } from "@/lib/cancellation-server";
import { recordCertificate } from "@/lib/certificates-server";
import { resend } from "@/lib/comms/outbox";
import { sendVariation } from "@/lib/variation-server";
import { dispatch, loadProject, pilotNumberHolder } from "@/lib/project-service";
import * as issuesRepo from "@/lib/repo/issues";
import * as learningsRepo from "@/lib/repo/learnings";
import * as messagesRepo from "@/lib/repo/messages";
import * as staffRepo from "@/lib/repo/staff";
import * as timeRepo from "@/lib/repo/time";
import { isUuid } from "@/lib/repo/base";

/**
 * The command centre's actions (feature F7). Every one checks the signed-in
 * staff member's permission and their access to the project itself (server
 * actions are reachable from any route, and the page's own guard doesn't
 * cover them), validates its input with zod, and changes the project only
 * through project-service dispatch with that person as the actor, so the
 * reducer's gates and qualification checks apply and the audit log names
 * them. Refusals come back with the reducer's blockers for the form to show.
 */

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const text = (max: number) => z.string().trim().max(max);
const field = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form and try again.";

function refresh(projectId: string) {
  revalidatePath(`/ops/projects/${projectId}`);
  revalidatePath(`/ops/projects/${projectId}/issues`);
  revalidatePath(`/ops/projects/${projectId}/time`);
  revalidatePath("/ops/projects");
}

/**
 * The signed-in staff member, when they may change this project: the
 * permission, and the project itself. requireProjectAccess re-reads the live
 * staff row, so someone without the board-wide view (a subcontractor) only
 * ever reaches the jobs they're assigned to, whatever their session said
 * when it was signed. Null answers "not found", never a hint it exists.
 */
async function guard(projectId: string, perm: Permission = "projects.edit"): Promise<StaffMember | null> {
  await requireStaff(perm);
  if (!uuid.safeParse(projectId).success) return null;
  const access = await requireProjectAccess(projectId, { perm });
  return access?.kind === "staff" ? access.staff : null;
}

const notFound = () => refused("Project not found.");

/** Guard + dispatch + the answer the form shows. */
async function run(projectId: string, action: ProjectAction, success: string, perm: Permission = "projects.edit"): Promise<ActionResult> {
  const staff = await guard(projectId, perm);
  if (!staff) return notFound();
  return runAs(staff, projectId, action, success);
}

/** Dispatch as someone guard() already let in. */
async function runAs(staff: StaffMember, projectId: string, action: ProjectAction, success: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return notFound();
  const result = await dispatch(projectId, action, staff);
  if ("error" in result) return refused(result.error, result.blockers);
  refresh(projectId);
  return done(success);
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export async function setOwnerAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const staffId = field(fd, "staffId");
  if (!staffId) return runAs(staff, projectId, { type: "set-owner", staffId: "", name: "" }, "Owner cleared.");
  if (!uuid.safeParse(staffId).success) return refused("Pick someone from the list.");
  const owner = await staffRepo.get(staffId);
  if (!owner || !owner.active) return refused("That person isn't on the active team.");
  return runAs(staff, projectId, { type: "set-owner", staffId: owner.id, name: owner.name }, `${owner.name} owns this project now.`);
}

const nextActionSchema = z.object({
  text: text(200),
  dueOn: z.union([isoDate, z.literal("")]),
  ownerRole: z.union([z.enum(STAFF_ROLES as [string, ...string[]]), z.literal("customer"), z.literal("")]),
});

export async function setNextActionAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const parsed = nextActionSchema.safeParse({ text: field(fd, "text"), dueOn: field(fd, "dueOn"), ownerRole: field(fd, "ownerRole") });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const { text: t, dueOn, ownerRole } = parsed.data;
  return run(
    projectId,
    {
      type: "set-next-action",
      text: t,
      ...(dueOn ? { dueOn } : {}),
      ...(ownerRole ? { ownerRole: ownerRole as StaffMember["roles"][number] | "customer" } : {}),
    },
    t ? "Next action saved." : "Next action cleared.",
  );
}

/* ------------------------------------------------------------------ */
/* Survey                                                              */
/* ------------------------------------------------------------------ */

export async function assignSurveyorAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const id = field(fd, "staffId");
  if (!uuid.safeParse(id).success) return refused("Pick a surveyor.");
  const surveyor = await staffRepo.get(id);
  if (!surveyor || !surveyor.active || !can(surveyor, "survey.conduct")) return refused("That person can't carry out surveys.");
  // Not while they're on an install crew that day: one person can't be in two homes.
  const project = await loadProject(projectId);
  const clash = await surveyorClash(projectId, { staffId: surveyor.id, name: surveyor.name }, project?.survey.scheduledFor);
  if (clash) return refused(clash);
  return runAs(staff, projectId, { type: "assign-surveyor", staffId: surveyor.id, name: surveyor.name }, `${surveyor.name} will do the survey.`);
}

const bookSchema = z.object({
  date: isoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  mode: z.enum(["in-person", "video"]),
  surveyorId: z.union([uuid, z.literal("")]),
});

export async function bookSurveyAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const parsed = bookSchema.safeParse({ date: field(fd, "date"), time: field(fd, "time"), mode: field(fd, "mode") || "in-person", surveyorId: field(fd, "surveyorId") });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const at = slotIso(parsed.data.date, parsed.data.time);
  if (!at) return refused("That date and time don't look right.");
  const project = await loadProject(projectId);
  if (!project) return refused("Project not found.");
  let surveyor: { staffId: string; name: string } | undefined;
  if (parsed.data.surveyorId) {
    const s = await staffRepo.get(parsed.data.surveyorId);
    if (!s || !s.active || !can(s, "survey.conduct")) return refused("That person can't carry out surveys.");
    surveyor = { staffId: s.id, name: s.name };
  }
  // The person doing it (chosen now, or already assigned) mustn't be on an install crew that day.
  const doing = surveyor ?? project.survey.surveyor;
  if (doing) {
    const clash = await surveyorClash(projectId, doing, at);
    if (clash) return refused(clash);
  }
  const moving = project.survey.status === "booked";
  if (moving) {
    const moved = await runAs(staff, projectId, { type: "reschedule-survey", scheduledFor: at }, "Survey moved. The customer gets an email with the new time.");
    if (moved.ok && surveyor && surveyor.staffId !== project.survey.surveyor?.staffId) {
      await runAs(staff, projectId, { type: "assign-surveyor", ...surveyor }, "");
    }
    return moved;
  }
  return runAs(
    staff,
    projectId,
    { type: "ops-book-survey", scheduledFor: at, mode: parsed.data.mode, ...(surveyor ? { surveyor } : {}) },
    "Survey booked. The customer gets a confirmation email with a calendar invite.",
  );
}

/* ------------------------------------------------------------------ */
/* Contract facts                                                      */
/* ------------------------------------------------------------------ */

export async function documentsConsentAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const channel = field(fd, "channel");
  if (channel !== "in-person" && channel !== "email") return refused("How did the customer agree?");
  const evidence = field(fd, "evidence").trim();
  if (evidence.length < 5) {
    return refused(channel === "email" ? "Say where their email is (its date and subject), so it can be found again." : "Say how and when they agreed.");
  }
  return run(projectId, { type: "documents-consent-recorded", channel, evidence }, "Recorded: the customer agreed to get documents by email.", "proposal.edit");
}

/** Their early-start email or signed form, with the copy itself: the same path as the booking page (booking-server). */
export async function earlyStartEvidenceAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const input = earlyStartEvidenceFromForm(fd);
  if (input.evidenceRef.length < 3) return refused("Say which email or form it is (date and subject, or the document reference).");
  const result = await recordEarlyStartEvidence(projectId, input, staff);
  if (!result.ok) return refused(result.error, result.blockers as never);
  refresh(projectId);
  return done("Early-start request recorded on file, with its copy.");
}

export async function electricalCertAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const status = field(fd, "status");
  if (status !== "pending" && status !== "received" && status !== "not-required") return refused("Pick a status.");
  if (status === "received") return certificateAction(projectId, "electrical-installation", fd);
  return run(projectId, { type: "electrical-cert-updated", status }, `Certificate marked ${status.replace("-", " ")}.`);
}

export async function warrantyRegisteredAction(projectId: string, fd: FormData): Promise<ActionResult> {
  return certificateAction(projectId, "warranty-registration", fd);
}

/** The certificate's file and reference go into the customer's documents first; then the project is told. */
async function certificateAction(projectId: string, kind: "electrical-installation" | "warranty-registration", fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const result = await recordCertificate(
    projectId,
    {
      kind,
      reference: field(fd, "reference"),
      mediaIds: fd.getAll("mediaId").map(String),
      ...(field(fd, "issuer") ? { issuer: field(fd, "issuer") } : {}),
    },
    staff,
  );
  if (!result.ok) return refused(result.error, result.blockers as never);
  refresh(projectId);
  return done(kind === "electrical-installation" ? "Certificate received and added to the customer's documents." : "Warranty registered; the registration is in the customer's documents.");
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

const pilotSchema = z.object({
  number: z.coerce.number().int("A whole number").min(1, "1 or more").max(999),
  label: text(80).min(1, "Give the pilot a label"),
});

export async function setPilotAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const parsed = pilotSchema.safeParse({ number: field(fd, "number"), label: field(fd, "label") });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  // One household per pilot number: the pilots page and CSV line them up by it.
  const holder = await pilotNumberHolder(parsed.data.number, { projectId }).catch(() => undefined);
  if (holder === undefined) return refused("The pilot number couldn't be checked. Nothing changed; try again.");
  if (holder) return refused(`Pilot ${parsed.data.number} is already ${holder.name}. Pick another number.`);
  return runAs(staff, projectId, { type: "set-pilot", ...parsed.data }, `Tagged as pilot ${parsed.data.number}.`);
}

const contactSchema = z.object({
  email: z.union([z.string().trim().email("That email doesn't look right").max(200), z.literal("")]),
  phone: z.union([z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, "That phone number doesn't look right"), z.literal("")]),
  accessNotes: text(500),
  parkingNotes: text(500),
});

export async function setContactAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const parsed = contactSchema.safeParse({
    email: field(fd, "email").trim(),
    phone: field(fd, "phone").trim(),
    accessNotes: field(fd, "accessNotes"),
    parkingNotes: field(fd, "parkingNotes"),
  });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  return run(projectId, { type: "set-customer-contact", ...parsed.data, email: parsed.data.email.toLowerCase() }, "Contact details saved.");
}

export async function closeProjectAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const cancelled = field(fd, "cancelled") === "on";
  const note = field(fd, "reason").trim().slice(0, 300);
  if (cancelled) {
    // A contract's cancellation is recorded with when and how it reached us, which starts the refund clock.
    const project = await loadProject(projectId);
    if (project?.proposal.status === "accepted") return refused("There's a contract: use \"Record a cancellation\" so the refund deadline, the invoices and the customer's acknowledgement are handled.");
  }
  return runAs(
    staff,
    projectId,
    { type: "project-closed", ...(cancelled ? { reason: "cancelled" } : note ? { reason: note } : {}) },
    cancelled ? "Project marked cancelled." : "Project closed.",
  );
}

/** The customer cancelled their contract: when and how it reached us, then everything that follows (cancellation-server). */
export async function cancellationAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const receivedAt = londonToUtcIso(field(fd, "receivedOn"), field(fd, "receivedTime") || "09:00");
  if (!receivedAt) return refused("When did the cancellation reach us? Give the date (and time if you know it).");
  const channel = field(fd, "channel");
  if (!(CANCELLATION_CHANNELS as readonly string[]).includes(channel)) return refused("How did the customer tell us?");
  const result = await recordCancellation(projectId, { receivedAt, channel: channel as CancellationChannel, evidenceRef: field(fd, "evidenceRef") }, staff);
  if (!result.ok) return refused(result.error, result.blockers as never);
  refresh(projectId);
  const c = result.project.cancellation!;
  return done(
    [
      `Cancellation recorded. Refund due by ${c.refundDueBy}.`,
      result.voided.length ? `Voided ${result.voided.join(", ")}.` : "",
      result.tasks.length ? `${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} raised.` : "",
      ...result.warnings,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export async function addNoteAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const t = field(fd, "text").trim();
  if (!t) return refused("Write something first.");
  if (t.length > 2000) return refused("Keep notes under 2,000 characters.");
  return run(projectId, { type: "note", text: t }, "Note added to the activity log.");
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

const ISSUE_KINDS = Object.keys(ISSUE_KIND_LABEL) as [IssueKind, ...IssueKind[]];
const ISSUE_STATUSES = ["open", "in-progress", "awaiting-customer", "resolved", "closed", "rejected"] as const;

const issueSchema = z.object({
  kind: z.enum(ISSUE_KINDS),
  title: text(140).min(3, "Give the issue a short title"),
  detail: text(2000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  blocking: z.boolean(),
  gate: z.union([z.enum(GATE_IDS as [string, ...string[]]), z.literal("")]),
  ownerRole: z.union([z.enum(STAFF_ROLES as [string, ...string[]]), z.literal("customer"), z.literal("ops")]),
  nextAction: text(200),
  dueOn: z.union([isoDate, z.literal("")]),
  customerVisible: z.boolean(),
});

/** The domain's defaults for this kind of issue (null for a kind the form shouldn't have sent). */
function kindDefaults(kind: IssueKind) {
  return kind in ISSUE_KIND_LABEL ? defaultsForKind(kind) : null;
}

export async function raiseIssueAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const parsed = issueSchema.safeParse({
    kind: field(fd, "kind"),
    title: field(fd, "title"),
    detail: field(fd, "detail"),
    severity: field(fd, "severity") || kindDefaults(field(fd, "kind") as IssueKind)?.severity || "medium",
    blocking: field(fd, "blocking") === "on",
    gate: field(fd, "gate"),
    ownerRole: field(fd, "ownerRole") || "ops",
    nextAction: field(fd, "nextAction"),
    dueOn: field(fd, "dueOn"),
    customerVisible: field(fd, "customerVisible") === "on",
  });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const project = await loadProject(projectId);
  if (!project) return refused("Project not found.");
  const d = parsed.data;
  const now = new Date().toISOString();
  const issue: Issue = {
    id: crypto.randomUUID(),
    projectId,
    number: await issuesRepo.nextNumber(projectId),
    kind: d.kind,
    title: d.title,
    ...(d.detail ? { detail: d.detail } : {}),
    severity: d.severity,
    status: "open",
    blocking: d.blocking,
    ...(d.gate ? { gate: d.gate as Issue["gate"] } : {}),
    ownerRole: d.ownerRole as Issue["ownerRole"],
    ...(d.nextAction ? { nextAction: d.nextAction } : {}),
    ...(d.dueOn ? { dueOn: d.dueOn } : {}),
    raisedBy: { kind: "staff", id: staff.id, name: staff.name },
    raisedAt: now,
    mediaIds: [],
    customerVisible: d.customerVisible,
    history: [{ at: now, by: staff.name, note: "Raised from the command centre", status: "open" }],
  };
  try {
    const saved = await issuesRepo.insert(issue);
    await audit({ actor: staff, action: "issue.raise", entity: "issue", entityId: saved.id, detail: { projectId, kind: saved.kind, blocking: saved.blocking } });
  } catch (err) {
    console.error("[ops] raise issue failed:", err);
    return refused("The issue couldn't be saved. Please try again.");
  }
  refresh(projectId);
  return done(`Issue #${issue.number} raised${issue.blocking ? ". It blocks its gate until it's resolved." : "."}`);
}

const transitionSchema = z.object({
  issueId: uuid,
  to: z.enum(ISSUE_STATUSES),
  note: text(1000),
});

export async function transitionIssueAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const parsed = transitionSchema.safeParse({ issueId: field(fd, "issueId"), to: field(fd, "to"), note: field(fd, "note") });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const issue = await issuesRepo.get(parsed.data.issueId);
  if (!issue || issue.projectId !== projectId) return refused("Issue not found.");
  const to = parsed.data.to as IssueStatus;
  if ((to === "resolved" || to === "rejected") && !parsed.data.note) return refused("Say how it was resolved (or why it's rejected).");
  if (to === "awaiting-customer" && issue.variation?.status === "draft") return refused("Check the price and send it to the customer first: they can't see it yet.");
  let next: Issue;
  try {
    next = transitionIssue(issue, to, staff.name, parsed.data.note, new Date().toISOString());
  } catch (err) {
    return refused(err instanceof Error ? err.message : String(err));
  }
  try {
    await issuesRepo.update(next);
    await audit({ actor: staff, action: "issue.transition", entity: "issue", entityId: issue.id, detail: { from: issue.status, to, open: isOpen(next) } });
  } catch (err) {
    console.error("[ops] issue update failed:", err);
    return refused("The change couldn't be saved. Please try again.");
  }
  refresh(projectId);
  return done(`Issue #${issue.number} is now ${to.replace("-", " ")}.`);
}

const sendVariationSchema = z.object({
  issueId: uuid,
  title: text(140).pipe(z.string().min(3, "Give the change a short title.")),
  description: text(2000).pipe(z.string().min(3, "Describe the change for the customer.")),
  pounds: z
    .string()
    .trim()
    .regex(/^-?£?\d{1,6}(\.\d{1,2})?$/, "Enter the price change in pounds, like 120 or -40.50."),
});

/** The office checked a variation proposed on site: it goes to the customer, at this price. */
export async function sendVariationAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId, "proposal.issue");
  if (!staff) return notFound();
  const parsed = sendVariationSchema.safeParse({ issueId: field(fd, "issueId"), title: field(fd, "title"), description: field(fd, "description"), pounds: field(fd, "pounds") });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const pence = Math.round(Number(parsed.data.pounds.replace("£", "")) * 100);
  const result = await sendVariation(projectId, parsed.data.issueId, { title: parsed.data.title, description: parsed.data.description, priceDeltaNetPence: pence }, staff);
  if (!result.ok) return refused(result.error);
  refresh(projectId);
  return done(result.message ?? "Sent to the customer.");
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

const timeSchema = z.object({
  staffId: uuid,
  kind: z.enum(TIME_KINDS as [TimeEntry["kind"], ...TimeEntry["kind"][]]),
  date: isoDate,
  start: z.union([z.string().regex(/^\d{1,2}:\d{2}$/, "Use a time like 09:30"), z.literal("")]),
  hours: z.coerce.number().min(0).max(24),
  minutes: z.coerce.number().int().min(0).max(59),
  dayN: z.union([z.coerce.number().int().min(1).max(10), z.literal("")]),
  note: text(300),
});

export async function addTimeAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const parsed = timeSchema.safeParse({
    staffId: field(fd, "staffId"),
    kind: field(fd, "kind"),
    date: field(fd, "date"),
    start: field(fd, "start"),
    hours: field(fd, "hours") || "0",
    minutes: field(fd, "minutes") || "0",
    dayN: field(fd, "dayN"),
    note: field(fd, "note"),
  });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const d = parsed.data;
  const total = Math.round(d.hours * 60 + d.minutes);
  if (total <= 0) return refused("How long? Enter hours or minutes.");
  if (total > 16 * 60) return refused("That's more than 16 hours. Split it into one entry per day.");
  const person = await staffRepo.get(d.staffId);
  if (!person) return refused("Pick who did the work.");
  const startedAt = londonToUtcIso(d.date, d.start || "09:00");
  if (!startedAt) return refused("That date or time doesn't look right.");
  if (Date.parse(startedAt) > Date.now() + 60_000) return refused("Time can only be logged for work already done.");
  const entry: TimeEntry = {
    id: crypto.randomUUID(),
    projectId,
    staffId: person.id,
    staffName: person.name,
    kind: d.kind,
    ...(d.dayN !== "" ? { dayN: d.dayN } : {}),
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + total * 60_000).toISOString(),
    minutes: total,
    note: d.note ? `${d.note} (logged by ${staff.name})` : `Logged by ${staff.name}`,
  };
  try {
    await timeRepo.insert(entry);
    await audit({ actor: staff, action: "time.add", entity: "time_entry", entityId: entry.id, detail: { projectId, kind: entry.kind, minutes: total, for: person.id } });
  } catch (err) {
    console.error("[ops] add time failed:", err);
    return refused("The entry couldn't be saved. Please try again.");
  }
  refresh(projectId);
  return done(`Logged ${total} min of ${d.kind} for ${person.name}.`);
}

/* ------------------------------------------------------------------ */
/* Learnings                                                           */
/* ------------------------------------------------------------------ */

export async function addLearningAction(projectId: string, fd: FormData): Promise<ActionResult> {
  const staff = await guard(projectId);
  if (!staff) return notFound();
  const answers = LEARNING_PROMPTS.map((p) => ({ promptId: p.id, answer: field(fd, `answer:${p.id}`).trim().slice(0, 1000) })).filter((a) => a.answer);
  if (answers.length === 0) return refused("Answer at least one of the questions.");
  const stage = field(fd, "stage");
  const dayN = Number(field(fd, "dayN"));
  const tags = field(fd, "tags")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => t.slice(0, 30));
  const learning: Learning = {
    id: crypto.randomUUID(),
    projectId,
    ...(Number.isInteger(dayN) && dayN >= 1 && dayN <= 10 ? { dayN } : {}),
    ...((PROJECT_STAGES as readonly string[]).includes(stage) ? { stage: stage as Learning["stage"] } : {}),
    author: { staffId: staff.id, name: staff.name },
    answers,
    tags,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  try {
    await learningsRepo.insert(learning);
    await audit({ actor: staff, action: "learning.add", entity: "learning", entityId: learning.id, detail: { projectId } });
  } catch (err) {
    console.error("[ops] add learning failed:", err);
    return refused("The learning couldn't be saved. Please try again.");
  }
  refresh(projectId);
  revalidatePath("/ops/pilots");
  return done("Learning saved. It shows on the pilots dashboard too.");
}

const learningStatusSchema = z.object({
  learningId: uuid,
  status: z.enum(["open", "applied", "wont-fix"]),
  appliedNote: text(500),
});

/** Also used from the pilots dashboard. */
export async function setLearningStatusAction(fd: FormData): Promise<ActionResult> {
  await requireStaff("projects.edit");
  const parsed = learningStatusSchema.safeParse({ learningId: field(fd, "learningId"), status: field(fd, "status"), appliedNote: field(fd, "appliedNote") });
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const l = await learningsRepo.get(parsed.data.learningId);
  // Only on a project this person may change (the learning's own).
  const staff = l ? await guard(l.projectId) : null;
  if (!l || !staff) return refused("Learning not found.");
  const { status, appliedNote } = parsed.data;
  if (status === "applied" && !appliedNote) return refused("Say what changed (the checklist step, engine constant or habit).");
  const next: Learning = { ...l, status };
  if (status === "open") delete next.appliedNote;
  else if (appliedNote) next.appliedNote = `${appliedNote} (${staff.name})`;
  try {
    await learningsRepo.update(next);
    await audit({ actor: staff, action: "learning.status", entity: "learning", entityId: l.id, detail: { from: l.status, to: status } });
  } catch (err) {
    console.error("[ops] learning update failed:", err);
    return refused("The change couldn't be saved. Please try again.");
  }
  refresh(l.projectId);
  revalidatePath("/ops/pilots");
  return done(status === "applied" ? "Marked applied." : status === "wont-fix" ? "Marked won't fix." : "Reopened.");
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/** One more attempt of a stored message (same key, freshly minted link). Also used from /ops/messages. */
export async function resendMessageAction(fd: FormData): Promise<ActionResult> {
  const signedIn = await requireStaff("messages.send");
  const id = field(fd, "messageId");
  if (!isUuid(id)) return refused("Message not found.");
  const message = await messagesRepo.get(id);
  if (!message) return refused("Message not found.");
  // A project's message: only someone who may open that project. Team mail and sign-in links: the whole board only.
  const staff = message.projectId ? await guard(message.projectId, "messages.send") : can(signedIn, "projects.view-all") ? signedIn : null;
  if (!staff) return refused("Message not found.");
  const r = await resend(id);
  await audit({ actor: staff, action: "message.resend", entity: "message", entityId: id, detail: { event: message.event, status: r.status } });
  if (message.projectId) refresh(message.projectId);
  revalidatePath("/ops/messages");
  if (r.status === "sent") return done("Sent.");
  if (r.status === "demo") return done("Recorded in demo mode: no email or SMS provider is set up, so nothing was delivered.");
  if (r.status === "skipped") return refused(("error" in r && r.error) || "Not sent: the event is turned off, or the customer opted out.");
  return refused(("error" in r && r.error) || "The provider didn't accept it. It'll be retried automatically.");
}
