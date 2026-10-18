import assert from "node:assert/strict";
import { test } from "node:test";
import { generateQuote } from "./pricing.ts";
import {
  CANCELLATION_RULE_STATUS,
  EARLY_START_WORDING_VERSION,
  REVIEW_REQUEST_DAYS,
  applyProjectAction,
  blockersFor,
  cancellationCopy,
  cancellationStatus,
  createProject,
  currentStage,
  customerNextAction,
  daysBetween,
  earliestInstallStart,
  earlyStartWording,
  isLegacySnapshot,
  isGatePassed,
  isStageComplete,
  migrateProject,
  nextGate,
  projectFees,
  projectTimeline,
  readiness,
  rescheduleFeeGbp,
  reviewRequestDue,
  seasonalCheck,
  seasonalCheckDue,
  stageInfo,
  stageState,
  PROJECT_STAGES,
  STAGE_INFO,
  type Blocker,
  type ContractType,
  type GateId,
  type Project,
  type ProjectAction,
  type ReadinessContext,
} from "./project.ts";
import { applyProjectActionV1, createProjectV1, type ProjectActionV1, type ProjectV1 } from "./project-v1.ts";
import { DEFAULT_SETTINGS, mergeSettings, type PilotSettings } from "./settings.ts";
import type { StaffMember } from "./staff.ts";
import type { Survey } from "./types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures (fictional DEMO people, no real data)                      */
/* ------------------------------------------------------------------ */

function survey(overrides: Partial<Survey> = {}): Survey {
  return {
    postcode: "SW16 2BE",
    addressLine: "1 Demo Street",
    archetypeId: "semi-1930-1979",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [
      {
        id: "r1",
        name: "Main bedroom",
        type: "bedroom",
        size: "medium",
        floor: "first",
        glazing: "medium",
        orientation: "south",
        hasExternalWall: true,
        photos: [{ id: "p1", kind: "room" }],
      },
    ],
    outdoor: { location: "ground-rear", photos: [{ id: "p2", kind: "outdoor-location" }] },
    electrics: { condition: "modern-spare-ways", photos: [{ id: "p3", kind: "fuse-board" }] },
    ...overrides,
  };
}

const T = {
  create: "2026-10-19T09:00:00.000Z", // Mon
  book: "2026-10-19T09:30:00.000Z",
  slot: "2026-10-22T10:00:00.000Z", // Thu
  surveyDone: "2026-10-22T11:30:00.000Z",
  design: "2026-10-23T14:00:00.000Z",
  issue: "2026-10-26T09:00:00.000Z",
  accept: "2026-10-27T18:00:00.000Z", // cancellation runs to Tue 10 Nov
  dates: "2026-10-28T10:00:00.000Z",
  kit: "2026-11-13T12:00:00.000Z",
  day1: "2026-11-17T08:30:00.000Z", // Tue
  done: "2026-11-19T15:00:00.000Z", // Thu
  handover: "2026-11-19T16:00:00.000Z",
  after: "2026-11-20T10:00:00.000Z",
  close: "2026-11-27T10:00:00.000Z",
};
const INSTALL_DATES = ["2026-11-17", "2026-11-18", "2026-11-19"];

function staff(over: Partial<StaffMember> & Pick<StaffMember, "id" | "name" | "roles">): StaffMember {
  return { email: `${over.id}@example.test`, external: false, active: true, qualifications: [], demo: true, ...over };
}
const fgas = (reference: string, expiresOn = "2028-01-31") => ({ kind: "fgas-cat1" as const, reference, expiresOn });

const ADMIN = staff({ id: "s-admin", name: "Ada Admin", roles: ["admin"] });
const TECH_LEAD = staff({ id: "s-tl", name: "Tess Lead", roles: ["tech-lead"], qualifications: [fgas("FG-0001")] });
const SURVEYOR = staff({ id: "s-sv", name: "Sam Survey", roles: ["surveyor"] });
const INSTALLER = staff({ id: "s-in", name: "Ian Stall", roles: ["installer"], qualifications: [fgas("FG-0002")] });
const SPARKY = staff({
  id: "s-el",
  name: "Ellie Watts",
  roles: ["electrician"],
  external: true,
  qualifications: [{ kind: "part-p", reference: "SCHEME-123", expiresOn: "2027-06-30" }],
});

/** A business that has filled in everything the pre-contract information needs (DEMO details). */
const READY_COMPANY = {
  geographicAddress: "DEMO, 1 Example Street, London SW16 2BE",
  complaintsProcess: "DEMO: tell us by phone or email; we reply within two working days.",
};
const READY_WARRANTY = { workmanshipYears: 0, manufacturerSummary: "DEMO: the manufacturer's warranty, registered by us." };

/** Settings for a business ready to issue proposals, with `over` on top (company and warranty merged, not replaced). */
function ready(over: { company?: Record<string, unknown>; warranty?: Record<string, unknown>; [k: string]: unknown } = {}): PilotSettings {
  return mergeSettings({
    ...over,
    company: { ...READY_COMPANY, ...(over.company ?? {}) },
    warranty: { ...READY_WARRANTY, ...(over.warranty ?? {}) },
  });
}
const READY = ready();

function ctx(today: string, over: Partial<ReadinessContext> = {}): ReadinessContext {
  return {
    today: today.slice(0, 10),
    settings: READY,
    surveyCompleteness: { pct: 100, missing: [] },
    design: { status: "approved", compatibilityErrors: [] },
    proposalCheck: { belowMinMargin: false, marginOverride: false, taxConfirmed: true, taxOverride: false, expired: false },
    compliance: [
      { key: "planning-pd", label: "Permitted development", status: "approved", statutory: true, gate: "ready-to-install" },
      { key: "rams", label: "RAMS", status: "approved", statutory: false, gate: "ready-to-install" },
    ],
    crew: [TECH_LEAD, INSTALLER, SPARKY],
    kit: { requiredLines: 4, deliveredLines: 4, inspectedLines: 4, damaged: 0 },
    openIssues: [],
    runsheet: { complete: true, openExceptions: 0, missing: 0, blocked: 0, walkthroughDone: true },
    commissioning: { signed: true, signedBy: "Tess Lead" },
    money: { depositDuePence: 0, depositPaidPence: 0, outstandingPence: 0 },
    ...over,
  };
}

function fresh(overrides: Partial<Survey> = {}, extra: { surveyFeeGbp?: number } = {}): Project {
  const s = survey(overrides);
  return createProject({
    id: "proj-1",
    quoteId: "quote-1",
    createdAt: T.create,
    customerName: "Alex Demo",
    customerEmail: "alex@example.test",
    survey: s,
    quote: generateQuote(s),
    ...extra,
  });
}

type Step = [name: string, action: ProjectAction, now: string, over?: Partial<ReadinessContext>];

/** Accepting the proposal without an early start; the journey asks for one (supply-and-install needs it). */
const ACCEPT: ProjectAction = {
  type: "proposal-accepted",
  proposalId: "pr-1",
  version: 1,
  optionLabel: "Standard",
  contractTotalPence: 645_000,
  earlyStartRequested: false,
};

const JOURNEY: Step[] = [
  ["book-survey", { type: "book-survey", scheduledFor: T.slot, mode: "in-person" }, T.book],
  ["assign-surveyor", { type: "assign-surveyor", staffId: "s-sv", name: "Sam Survey" }, T.book, { actor: ADMIN }],
  ["surveyor-on-my-way", { type: "surveyor-on-my-way", etaMinutes: 20, by: "Sam Survey" }, "2026-10-22T09:40:00.000Z", { actor: SURVEYOR }],
  ["survey-started", { type: "survey-started", by: "Sam Survey" }, "2026-10-22T10:05:00.000Z", { actor: SURVEYOR }],
  ["survey-submitted", { type: "survey-submitted", surveyRecordId: "sr-1" }, T.surveyDone, { actor: SURVEYOR }],
  ["design-updated", { type: "design-updated", designId: "d-1", version: 1, status: "in-review" }, T.design, { actor: SURVEYOR }],
  ["design-approved", { type: "design-approved", designId: "d-1", version: 1, by: "Tess Lead" }, T.design, { actor: TECH_LEAD }],
  ["documents-consent-recorded", { type: "documents-consent-recorded", channel: "portal" }, "2026-10-24T10:00:00.000Z"],
  ["proposal-issued", { type: "proposal-issued", proposalId: "pr-1", version: 1, validUntil: "2026-11-25", optionCount: 2 }, T.issue, { actor: ADMIN }],
  ["proposal-viewed", { type: "proposal-viewed", proposalId: "pr-1" }, "2026-10-26T19:00:00.000Z"],
  ["proposal-accepted", { ...ACCEPT, earlyStartRequested: true } as ProjectAction, T.accept],
  ["contract-confirmation-sent", { type: "contract-confirmation-sent", messageId: "msg-1" }, "2026-10-27T18:01:00.000Z"],
  ["install-dates-set", { type: "install-dates-set", startDate: INSTALL_DATES[0]!, dates: INSTALL_DATES }, T.dates],
  [
    "early-start-evidenced",
    { type: "early-start-evidenced", channel: "email", evidenceRef: "inbound-msg-7", by: "Ada Admin" },
    "2026-10-28T11:00:00.000Z",
    { actor: ADMIN },
  ],
  [
    "crew-assigned",
    {
      type: "crew-assigned",
      crew: [
        { staffId: "s-tl", name: "Tess Lead", role: "tech-lead", external: false },
        { staffId: "s-in", name: "Ian Stall", role: "installer", external: false },
        { staffId: "s-el", name: "Ellie Watts", role: "electrician", external: true },
      ],
    },
    T.dates,
    { actor: ADMIN },
  ],
  ["booking-confirmed", { type: "booking-confirmed" }, T.dates, { actor: ADMIN }],
  ["kit-ordered", { type: "kit-updated", status: "ordered", shortages: 0 }, T.dates, { actor: ADMIN }],
  ["kit-confirmed", { type: "kit-updated", status: "confirmed", expectedDate: "2026-11-13", shortages: 0 }, "2026-10-30T10:00:00.000Z", { actor: ADMIN }],
  ["kit-delivered", { type: "kit-updated", status: "delivered", shortages: 0 }, T.kit, { actor: ADMIN }],
  ["kit-inspected", { type: "kit-updated", status: "inspected", shortages: 0 }, "2026-11-16T15:00:00.000Z", { actor: INSTALLER }],
  ["installer-on-my-way", { type: "installer-on-my-way", etaMinutes: 15, by: "Ian Stall" }, "2026-11-17T08:00:00.000Z", { actor: INSTALLER }],
  ["day-1", { type: "install-day-started", n: 1, by: "Ian Stall" }, T.day1, { actor: INSTALLER }],
  [
    "day-1-end",
    { type: "install-day-ended", n: 1, summary: "Cores drilled", customerUpdate: { text: "Holes drilled and sealed, brackets up.", mediaIds: ["m-1"] } },
    "2026-11-17T17:00:00.000Z",
    { actor: INSTALLER },
  ],
  ["day-2", { type: "install-day-started", n: 2, by: "Ian Stall" }, "2026-11-18T08:30:00.000Z", { actor: INSTALLER }],
  ["day-2-end", { type: "install-day-ended", n: 2, summary: "Units hung" }, "2026-11-18T17:00:00.000Z", { actor: INSTALLER }],
  ["day-3", { type: "install-day-started", n: 3, by: "Ian Stall" }, "2026-11-19T08:30:00.000Z", { actor: INSTALLER }],
  ["install-completed", { type: "install-completed" }, T.done, { actor: INSTALLER }],
  ["commissioning-signed", { type: "commissioning-signed", by: "Tess Lead" }, T.done, { actor: TECH_LEAD }],
  ["handover-pack-published", { type: "handover-pack-published", documentId: "doc-hp-1" }, T.handover, { actor: TECH_LEAD }],
  ["handover-signed", { type: "handover-signed", name: "Alex Demo", outcome: "all-good", snagCount: 0 }, T.handover, { actor: INSTALLER }],
  ["electrical-cert-updated", { type: "electrical-cert-updated", status: "received" }, T.after, { actor: ADMIN }],
  ["warranty-registered", { type: "warranty-registered" }, T.after, { actor: ADMIN }],
  ["invoice-issued", { type: "invoice-issued", amountPence: 645_000 }, T.after, { actor: ADMIN }],
  ["payment-recorded", { type: "payment-recorded", amountPence: 645_000 }, "2026-11-24T10:00:00.000Z"],
  ["aftercare-checkin-sent", { type: "aftercare-checkin-sent" }, "2026-11-26T09:00:00.000Z"],
  ["project-closed", { type: "project-closed" }, T.close, { actor: ADMIN }],
  ["feedback-requested", { type: "feedback-requested" }, "2026-12-19T09:00:00.000Z"],
  ["feedback-submitted", { type: "feedback-submitted", score: 9, comments: "Quiet and tidy." }, "2026-12-20T09:00:00.000Z"],
];

function apply(p: Project, action: ProjectAction, now: string, over: Partial<ReadinessContext> = {}) {
  return applyProjectAction(p, action, now, ctx(now, over));
}

function step(p: Project, action: ProjectAction, now: string, over: Partial<ReadinessContext> = {}): Project {
  const r = apply(p, action, now, over);
  assert.ok(r.ok, `${action.type} failed: ${r.ok ? "" : r.error}`);
  return r.project;
}

interface WalkOptions {
  contractType?: ContractType;
  /** Tick "start early" at acceptance (and record the email evidence later). Default true. */
  early?: boolean;
}

/** An install-only contract with no early start: the period runs 14 days from acceptance (to Tue 10 Nov). */
const INSTALL_ONLY: WalkOptions = { contractType: "install-only", early: false };

/**
 * The project just after the named journey step (or the whole journey). The
 * default is the realistic supply-and-install job with an evidenced early
 * start; `opts` changes the contract type and the early-start choice.
 */
function walk(until?: string, opts: WalkOptions = {}): Project {
  const early = opts.early ?? true;
  let p = fresh();
  for (const [name, action, now, over] of JOURNEY) {
    let a = action;
    if (a.type === "proposal-issued" && opts.contractType) a = { ...a, contractType: opts.contractType };
    if (a.type === "proposal-accepted") a = { ...a, earlyStartRequested: early };
    if (a.type === "early-start-evidenced" && !early) {
      if (name === until) return p;
      continue;
    }
    p = step(p, a, now, over);
    if (name === until) return p;
  }
  assert.ok(!until, `unknown step ${until}`);
  return p;
}

function refuses(p: Project, action: ProjectAction, now: string, over: Partial<ReadinessContext> = {}, pattern?: RegExp) {
  const r = apply(p, action, now, over);
  assert.ok(!r.ok, `${action.type} should have been refused`);
  if (pattern) assert.match(r.error, pattern);
  return r;
}

const codes = (bs: Blocker[]) => bs.map((b) => b.code);
const severityOf = (bs: Blocker[], code: string) => bs.find((b) => b.code === code)?.severity;

/* ------------------------------------------------------------------ */
/* The journey                                                         */
/* ------------------------------------------------------------------ */

test("the whole pilot journey runs price → aftercare and closes", () => {
  const p = walk();
  assert.equal(p.schemaVersion, 2);
  for (const stage of PROJECT_STAGES) assert.equal(stageState(p, stage), "complete", stage);
  assert.equal(nextGate(p), null);
  // Supply-and-install: the period ran from delivery (13 Nov + 14 days), and
  // the install started inside it on the customer's emailed request.
  assert.equal(p.proposal.contractType, "supply-and-install");
  assert.equal(p.proposal.goodsReceivedOn, "2026-11-13");
  assert.equal(p.proposal.cancellationEndsOn, "2026-11-27");
  assert.deepEqual(p.proposal.documentsByEmailConsent, { at: "2026-10-24T10:00:00.000Z", channel: "portal" });
  assert.equal(p.proposal.preContractInfoSentAt, T.issue);
  assert.equal(p.proposal.confirmationSentAt, "2026-10-27T18:01:00.000Z");
  assert.deepEqual(p.proposal.earlyStart, {
    requested: true,
    requestedAt: T.accept,
    channel: "email",
    evidenceRef: "inbound-msg-7",
    evidencedAt: "2026-10-28T11:00:00.000Z",
    recordedBy: "Ada Admin",
    wordingVersion: EARLY_START_WORDING_VERSION,
  });
  assert.equal(p.proposal.earlyStartRequested, true);
  assert.equal(p.money.contractTotalPence, 645_000);
  assert.equal(p.money.paidPence, 645_000);
  assert.equal(p.handover.warrantyDueOn, "2026-12-19"); // handover + 30 days
  assert.equal(p.aftercare.serviceDueOn, "2027-11-19"); // handover + 12 months
  assert.equal(p.install.days.length, 3);
  assert.ok(p.install.days.every((d) => d.status === "done"));
  assert.equal(p.install.days[0]!.customerUpdate?.text, "Holes drilled and sealed, brackets up.");
  assert.equal(p.aftercare.feedback?.score, 9);
  assert.ok(p.events.every((e) => e.label.length > 0 && e.at.length > 0));
});

test("stage completion follows the contract table", () => {
  const at = (name: string) => currentStage(walk(name));
  assert.equal(currentStage(fresh()), "price");
  assert.equal(at("book-survey"), "survey");
  assert.equal(at("survey-submitted"), "proposal");
  assert.equal(at("proposal-accepted"), "booking");
  assert.equal(at("booking-confirmed"), "kit");
  assert.equal(at("kit-delivered"), "install");
  assert.equal(at("install-completed"), "handover");
  assert.equal(at("handover-signed"), "aftercare");
  assert.ok(isStageComplete(walk("project-closed"), "aftercare"));
  const booked = walk("booking-confirmed");
  assert.equal(stageState(booked, "kit"), "current");
  assert.equal(stageState(booked, "install"), "upcoming");
});

test("events carry actors, staff names and the internal flag", () => {
  const p = walk("proposal-viewed");
  const byType = (t: string) => p.events.find((e) => e.type === t)!;
  assert.equal(byType("survey-booked").actor, "customer");
  assert.equal(byType("survey-booked").label, "Home survey booked for Thu 22 Oct, 10:00.");
  assert.equal(byType("surveyor-assigned").actor, "ops");
  assert.equal(byType("surveyor-assigned").actorName, "Ada Admin");
  assert.equal(byType("survey-started").actor, "field");
  assert.equal(byType("design-updated").internal, true);
  assert.equal(byType("proposal-viewed").internal, true);
  assert.equal(byType("design-approved").internal, undefined);
  assert.match(byType("proposal-issued").label, /valid until Wed 25 Nov/);
  assert.match(byType("survey-submitted").label, /by Tue 27 Oct/); // 3 working days after Thu 22 Oct
});

test("money labels format pence by hand, the same in every runtime", () => {
  const p = walk("proposal-accepted");
  const accepted = p.events.find((e) => e.type === "proposal-accepted")!;
  assert.match(accepted.label, /\(Standard, £6,450\)/);
  const q = step(walk("booking-confirmed"), { type: "deposit-requested", amountPence: 64_550 }, T.dates, { actor: ADMIN });
  assert.match(q.events.at(-1)!.label, /£645\.50/);
});

test("reducer never mutates its input", () => {
  const p = walk("proposal-issued");
  const before = JSON.stringify(p);
  apply(p, ACCEPT, T.accept);
  apply(p, { type: "note", text: "hello" }, T.accept);
  assert.equal(JSON.stringify(p), before);
});

/* ------------------------------------------------------------------ */
/* Survey guards                                                       */
/* ------------------------------------------------------------------ */

test("book-survey: future slot only, once, and never after the survey", () => {
  refuses(fresh(), { type: "book-survey", scheduledFor: "2026-10-18T10:00:00.000Z", mode: "in-person" }, T.book, {}, /future/);
  const booked = walk("book-survey");
  refuses(booked, { type: "book-survey", scheduledFor: "2026-10-23T10:00:00.000Z", mode: "in-person" }, T.book, {}, /already booked/);
  refuses(walk("survey-submitted"), { type: "ops-book-survey", scheduledFor: "2026-10-30T10:00:00.000Z", mode: "in-person" }, T.surveyDone, { actor: ADMIN }, /already happened/);
  refuses(walk("survey-started"), { type: "ops-book-survey", scheduledFor: "2026-10-30T10:00:00.000Z", mode: "in-person" }, T.surveyDone, { actor: ADMIN }, /under way/);
});

test("ops-book-survey books on the customer's behalf and can move a slot without a fee", () => {
  let p = step(fresh(), { type: "ops-book-survey", scheduledFor: T.slot, mode: "video", surveyor: { staffId: "s-sv", name: "Sam Survey" } }, T.book, { actor: ADMIN });
  assert.equal(p.survey.mode, "video");
  assert.equal(p.survey.surveyor?.name, "Sam Survey");
  assert.equal(p.events.at(-1)!.actor, "ops");
  p = step(p, { type: "ops-book-survey", scheduledFor: "2026-10-23T13:00:00.000Z", mode: "in-person" }, "2026-10-21T09:00:00.000Z", { actor: ADMIN });
  assert.equal(p.survey.scheduledFor, "2026-10-23T13:00:00.000Z");
  assert.equal(p.survey.rescheduleFeesGbp, 0);
});

test("reschedule-survey: needs a booking, charges short notice to the customer only", () => {
  refuses(fresh(), { type: "reschedule-survey", scheduledFor: T.slot }, T.book, {}, /no booked survey/);
  const booked = walk("book-survey");
  refuses(booked, { type: "reschedule-survey", scheduledFor: "2026-10-01T10:00:00.000Z" }, T.book, {}, /future/);
  const byCustomer = step(booked, { type: "reschedule-survey", scheduledFor: "2026-10-29T10:00:00.000Z" }, "2026-10-20T09:00:00.000Z");
  assert.equal(byCustomer.survey.rescheduleFeesGbp, 25); // 2 days' notice
  assert.equal(byCustomer.money.changeFeesPence, 2_500);
  assert.equal(byCustomer.events.at(-1)!.feeGbp, 25);
  assert.equal(projectFees(byCustomer).changeFeesGbp, 25);
  const byUs = step(booked, { type: "reschedule-survey", scheduledFor: "2026-10-29T10:00:00.000Z" }, "2026-10-20T09:00:00.000Z", { actor: ADMIN });
  assert.equal(byUs.survey.rescheduleFeesGbp, 0);
  const early = step(booked, { type: "reschedule-survey", scheduledFor: "2026-11-05T10:00:00.000Z" }, "2026-10-01T09:00:00.000Z");
  assert.equal(early.survey.rescheduleFeesGbp, 0); // a week's notice is free
});

test("surveyor-on-my-way and survey-started need a booked survey", () => {
  refuses(fresh(), { type: "surveyor-on-my-way", etaMinutes: 20, by: "Sam" }, T.book, {}, /no booked survey/);
  refuses(fresh(), { type: "survey-started", by: "Sam" }, T.book, {}, /no booked survey/);
  refuses(walk("book-survey"), { type: "surveyor-on-my-way", etaMinutes: 0, by: "Sam" }, T.book, {}, /ETA/);
  const p = walk("surveyor-on-my-way");
  assert.equal(p.survey.onMyWay?.etaMinutes, 20);
});

test("survey-submitted needs the survey-complete gate clear, and a context", () => {
  const started = walk("survey-started");
  const r = refuses(started, { type: "survey-submitted", surveyRecordId: "sr-1" }, T.surveyDone, {
    surveyCompleteness: { pct: 80, missing: ["Bedroom 2: ceiling height", "Outdoor: base"] },
  }, /Survey: Bedroom 2: ceiling height \(and 1 more\)/);
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && codes(r.blockers ?? []), ["survey-missing:1", "survey-missing:2"]);
  const noCtx = applyProjectAction(started, { type: "survey-submitted", surveyRecordId: "sr-1" }, T.surveyDone);
  assert.ok(!noCtx.ok && /readiness check/.test(noCtx.error));
  refuses(fresh(), { type: "survey-submitted", surveyRecordId: "sr-1" }, T.surveyDone, {}, /Book the survey/);
  refuses(walk("survey-submitted"), { type: "survey-submitted", surveyRecordId: "sr-1" }, T.surveyDone, {}, /already submitted/);
});

test("survey-submitted can carry the surveyor's electrics finding", () => {
  const p = step(walk("survey-started"), {
    type: "survey-submitted",
    surveyRecordId: "sr-1",
    electrics: { status: "validated", summary: "Spare way 7, 6 m cable run agreed." },
  }, T.surveyDone, { actor: SURVEYOR });
  assert.equal(p.electrics.status, "validated");
  assert.match(p.electrics.summary, /Spare way 7/);
});

/* ------------------------------------------------------------------ */
/* Design guards                                                       */
/* ------------------------------------------------------------------ */

test("design-updated needs a submitted survey and resets an approval", () => {
  refuses(walk("survey-started"), { type: "design-updated", designId: "d-1", version: 1, status: "draft" }, T.design, {}, /survey/);
  const approved = walk("design-approved");
  const redrafted = step(approved, { type: "design-updated", designId: "d-2", version: 2, status: "draft" }, T.design, { actor: SURVEYOR });
  assert.equal(redrafted.design.status, "draft");
  assert.equal(redrafted.design.approvedBy, undefined);
});

test("design-approved needs a qualified, permitted tech lead", () => {
  const p = walk("design-updated");
  const approve: ProjectAction = { type: "design-approved", designId: "d-1", version: 1, by: "X" };
  refuses(p, approve, T.design, { actor: undefined }, /signed-in technical lead/);
  refuses(p, approve, T.design, { actor: SURVEYOR }, /Sam Survey can't do this/); // no design.approve
  refuses(p, approve, T.design, { actor: INSTALLER }, /can't do this/); // F-gas but not a tech lead
  const lapsed = { ...TECH_LEAD, qualifications: [fgas("FG-0001", "2026-10-01")] };
  refuses(p, approve, T.design, { actor: lapsed }, /current F-gas/);
  refuses(p, { ...approve, version: 2 }, T.design, { actor: TECH_LEAD }, /latest design/);
  refuses(p, approve, T.design, { actor: TECH_LEAD, design: { status: "in-review", compatibilityErrors: ["Too many indoor units"] } }, /compatibility/);
  const admin = step(p, approve, T.design, { actor: { ...ADMIN, qualifications: [fgas("FG-0009")] } });
  assert.equal(admin.design.status, "approved");
  // The verified approver is recorded, never the name the caller typed.
  assert.equal(admin.design.approvedBy, "Ada Admin");
  assert.equal(admin.events.at(-1)!.actorName, "Ada Admin");
  assert.match(admin.events.at(-1)!.label, /signed off by Ada Admin/);
});

/* ------------------------------------------------------------------ */
/* Proposal guards + the proposal-issue gate                           */
/* ------------------------------------------------------------------ */

test("proposal-issue gate: design sign-off, compatibility, tax, margin; terms only warn", () => {
  const p = step(walk("design-updated"), { type: "documents-consent-recorded", channel: "portal" }, T.design);
  const c = (over: Partial<ReadinessContext>) => ctx(T.issue, over);
  assert.deepEqual(codes(blockersFor(p, c({ design: { status: "in-review", compatibilityErrors: [] } }), "proposal-issue")), [
    "design-not-approved",
    "terms-unreviewed",
  ]);
  const unsigned = ready({ pricing: { requireEngineerSignoff: false } });
  assert.ok(!codes(blockersFor(p, c({ settings: unsigned, design: { status: "draft", compatibilityErrors: [] } }), "proposal-issue")).includes("design-not-approved"));

  const compat = blockersFor(p, c({ design: { status: "approved", compatibilityErrors: ["Outdoor unit can't take three heads"] } }), "proposal-issue");
  assert.equal(severityOf(compat, "design-compatibility:1"), "block");

  const vat = ready({ tax: { vatRegistered: true, defaultTaxCode: "zero-esm" } });
  const noTax = { belowMinMargin: false, marginOverride: false, taxConfirmed: false, taxOverride: false, expired: false };
  assert.equal(severityOf(blockersFor(p, c({ settings: vat, proposalCheck: noTax }), "proposal-issue"), "tax-unconfirmed"), "block");
  assert.equal(severityOf(blockersFor(p, c({ settings: vat, proposalCheck: { ...noTax, taxOverride: true } }), "proposal-issue"), "tax-unconfirmed"), undefined);
  const confirmed = ready({ tax: { vatRegistered: true, accountantConfirmed: true } });
  assert.equal(severityOf(blockersFor(p, c({ settings: confirmed, proposalCheck: noTax }), "proposal-issue"), "tax-unconfirmed"), undefined);

  const low = { ...noTax, taxConfirmed: true, belowMinMargin: true };
  assert.equal(severityOf(blockersFor(p, c({ proposalCheck: low }), "proposal-issue"), "margin-below-minimum"), "block");
  assert.equal(severityOf(blockersFor(p, c({ proposalCheck: { ...low, marginOverride: true } }), "proposal-issue"), "margin-below-minimum"), undefined);
  assert.equal(severityOf(blockersFor(p, c({ proposalCheck: undefined }), "proposal-issue"), "proposal-not-drafted"), "block");

  const reviewed = ready({ legal: { termsReviewed: true, cancellationReviewed: true } });
  assert.deepEqual(blockersFor(walk("documents-consent-recorded"), c({ settings: reviewed }), "proposal-issue"), []);
  assert.equal(severityOf(blockersFor(walk("survey-started"), c({}), "proposal-issue"), "survey-not-submitted"), "block");
});

test("proposal-issue gate: email consent, an email address, and every Schedule 2 item in settings", () => {
  const c = (over: Partial<ReadinessContext>) => ctx(T.issue, over);
  const noConsent = blockersFor(walk("design-approved"), c({}), "proposal-issue").find((b) => b.code === "documents-consent-missing");
  assert.deepEqual(
    noConsent && { severity: noConsent.severity, owner: noConsent.owner, action: noConsent.action },
    { severity: "block", owner: "customer", action: "Ask the customer to confirm they're happy to get documents by email" },
  );
  const consented = walk("documents-consent-recorded");
  assert.ok(!codes(blockersFor(consented, c({}), "proposal-issue")).includes("documents-consent-missing"));

  // The defaults hold no address, complaints process or guarantee statement: issue is blocked until they're set.
  const defaults = blockersFor(consented, c({ settings: DEFAULT_SETTINGS }), "proposal-issue").find((b) => b.code === "schedule2-incomplete");
  assert.equal(defaults?.severity, "block");
  assert.equal(defaults?.owner, "admin");
  assert.match(defaults!.message, /geographic address, complaints process, guarantee statement \(or explicit 'none'\)/);
  const noPhone = blockersFor(consented, c({ settings: ready({ company: { phone: " " } }) }), "proposal-issue");
  assert.match(noPhone.find((b) => b.code === "schedule2-incomplete")!.message, /: phone\.$/);

  const noEmail = step(consented, { type: "set-customer-contact", email: "" }, T.design, { actor: ADMIN });
  assert.equal(severityOf(blockersFor(noEmail, c({}), "proposal-issue"), "no-customer-email"), "block");
  const r = refuses(walk("design-approved"), JOURNEY.find(([n]) => n === "proposal-issued")![1], T.issue, { actor: ADMIN }, /agreed to get the contract documents by email/);
  assert.ok(!r.ok && r.blockers!.some((b) => b.code === "documents-consent-missing"));
});

test("documents-consent-recorded: once, by the customer or ops, before acceptance", () => {
  const p = walk("documents-consent-recorded");
  const ev = p.events.at(-1)!;
  assert.equal(ev.type, "documents-consent-recorded");
  assert.equal(ev.actor, "customer");
  assert.equal(ev.internal, undefined);
  const again = step(p, { type: "documents-consent-recorded", channel: "in-person" }, T.issue, { actor: ADMIN });
  assert.deepEqual(again.proposal.documentsByEmailConsent, p.proposal.documentsByEmailConsent); // the first agreement stands
  assert.equal(again.events.length, p.events.length);
  const byOps = step(walk("design-approved"), { type: "documents-consent-recorded", channel: "in-person" }, T.design, { actor: ADMIN });
  assert.deepEqual(byOps.proposal.documentsByEmailConsent, { at: T.design, channel: "in-person" });
  assert.equal(byOps.events.at(-1)!.actor, "ops");
  refuses(walk("design-approved"), { type: "documents-consent-recorded", channel: "fax" } as never, T.design, {}, /How did the customer agree/);
  refuses(walk("proposal-accepted"), { type: "documents-consent-recorded", channel: "portal" }, T.dates, {}, /already in place/);
  // It survives a re-issue: consent is the customer's, not the version's.
  const revised = step(
    step(walk("proposal-viewed"), { type: "proposal-changes-requested", text: "Other wall" }, T.accept),
    { type: "proposal-issued", proposalId: "pr-2", version: 2, validUntil: "2026-11-30", optionCount: 1 },
    T.accept,
    { actor: ADMIN },
  );
  assert.deepEqual(revised.proposal.documentsByEmailConsent, p.proposal.documentsByEmailConsent);
  assert.equal(revised.proposal.preContractInfoSentAt, T.accept);
});

test("proposal-issued: gate clear, valid date, not after acceptance; warnings don't block", () => {
  const p = walk("documents-consent-recorded");
  const issue: ProjectAction = { type: "proposal-issued", proposalId: "pr-1", version: 1, validUntil: "2026-11-25", optionCount: 2 };
  const r = refuses(p, issue, T.issue, { proposalCheck: { belowMinMargin: true, marginOverride: false, taxConfirmed: true, taxOverride: false, expired: false } }, /minimum/);
  assert.ok(!r.ok && r.blockers?.some((b) => b.code === "terms-unreviewed" && b.severity === "warn"));
  refuses(p, { ...issue, validUntil: "2026-10-01" }, T.issue, {}, /valid-until/);
  refuses(p, { ...issue, optionCount: 0 }, T.issue, {}, /at least one option/);
  const issued = step(p, issue, T.issue, { actor: ADMIN }); // terms unreviewed: warn only
  assert.equal(issued.proposal.status, "issued");
  assert.equal(issued.proposal.contractType, "supply-and-install"); // the default
  assert.equal(issued.proposal.preContractInfoSentAt, T.issue); // the issue email is the durable medium
  assert.equal(step(p, { ...issue, contractType: "install-only" }, T.issue, { actor: ADMIN }).proposal.contractType, "install-only");
  refuses(p, { ...issue, contractType: "loan" } as never, T.issue, {}, /Unknown contract type/);
  refuses(walk("proposal-accepted"), { ...issue, proposalId: "pr-2", version: 2 }, T.dates, {}, /variation/);
});

test("proposal-viewed sets viewedAt once, for the current version only", () => {
  refuses(walk("design-approved"), { type: "proposal-viewed", proposalId: "pr-1" }, T.issue, {}, /no issued proposal/);
  const p = walk("proposal-viewed");
  const first = p.proposal.viewedAt;
  const again = step(p, { type: "proposal-viewed", proposalId: "pr-1" }, "2026-10-27T09:00:00.000Z");
  assert.equal(again.proposal.viewedAt, first);
  assert.equal(again.events.length, p.events.length);
  const preview = step(walk("proposal-issued"), { type: "proposal-viewed", proposalId: "pr-1" }, T.issue, { actor: ADMIN });
  assert.equal(preview.proposal.viewedAt, undefined); // a staff preview isn't the customer reading it
});

test("changes requested, declined and expired all need an issued proposal", () => {
  const before = walk("design-approved");
  refuses(before, { type: "proposal-changes-requested", text: "Move the unit" }, T.issue, {}, /no issued proposal/);
  refuses(before, { type: "proposal-declined", reason: "" }, T.issue, {}, /no issued proposal/);
  refuses(before, { type: "proposal-expired" }, T.issue, {}, /no open proposal/);

  const issued = walk("proposal-viewed");
  refuses(issued, { type: "proposal-changes-requested", text: "  " }, T.accept, {}, /what you'd like changed/);
  const changes = step(issued, { type: "proposal-changes-requested", text: "Can the bedroom unit go left?" }, T.accept);
  assert.equal(changes.proposal.status, "changes-requested");
  assert.equal(changes.proposal.changeRequest, "Can the bedroom unit go left?");
  assert.equal(nextGate(changes), "proposal-issue"); // a revised version has to go out

  const declined = step(issued, { type: "proposal-declined", reason: "Going with a friend's firm" }, T.accept);
  assert.equal(declined.proposal.status, "declined");
  assert.equal(declined.proposal.declineReason, "Going with a friend's firm");

  refuses(issued, { type: "proposal-expired" }, "2026-11-25T10:00:00.000Z", {}, /still valid/);
  const expired = step(issued, { type: "proposal-expired" }, "2026-11-26T10:00:00.000Z");
  assert.equal(expired.proposal.status, "expired");
});

test("proposal-accepted: issued, in date, current version; starts the cancellation clock", () => {
  const accept = ACCEPT;
  refuses(walk("design-approved"), accept, T.accept, {}, /no issued proposal/);
  const issued = walk("proposal-viewed");
  const late = refuses(issued, accept, "2026-11-26T10:00:00.000Z", {}, /valid until Wed 25 Nov/);
  assert.deepEqual(!late.ok && codes(late.blockers ?? []), ["proposal-expired"]);
  refuses(issued, { ...accept, proposalId: "pr-0" } as ProjectAction, T.accept, {}, /current proposal/);
  refuses(issued, { ...accept, contractTotalPence: 0 } as ProjectAction, T.accept, {}, /positive/);
  // Customers can still accept the issued version after asking for changes.
  const changes = step(issued, { type: "proposal-changes-requested", text: "Actually, fine as is" }, T.accept);
  const accepted = step(changes, accept, T.accept);
  assert.equal(accepted.proposal.status, "accepted");
  assert.equal(accepted.proposal.changeRequest, undefined);
  refuses(accepted, accept, T.accept, {}, /already accepted/);

  // Supply-and-install: a sales contract, so no end date until the goods arrive.
  assert.equal(accepted.proposal.cancellationEndsOn, undefined);
  assert.deepEqual(accepted.proposal.earlyStart, { requested: false, wordingVersion: EARLY_START_WORDING_VERSION });
  assert.equal(accepted.proposal.earlyStartRequested, false);
  assert.deepEqual(cancellationStatus(accepted, "2026-12-31", READY), { ended: false, basis: "goods-delivery", earlyStartEvidenced: false });

  // Install-only: a service contract, 14 days from acceptance.
  const serviceIssued = walk("proposal-viewed", INSTALL_ONLY);
  assert.equal(step(serviceIssued, accept, T.accept).proposal.cancellationEndsOn, "2026-11-10");
  const longer = step(serviceIssued, accept, T.accept, { settings: mergeSettings({ scheduling: { cancellationDays: 21 } }) });
  assert.equal(longer.proposal.cancellationEndsOn, "2026-11-17");

  const early = step(issued, { ...accept, earlyStartRequested: true, earlyStartWordingVersion: "early-start-v0" } as ProjectAction, T.accept);
  assert.deepEqual(early.proposal.earlyStart, { requested: true, requestedAt: T.accept, channel: "portal", wordingVersion: "early-start-v0" });
  assert.equal(early.proposal.earlyStartRequested, true);
});

test("contract-confirmation-sent: accepted only, the first send counts, allowed after close", () => {
  refuses(walk("proposal-viewed"), { type: "contract-confirmation-sent" }, T.accept, {}, /no accepted contract/);
  const p = walk("contract-confirmation-sent");
  const ev = p.events.at(-1)!;
  assert.deepEqual([ev.type, ev.actor, ev.internal], ["contract-confirmation-sent", "system", true]);
  const again = step(p, { type: "contract-confirmation-sent" }, "2026-10-29T10:00:00.000Z");
  assert.equal(again.proposal.confirmationSentAt, "2026-10-27T18:01:00.000Z");
  assert.equal(again.events.length, p.events.length);
  const demo = step(walk("proposal-accepted"), { type: "contract-confirmation-sent", demo: true }, T.accept);
  assert.match(demo.events.at(-1)!.label, /demo mode \(stored, not delivered\)/);
  const closed = step(walk("proposal-accepted"), { type: "project-closed", reason: "cancelled" }, T.accept, { actor: ADMIN });
  assert.ok(step(closed, { type: "contract-confirmation-sent" }, T.accept).proposal.confirmationSentAt);
});

test("early-start-evidenced: an accepted early-start request, a reference, a signed-in staff member, once", () => {
  const p = walk("install-dates-set");
  const evidence: ProjectAction = { type: "early-start-evidenced", channel: "paper", evidenceRef: "media-form-1", by: "typed name" };
  refuses(walk("proposal-viewed"), evidence, T.dates, { actor: ADMIN }, /no accepted contract/);
  refuses(walk("install-dates-set", { early: false }), evidence, T.dates, { actor: ADMIN }, /didn't ask to start early/);
  refuses(p, { ...evidence, evidenceRef: "  " } as ProjectAction, T.dates, { actor: ADMIN }, /reference/);
  refuses(p, { ...evidence, channel: "portal" } as never, T.dates, { actor: ADMIN }, /email or a signed form/);
  refuses(p, evidence, T.dates, {}, /signed-in staff member/);
  const done = step(p, evidence, T.dates, { actor: ADMIN });
  assert.equal(done.proposal.earlyStart?.recordedBy, "Ada Admin"); // the verified person, not the typed name
  assert.equal(done.proposal.earlyStart?.channel, "paper");
  assert.equal(done.proposal.earlyStart?.requestedAt, T.accept); // when they first asked
  assert.match(done.events.at(-1)!.label, /signed form asking us to start early/);
  refuses(done, evidence, T.dates, { actor: ADMIN }, /already on file/);
});

test("early-start-requested: a later request (after accepting without one), before the install starts", () => {
  const p = walk("install-dates-set", { early: false });
  refuses(walk("proposal-viewed"), { type: "early-start-requested", channel: "portal" }, T.dates, {}, /no accepted contract/);
  refuses(p, { type: "early-start-requested", channel: "sms" } as never, T.dates, {}, /How did the customer ask/);
  const asked = step(p, { type: "early-start-requested", channel: "email" }, "2026-10-29T09:00:00.000Z", { actor: ADMIN });
  assert.deepEqual(asked.proposal.earlyStart, { requested: true, requestedAt: "2026-10-29T09:00:00.000Z", channel: "email", wordingVersion: EARLY_START_WORDING_VERSION });
  assert.equal(asked.proposal.earlyStartRequested, true);
  assert.equal(step(asked, { type: "early-start-requested", channel: "portal" }, T.dates).events.length, asked.events.length);
  // Then the evidence, as for a request made at acceptance; and dates inside the period are allowed.
  const evidenced = step(asked, { type: "early-start-evidenced", channel: "email", evidenceRef: "inbound-9", by: "" }, "2026-10-29T10:00:00.000Z", { actor: ADMIN });
  assert.equal(evidenced.proposal.earlyStart?.evidencedAt, "2026-10-29T10:00:00.000Z");
  refuses(walk("day-1", { early: false, contractType: "install-only" }), { type: "early-start-requested", channel: "portal" }, T.day1, {}, /already started/);
});

/* ------------------------------------------------------------------ */
/* Booking guards + the booking gate                                   */
/* ------------------------------------------------------------------ */

test("install-dates-set: accepted, working days, right length, lead time, after cancellation", () => {
  const set = (dates: string[]): ProjectAction => ({ type: "install-dates-set", startDate: dates[0]!, dates });
  refuses(walk("proposal-viewed"), set(INSTALL_DATES), T.dates, {}, /Accept your proposal/);
  const p = walk("proposal-accepted", INSTALL_ONLY); // the period runs to Tue 10 Nov
  refuses(p, set(["2026-11-17", "2026-11-18"]), T.dates, {}, /Pick 3 install days/);
  refuses(p, set(["2026-11-20", "2026-11-21", "2026-11-23"]), T.dates, {}, /working days/); // Sat
  refuses(p, set(["2026-11-18", "2026-11-17", "2026-11-19"]), T.dates, {}, /in order/);
  refuses(p, { type: "install-dates-set", startDate: "2026-11-18", dates: INSTALL_DATES }, T.dates, {}, /first install day/);
  refuses(p, set(["2026-11-09", "2026-11-10", "2026-11-11"]), T.dates, {}, /cancellation period runs until Tue 10 Nov/);
  assert.ok(apply(p, set(["2026-11-11", "2026-11-12", "2026-11-13"]), T.dates).ok); // the day after is fine
  refuses(p, set(["2026-11-17", "2026-11-18", "2026-11-19"]), "2026-11-13T10:00:00.000Z", {}, /5 days' notice/);

  const early = step(walk("proposal-viewed", INSTALL_ONLY), { ...ACCEPT, earlyStartRequested: true } as ProjectAction, T.accept);
  const soon = step(early, set(["2026-11-03", "2026-11-04", "2026-11-05"]), T.dates);
  assert.deepEqual(soon.booking.dates, ["2026-11-03", "2026-11-04", "2026-11-05"]);

  // What a date picker should offer first: exactly what the guard accepts.
  assert.equal(earliestInstallStart(p, T.dates), "2026-11-11"); // the day after the period ends
  assert.equal(earliestInstallStart(early, T.dates), "2026-11-02"); // lead time only (Mon)
  assert.equal(earliestInstallStart(p, "2026-11-13T10:00:00.000Z"), "2026-11-18"); // lead time wins
  assert.equal(earliestInstallStart(p, "2026-11-12T10:00:00.000Z"), "2026-11-17"); // Tue 17: +5 is a working day
  assert.equal(earliestInstallStart(early, "2026-10-29T10:00:00.000Z"), "2026-11-03"); // Tue 3: +5 is a Tue
  assert.equal(earliestInstallStart(early, "2026-10-30T10:00:00.000Z"), "2026-11-04");
  assert.equal(earliestInstallStart(early, "2026-10-31T10:00:00.000Z"), "2026-11-05");
  assert.equal(earliestInstallStart(early, "2026-11-01T10:00:00.000Z"), "2026-11-06");
  assert.equal(earliestInstallStart(early, "2026-11-02T10:00:00.000Z"), "2026-11-09"); // Sat 7 → Mon 9
  assert.ok(apply(early, set(["2026-11-02", "2026-11-03", "2026-11-04"]), T.dates).ok);
  refuses(early, set(["2026-10-30", "2026-11-02", "2026-11-03"]), T.dates, {}, /5 days' notice/);

  // Supply-and-install with no early start: the end isn't known until the kit
  // arrives, so dates aren't refused here (ready-to-install holds the start).
  const goods = walk("proposal-accepted", { early: false });
  assert.ok(apply(goods, set(["2026-11-03", "2026-11-04", "2026-11-05"]), T.dates).ok);
  assert.equal(earliestInstallStart(goods, T.dates), "2026-11-02"); // lead time only
  const delivered = { ...goods, proposal: { ...goods.proposal, goodsReceivedOn: "2026-11-02", cancellationEndsOn: "2026-11-16" } };
  refuses(delivered, set(["2026-11-16", "2026-11-17", "2026-11-18"]), T.dates, {}, /runs until Mon 16 Nov/);
  assert.equal(earliestInstallStart(delivered, T.dates), "2026-11-17");

  const chosen = walk("install-dates-set");
  assert.equal(chosen.booking.status, "not-booked"); // chosen, not yet confirmed
  refuses(chosen, set(INSTALL_DATES), T.dates, {}, /already your install dates/);
  refuses(walk("day-1"), set(["2026-11-24", "2026-11-25", "2026-11-26"]), T.day1, {}, /has started/);
});

test("moving confirmed dates: the customer pays short notice, our moves are free", () => {
  const booked = walk("booking-confirmed");
  const move: ProjectAction = { type: "install-dates-set", startDate: "2026-11-24", dates: ["2026-11-24", "2026-11-25", "2026-11-26"] };
  const late = step(booked, move, "2026-11-12T09:00:00.000Z"); // 5 days before the 17th
  assert.equal(late.booking.rescheduleFeesGbp, 150);
  assert.equal(late.booking.status, "booked");
  assert.equal(late.events.at(-1)!.type, "install-rescheduled");
  assert.equal(projectFees(late).changeFeesGbp, 150);
  const ours = step(booked, move, "2026-11-12T09:00:00.000Z", { actor: ADMIN });
  assert.equal(ours.booking.rescheduleFeesGbp, 0);
  const notice = step(booked, move, "2026-11-01T09:00:00.000Z");
  assert.equal(notice.booking.rescheduleFeesGbp, 0);
});

test("booking gate: F-gas, a Part P electrician, deposit, dates", () => {
  const p = walk("crew-assigned");
  const c = (over: Partial<ReadinessContext>) => ctx(T.dates, over);
  assert.deepEqual(blockersFor(p, c({}), "booking"), []);

  const noSparky = blockersFor(p, c({ crew: [TECH_LEAD, INSTALLER] }), "booking");
  const sparky = noSparky.find((b) => b.code === "no-electrician")!;
  assert.equal(sparky.severity, "block");
  assert.equal(sparky.owner, "ops");
  assert.match(sparky.action!, /assign a Part P electrician/i);

  assert.deepEqual(codes(blockersFor(p, c({ crew: [SPARKY] }), "booking")), ["no-fgas-engineer", "no-tech-lead"]);
  assert.equal(severityOf(blockersFor(p, c({ crew: [INSTALLER, SPARKY] }), "booking"), "no-tech-lead"), "warn");
  const expired = { ...INSTALLER, qualifications: [fgas("FG-0002", "2026-10-01")] };
  assert.ok(codes(blockersFor(p, c({ crew: [expired, SPARKY] }), "booking")).includes("no-fgas-engineer"));
  const inactive = { ...TECH_LEAD, active: false };
  assert.ok(codes(blockersFor(p, c({ crew: [inactive, SPARKY] }), "booking")).includes("no-fgas-engineer"));

  const deposit = mergeSettings({ payments: { depositPct: 20 } });
  assert.equal(severityOf(blockersFor(p, c({ settings: deposit }), "booking"), "deposit-unpaid"), "block");
  const paidBySum = c({ settings: deposit, money: { depositDuePence: 129_000, depositPaidPence: 129_000, outstandingPence: 0 } });
  assert.equal(severityOf(blockersFor(p, paidBySum, "booking"), "deposit-unpaid"), undefined);
  const beforeKit = mergeSettings({ payments: { depositPct: 20, depositTiming: "before-kit-order" } });
  assert.equal(severityOf(blockersFor(p, c({ settings: beforeKit }), "booking"), "deposit-unpaid"), undefined);

  // No early start on supply-and-install: the kit has to land 15+ days before day 1.
  const noEarly = walk("crew-assigned", { early: false });
  const late = blockersFor(noEarly, c({}), "booking").find((b) => b.code === "no-early-start");
  assert.equal(late?.severity, "warn");
  assert.match(late!.message, /needs to arrive by Mon 2 Nov/); // 17 Nov − 15 days
  // Install-only dates inside the known period block (the guard normally stops them first).
  const service = walk("crew-assigned", INSTALL_ONLY);
  const inside = { ...service, booking: { ...service.booking, startDate: "2026-11-09", dates: ["2026-11-09", "2026-11-10", "2026-11-11"] } };
  assert.equal(severityOf(blockersFor(inside, c({}), "booking"), "dates-inside-cancellation"), "block");
  assert.deepEqual(blockersFor(service, c({}), "booking"), []);

  const noDates = walk("proposal-accepted");
  assert.equal(severityOf(blockersFor(noDates, c({}), "booking"), "dates-not-chosen"), "block");
  assert.equal(severityOf(blockersFor(walk("proposal-viewed"), c({}), "booking"), "proposal-not-accepted"), "block");
});

test("booking-confirmed refuses with the gate's blockers, and only once", () => {
  const p = walk("crew-assigned");
  const r = refuses(p, { type: "booking-confirmed" }, T.dates, { crew: [TECH_LEAD, INSTALLER] }, /Part P/);
  assert.ok(!r.ok && r.blockers!.every((b) => b.gate === "booking"));
  const paid = step(
    step(p, { type: "deposit-requested", amountPence: 129_000 }, T.dates, { actor: ADMIN }),
    { type: "deposit-paid", amountPence: 129_000 },
    T.dates,
  );
  assert.equal(paid.booking.depositStatus, "paid");
  assert.equal(paid.money.paidPence, 0); // money moves only through payment-recorded
  refuses(paid, { type: "deposit-paid", amountPence: 129_000 }, T.dates, {}, /already paid/);
  refuses(paid, { type: "deposit-requested", amountPence: 1 }, T.dates, {}, /already paid/);
  refuses(p, { type: "deposit-requested", amountPence: 0 }, T.dates, {}, /positive/);
  const confirmed = step(paid, { type: "booking-confirmed" }, T.dates, { actor: ADMIN, settings: mergeSettings({ payments: { depositPct: 20 } }) });
  assert.match(confirmed.events.at(-1)!.label, /Tue 17 Nov to Thu 19 Nov/);
  refuses(confirmed, { type: "booking-confirmed" }, T.dates, {}, /already confirmed/);
});

test("crew-assigned names the team for the customer", () => {
  const p = walk("crew-assigned");
  assert.equal(p.booking.crew.length, 3);
  assert.match(p.events.at(-1)!.label, /Tess Lead \(technical lead\), Ian Stall \(installer\), Ellie Watts \(electrician\)/);
  refuses(p, { type: "crew-assigned", crew: [{ staffId: "", name: "", role: "installer", external: false }] }, T.dates, {}, /name and a role/);
});

/* ------------------------------------------------------------------ */
/* Kit + install                                                       */
/* ------------------------------------------------------------------ */

test("kit-updated needs a confirmed booking and keeps customer wording conservative", () => {
  refuses(walk("install-dates-set"), { type: "kit-updated", status: "ordered", shortages: 0 }, T.dates, {}, /Confirm the booking/);
  const p = walk("kit-inspected");
  const kitLabels = p.events.filter((e) => e.type === "kit-updated").map((e) => e.label);
  assert.deepEqual(kitLabels, [
    "Your kit is ordered.",
    "The supplier has confirmed your kit for Fri 13 Nov.",
    "Your kit has been delivered. Your cancellation period now runs until the end of Fri 27 Nov.",
    "Your kit has been checked by your installer.", // the clock started at delivery and doesn't move
  ]);
  assert.equal(p.kit.deliveredAt, T.kit);
  const dispatched = step(walk("kit-confirmed"), { type: "kit-updated", status: "dispatched", shortages: 0 }, T.kit, { actor: ADMIN });
  assert.equal(dispatched.events.at(-1)!.internal, true);
  const short = step(walk("kit-confirmed"), { type: "kit-updated", status: "delivered", shortages: 2 }, T.kit, { actor: ADMIN });
  assert.match(short.events.at(-1)!.label, /2 items are still to come/);
  // Part-delivered: the period runs from the LAST of the goods (reg 30(4)), so no date yet.
  assert.equal(short.proposal.goodsReceivedOn, undefined);
  assert.doesNotMatch(short.events.at(-1)!.label, /cancellation/);
  const rest = step(short, { type: "kit-updated", status: "inspected", shortages: 0 }, "2026-11-16T15:00:00.000Z", { actor: INSTALLER });
  assert.equal(rest.proposal.goodsReceivedOn, "2026-11-16");
  assert.equal(rest.proposal.cancellationEndsOn, "2026-11-30");
  assert.equal(rest.kit.deliveredAt, T.kit); // first delivery, unchanged
  // Delivered the day after acceptance: 14 days from delivery. Install-only contracts don't move at all.
  const fast = step(walk("booking-confirmed"), { type: "kit-updated", status: "delivered", shortages: 0 }, "2026-10-28T12:00:00.000Z", { actor: ADMIN });
  assert.equal(fast.proposal.cancellationEndsOn, "2026-11-11");
  const service = walk("kit-delivered", INSTALL_ONLY);
  assert.equal(service.proposal.goodsReceivedOn, undefined);
  assert.equal(service.proposal.cancellationEndsOn, "2026-11-10");
  refuses(walk("booking-confirmed"), { type: "kit-updated", status: "ordered", shortages: -1 }, T.dates, {}, /whole number/);
});

test("installer-on-my-way needs a confirmed booking", () => {
  refuses(walk("install-dates-set"), { type: "installer-on-my-way", etaMinutes: 15, by: "Ian" }, T.day1, {}, /isn't booked/);
  assert.equal(walk("installer-on-my-way").install.onMyWay?.by, "Ian Stall");
});

test("ready-to-install gate: kit, compliance, issues, cancellation period", () => {
  const p = walk("kit-delivered");
  const c = (over: Partial<ReadinessContext>) => ctx(T.day1, over);
  assert.deepEqual(blockersFor(p, c({}), "ready-to-install"), []);

  const notChecked = blockersFor(p, c({ kit: { requiredLines: 4, deliveredLines: 4, inspectedLines: 2, damaged: 1 } }), "ready-to-install");
  assert.equal(severityOf(notChecked, "kit-not-inspected"), "warn");
  assert.equal(severityOf(notChecked, "kit-damaged"), "warn");
  assert.equal(severityOf(blockersFor(p, c({ kit: { requiredLines: 4, deliveredLines: 3, inspectedLines: 0, damaged: 0 } }), "ready-to-install"), "kit-not-delivered"), "block");
  assert.equal(severityOf(blockersFor(p, c({ kit: undefined }), "ready-to-install"), "kit-not-planned"), "block");
  assert.equal(severityOf(blockersFor(p, c({ kit: { requiredLines: 0, deliveredLines: 0, inspectedLines: 0, damaged: 0 } }), "ready-to-install"), "kit-not-planned"), "block");

  const compliance = blockersFor(p, c({
    compliance: [
      { key: "asbestos", label: "Asbestos", status: "under-review", statutory: true, gate: "booking" },
      { key: "rams", label: "RAMS", status: "not-started", statutory: false, gate: "ready-to-install" },
      { key: "electrical-certificate", label: "Electrical certificate", status: "not-started", statutory: true, gate: "closed" },
      { key: "outdoor-siting", label: "Outdoor siting", status: "not-applicable", statutory: true, gate: "ready-to-install" },
    ],
  }), "ready-to-install");
  assert.equal(severityOf(compliance, "compliance:asbestos"), "block");
  assert.equal(severityOf(compliance, "compliance:rams"), "warn");
  assert.equal(severityOf(compliance, "compliance:electrical-certificate"), undefined); // a later gate's business
  assert.equal(severityOf(compliance, "compliance:outdoor-siting"), undefined);
  assert.equal(severityOf(blockersFor(p, c({ compliance: [] }), "ready-to-install"), "compliance-missing"), "block");

  const issues = blockersFor(p, c({
    openIssues: [
      { id: "i1", title: "Suspected asbestos flash guard", kind: "safety", severity: "critical", blocking: true },
      { id: "i2", title: "Paint scuff", kind: "snag", severity: "low", blocking: false },
      { id: "i3", title: "Warranty portal down", kind: "blocker", severity: "medium", blocking: true, gate: "closed" },
    ],
  }), "ready-to-install");
  assert.deepEqual(codes(issues), ["issue:i1"]);

  const unbooked = walk("install-dates-set");
  assert.equal(severityOf(blockersFor(unbooked, c({}), "ready-to-install"), "booking-not-confirmed"), "block");
});

test("ready-to-install gate: the contract confirmation, then the cancellation period or an evidenced early start", () => {
  const p = walk("kit-delivered"); // supply-and-install: delivered 13 Nov, period to Fri 27 Nov
  const at = (today: string, project: Project = p) => blockersFor(project, ctx(today), "ready-to-install");
  const without = (field: "confirmationSentAt") => ({ ...p, proposal: { ...p.proposal, [field]: undefined } });
  const confirmation = at(T.day1, without("confirmationSentAt")).find((b) => b.code === "confirmation-not-sent");
  assert.equal(confirmation?.severity, "block");
  assert.equal(confirmation?.owner, "ops");

  // Requested on the portal but not yet on a durable medium: says exactly what's missing.
  const unevidenced = { ...p, proposal: { ...p.proposal, earlyStart: { requested: true, requestedAt: T.accept, channel: "portal" as const, wordingVersion: EARLY_START_WORDING_VERSION } } };
  const pending = at(T.day1, unevidenced).find((b) => b.code === "early-start-unevidenced");
  assert.equal(pending?.severity, "block");
  assert.match(pending!.message, /runs until the end of Fri 27 Nov/);
  assert.match(pending!.message, /isn't on a durable medium yet: record their email reply/);
  assert.equal(pending?.action, "Record the customer's early-start email or signed form");
  assert.deepEqual(codes(at("2026-11-28", unevidenced)), [], "the period has ended: no evidence needed");

  // No early start at all: wait for the end (inclusive), then go.
  const none = walk("kit-delivered", { early: false });
  assert.equal(severityOf(at("2026-11-27", none), "cancellation-period"), "block");
  assert.match(at("2026-11-27", none).find((b) => b.code === "cancellation-period")!.message, /hasn't asked to start early/);
  assert.equal(severityOf(at("2026-11-28", none), "cancellation-period"), undefined);
  // Before delivery the end isn't known, and the message says what it waits on.
  const notYet = { ...none, proposal: { ...none.proposal, goodsReceivedOn: undefined, cancellationEndsOn: undefined } };
  assert.match(at("2026-12-31", notYet).find((b) => b.code === "cancellation-period")!.message, /runs until 14 days after the kit is delivered/);

  // Install-only: 14 days from acceptance (Tue 10 Nov).
  const service = walk("kit-delivered", INSTALL_ONLY);
  assert.equal(severityOf(at("2026-11-10", service), "cancellation-period"), "block");
  assert.equal(severityOf(at("2026-11-11", service), "cancellation-period"), undefined);

  const unknown = { ...none, proposal: { ...none.proposal, acceptedAt: undefined } };
  assert.equal(severityOf(at(T.day1, unknown), "cancellation-unknown"), "block");

  // Day 1 refuses with these blockers.
  const r = refuses(walk("kit-inspected", { early: false }), { type: "install-day-started", n: 1, by: "Ian Stall" }, T.day1, { actor: INSTALLER }, /cancellation period runs until the end of Fri 27 Nov/);
  assert.ok(!r.ok && r.blockers!.some((b) => b.code === "cancellation-period"));
});

test("cancellationStatus: basis per contract type, evidence, and reg 31 when the information came late", () => {
  const goods = walk("kit-delivered");
  assert.deepEqual(cancellationStatus(goods, "2026-11-27", READY), { ended: false, endsOn: "2026-11-27", basis: "goods-delivery", earlyStartEvidenced: true });
  assert.equal(cancellationStatus(goods, "2026-11-28T00:30:00.000Z", READY).ended, true);
  assert.deepEqual(cancellationStatus(walk("proposal-viewed"), "2027-01-01"), { ended: false, basis: "unknown", earlyStartEvidenced: false });
  const service = walk("proposal-accepted", INSTALL_ONLY);
  assert.deepEqual(cancellationStatus(service, "2026-11-11"), { ended: true, endsOn: "2026-11-10", basis: "acceptance", earlyStartEvidenced: false });
  // An older snapshot with an acceptance-based date on a supply-and-install contract: ignored until the goods arrive.
  const stale = walk("proposal-accepted", { early: false });
  stale.proposal.cancellationEndsOn = "2026-11-10";
  assert.equal(cancellationStatus(stale, "2026-12-01").endsOn, undefined);
  // An old snapshot with only the boolean still counts as a request (not as evidence).
  const legacyFlag = { ...service, proposal: { ...service.proposal, earlyStart: undefined, earlyStartRequested: true } };
  assert.equal(earliestInstallStart(legacyFlag, T.dates), "2026-11-02");
  assert.equal(cancellationStatus(legacyFlag, T.dates).earlyStartEvidenced, false);

  // Reg 31: no pre-contract information before acceptance. Given later by the confirmation: 14 days from then.
  const late = { ...service, proposal: { ...service.proposal, preContractInfoSentAt: undefined, confirmationSentAt: "2026-11-02T09:00:00.000Z" } };
  assert.equal(cancellationStatus(late, T.dates).endsOn, "2026-11-16");
  // Never given: 12 months after the normal end.
  const never = { ...late, proposal: { ...late.proposal, confirmationSentAt: undefined } };
  assert.equal(cancellationStatus(never, T.dates).endsOn, "2027-11-10");
  assert.match(CANCELLATION_RULE_STATUS, /^Legal review required/);
});

test("cancellationCopy: one plain sentence per contract type and state, never '14 days of accepting'", () => {
  const all: string[] = [];
  const say = (p: Project, today?: string) => {
    const text = cancellationCopy(p, { settings: READY, ...(today ? { today } : {}) });
    all.push(text);
    return text;
  };
  assert.equal(say(fresh()), "If you accept, you can cancel without giving a reason until 14 days after the day your equipment is delivered to you.");
  assert.equal(say(walk("proposal-viewed", INSTALL_ONLY)), "If you accept, you can cancel without giving a reason within 14 days of the day you accept.");
  assert.equal(
    say(walk("proposal-accepted")),
    "Because we're supplying your equipment, you can cancel without giving a reason until 14 days after the day it's delivered to you. We'll tell you the exact date when it arrives.",
  );
  assert.equal(say(walk("kit-delivered")), "You can cancel without giving a reason until the end of Friday 27 November 2026.");
  assert.equal(say(walk("proposal-accepted", INSTALL_ONLY)), "You can cancel without giving a reason until the end of Tuesday 10 November 2026.");
  assert.equal(say(walk("kit-delivered"), "2026-11-28"), "Your cancellation period ended on Friday 27 November 2026.");
  assert.match(cancellationCopy(walk("proposal-accepted"), { settings: mergeSettings({ scheduling: { cancellationDays: 21 } }) }), /until 21 days after/);
  for (const text of all) assert.doesNotMatch(text, /of accepting/);
});

test("early-start wording: the loss-of-right sentence only on install-only", () => {
  assert.doesNotMatch(earlyStartWording("supply-and-install"), /lose my right/);
  assert.match(earlyStartWording("install-only"), /lose my right to cancel once the work has been fully completed/);
  assert.match(earlyStartWording("supply-and-install"), /^Please start my installation before my cancellation period ends\./);
  for (const t of ["supply-and-install", "install-only"] as const) assert.match(earlyStartWording(t), /^[\x20-\x7e]+$/, "plain ASCII, easy to type");
});

test("install-day-started: day 1 needs ready-to-install; later days need the day before", () => {
  const p = walk("installer-on-my-way");
  const r = refuses(p, { type: "install-day-started", n: 1, by: "Ian" }, T.day1, {
    kit: { requiredLines: 4, deliveredLines: 2, inspectedLines: 0, damaged: 0 },
  }, /2 of 4 kit lines delivered/);
  assert.ok(!r.ok && r.blockers?.[0]?.gate === "ready-to-install");
  refuses(p, { type: "install-day-started", n: 2, by: "Ian" }, T.day1, {}, /Day 1 hasn't started/);
  refuses(p, { type: "install-day-started", n: 0, by: "Ian" }, T.day1, {}, /Which install day/);
  refuses(walk("install-dates-set"), { type: "install-day-started", n: 1, by: "Ian" }, T.day1, {}, /isn't booked/);

  const day1 = walk("day-1");
  assert.equal(day1.install.status, "in-progress");
  assert.equal(day1.install.days[0]!.status, "in-progress");
  assert.equal(day1.install.days[1]!.status, "planned");
  assert.match(day1.events.at(-1)!.label, /^Day 1 of 3 has started\. Ian Stall is on site\.$/);
  refuses(day1, { type: "install-day-started", n: 1, by: "Ian" }, T.day1, {}, /already started/);
  // Day 2 only needs day 1 started, not ended.
  assert.ok(apply(day1, { type: "install-day-started", n: 2, by: "Ian" }, "2026-11-18T08:30:00.000Z").ok);
});

test("an overrun day beyond the plan is allowed and recorded", () => {
  let p = walk("day-3");
  p = step(p, { type: "install-day-ended", n: 3, summary: "Not quite" }, "2026-11-19T17:00:00.000Z", { actor: INSTALLER });
  p = step(p, { type: "install-day-started", n: 4, by: "Ian Stall" }, "2026-11-20T08:30:00.000Z", { actor: INSTALLER });
  assert.equal(p.install.days.length, 4);
  assert.equal(p.install.days[3]!.date, "2026-11-20");
  assert.equal(p.events.at(-1)!.label, "Day 4 has started. Ian Stall is on site.");
  refuses(p, { type: "install-day-started", n: 6, by: "Ian" }, "2026-11-21T08:30:00.000Z", {}, /Day 5/);
});

test("install-day-ended needs the day started; the customer sees the update", () => {
  refuses(walk("installer-on-my-way"), { type: "install-day-ended", n: 1, summary: "x" }, T.day1, {}, /Day 1 hasn't started/);
  const p = walk("day-1-end");
  assert.equal(p.install.days[0]!.status, "done");
  assert.equal(p.events.at(-1)!.label, "Day 1 done: Holes drilled and sealed, brackets up.");
  assert.equal(p.install.days[0]!.customerUpdate?.mediaIds[0], "m-1");
  const quiet = walk("day-2-end");
  assert.equal(quiet.events.at(-1)!.label, "Day 2 wrapped up.");
});

test("install-completed needs the install-complete gate", () => {
  const p = walk("day-3");
  const c = (over: Partial<ReadinessContext>) => ctx(T.done, over);
  const open = blockersFor(p, c({ runsheet: { complete: false, openExceptions: 2, missing: 3, blocked: 1, walkthroughDone: false } }), "install-complete");
  assert.deepEqual(codes(open), ["runsheet-incomplete", "exceptions-open"]);
  assert.equal(open[1]!.owner, "tech-lead");
  assert.deepEqual(codes(blockersFor(p, c({ runsheet: undefined }), "install-complete")), ["runsheet-missing"]);
  refuses(p, { type: "install-completed" }, T.done, { runsheet: { complete: true, openExceptions: 1, missing: 0, blocked: 0, walkthroughDone: true } }, /exception/);
  refuses(walk("installer-on-my-way"), { type: "install-completed" }, T.done, {}, /hasn't started/);
  const done = walk("install-completed");
  assert.equal(done.install.status, "complete");
  assert.ok(done.install.days.every((d) => d.status === "done")); // day 3 closed off with the install
});

/* ------------------------------------------------------------------ */
/* Handover + close                                                    */
/* ------------------------------------------------------------------ */

test("commissioning-signed: install complete, a qualified tech lead", () => {
  const sign: ProjectAction = { type: "commissioning-signed", by: "Tess Lead" };
  refuses(walk("day-3"), sign, T.done, { actor: TECH_LEAD }, /isn't complete/);
  const p = walk("install-completed");
  refuses(p, sign, T.done, { actor: INSTALLER }, /can't do this/);
  refuses(p, sign, T.done, { actor: { ...TECH_LEAD, external: true, qualifications: [] } }, /current F-gas/);
  refuses(p, sign, T.done, {}, /signed-in technical lead/);
  // No commissioning record in install_jobs: the commissioned gate's rule.
  const unsigned = refuses(p, sign, T.done, { actor: TECH_LEAD, commissioning: { signed: false } }, /commissioning results/);
  assert.ok(!unsigned.ok && unsigned.blockers?.map((b) => b.code).join() === "commissioning-unsigned");
  refuses(p, sign, T.done, { actor: TECH_LEAD, commissioning: undefined }, /commissioning results/);
  const signed = walk("commissioning-signed");
  assert.equal(signed.handover.status, "commissioned");
  refuses(signed, sign, T.done, { actor: TECH_LEAD }, /already signed off/);
  // The verified signer, not the typed name.
  const typed = step(p, { type: "commissioning-signed", by: "Someone Else" }, T.done, { actor: TECH_LEAD });
  assert.equal(typed.handover.commissionedBy, "Tess Lead");
  assert.match(typed.events.at(-1)!.label, /signed off by Tess Lead\.$/);
});

test("handover: pack after commissioning, signature after the pack and the walkthrough", () => {
  refuses(walk("install-completed"), { type: "handover-pack-published", documentId: "doc" }, T.handover, {}, /Commissioning/);
  const sign: ProjectAction = { type: "handover-signed", name: "Alex Demo", outcome: "all-good", snagCount: 0 };
  refuses(walk("commissioning-signed"), sign, T.handover, {}, /Publish the handover pack/);
  const pack = walk("handover-pack-published");
  refuses(pack, sign, T.handover, { runsheet: { complete: true, openExceptions: 0, missing: 0, blocked: 0, walkthroughDone: false } }, /walkthrough/);
  refuses(pack, { ...sign, outcome: "snags", snagCount: 0 } as ProjectAction, T.handover, {}, /at least one snag/);
  refuses(pack, { ...sign, snagCount: 2 } as ProjectAction, T.handover, {}, /no snags/);
  refuses(pack, { ...sign, name: " " } as ProjectAction, T.handover, {}, /name/);
  const snags = step(pack, { ...sign, outcome: "snags", snagCount: 2 } as ProjectAction, T.handover);
  assert.equal(snags.handover.status, "handed-over");
  assert.equal(snags.events.at(-1)!.actor, "customer");
  assert.equal(snags.events.at(-1)!.actorName, "Alex Demo");
  assert.match(snags.events.at(-1)!.label, /2 snags to fix/);
  assert.equal(snags.handover.warrantyDueOn, "2026-12-19");
  assert.equal(snags.aftercare.serviceDueOn, "2027-11-19");
  refuses(snags, sign, T.handover, {}, /already signed/);
});

test("handed-over gate lists each missing piece", () => {
  const p = walk("commissioning-signed");
  const bs = blockersFor(p, ctx(T.handover, { runsheet: { complete: true, openExceptions: 0, missing: 0, blocked: 0, walkthroughDone: false } }), "handed-over");
  assert.deepEqual(codes(bs), ["pack-not-published", "signoff-missing", "walkthrough-not-done"]);
  assert.deepEqual(codes(blockersFor(walk("install-completed"), ctx(T.handover), "handed-over")).slice(0, 1), ["not-commissioned"]);
  assert.deepEqual(codes(blockersFor(walk("install-completed"), ctx(T.handover, { commissioning: { signed: false } }), "commissioned")), ["commissioning-unsigned"]);
});

test("closed gate: money, electrical certificate, warranty, serious issues", () => {
  const p = walk("handover-signed");
  const c = (over: Partial<ReadinessContext>) => ctx(T.close, over);
  assert.deepEqual(codes(blockersFor(p, c({ money: { depositDuePence: 0, depositPaidPence: 0, outstandingPence: 50_000 } }), "closed")), [
    "balance-outstanding",
    "not-fully-invoiced",
    "electrical-cert-pending",
    "warranty-not-registered",
  ]);
  assert.equal(severityOf(blockersFor(p, c({}), "closed"), "not-fully-invoiced"), "warn");
  assert.equal(severityOf(blockersFor(p, c({ money: undefined }), "closed"), "money-unknown"), "block");
  const ready = walk("payment-recorded");
  assert.deepEqual(blockersFor(ready, c({}), "closed"), []);
  const serious = blockersFor(ready, c({ openIssues: [{ id: "i9", title: "Drip from the bedroom unit", kind: "defect", severity: "high", blocking: false }] }), "closed");
  assert.deepEqual(codes(serious), ["issue:i9"]);
  const notRequired = step(walk("handover-signed"), { type: "electrical-cert-updated", status: "not-required" }, T.after, { actor: ADMIN });
  assert.ok(!codes(blockersFor(notRequired, c({}), "closed")).includes("electrical-cert-pending"));
});

test("project-closed needs the closed gate, unless it's a cancellation", () => {
  refuses(walk("handover-signed"), { type: "project-closed" }, T.close, {}, /certificate/);
  const cancelled = step(walk("proposal-accepted"), { type: "project-closed", reason: "cancelled" }, T.dates, { actor: ADMIN });
  assert.equal(cancelled.closure.closed, true);
  assert.equal(cancelled.events.at(-1)!.label, "Project cancelled.");
  assert.equal(customerNextAction(cancelled), null);
  refuses(cancelled, { type: "install-dates-set", startDate: INSTALL_DATES[0]!, dates: INSTALL_DATES }, T.dates, {}, /closed/);
  refuses(cancelled, { type: "project-closed" }, T.dates, {}, /closed/);
  // Records, money and aftercare still work on a closed project.
  assert.ok(apply(cancelled, { type: "note", text: "Refund agreed by phone" }, T.dates).ok);
  assert.ok(apply(cancelled, { type: "payment-recorded", amountPence: -10_000 }, T.dates).ok);
});

test("warranty, certificates, invoices and payments", () => {
  const p = walk("warranty-registered");
  assert.equal(p.handover.warrantyRegistered, true);
  assert.equal(p.handover.electricalCert, "received");
  refuses(p, { type: "warranty-registered" }, T.after, {}, /already registered/);
  refuses(p, { type: "electrical-cert-updated", status: "received" }, T.after, {}, /already marked/);
  refuses(p, { type: "invoice-issued", amountPence: 10.5 }, T.after, {}, /whole-pence/);
  refuses(p, { type: "payment-recorded", amountPence: 0 }, T.after, {}, /whole-pence/);
  const credit = step(walk("invoice-issued"), { type: "invoice-issued", amountPence: -5_000 }, T.after, { actor: ADMIN });
  assert.equal(credit.money.invoicedPence, 640_000);
  assert.match(credit.events.at(-1)!.label, /Credit note for £50/);
});

test("survey-fee-paid: status only, once, and only when there's a fee", () => {
  const due = fresh({}, { surveyFeeGbp: 150 });
  const paid = step(due, { type: "survey-fee-paid", amountPence: 15_000 }, T.book);
  assert.equal(paid.survey.paymentStatus, "paid");
  assert.equal(projectFees(paid).surveyPaidGbp, 150);
  assert.equal(paid.money.paidPence, 0, "money moves through payment-recorded only");
  assert.match(paid.events.at(-1)!.label, /Survey fee of £150 received/);
  refuses(paid, { type: "survey-fee-paid", amountPence: 15_000 }, T.book, {}, /already paid/);
  refuses(due, { type: "survey-fee-paid", amountPence: 0 }, T.book, {}, /positive/);
  refuses(due, { type: "survey-fee-paid", amountPence: 150.5 }, T.book, {}, /positive/);
  refuses(fresh(), { type: "survey-fee-paid", amountPence: 15_000 }, T.book, {}, /no survey fee/);
  // A late payment still lands after the project closes.
  const closed = { ...walk(), survey: { ...walk().survey, feeGbp: 150, paymentStatus: "unpaid" as const } };
  assert.ok(apply(closed, { type: "survey-fee-paid", amountPence: 15_000 }, T.close).ok);
});

/* ------------------------------------------------------------------ */
/* Small actions                                                       */
/* ------------------------------------------------------------------ */

test("set-owner sets and clears the board owner, internally, even after close", () => {
  let p = step(fresh(), { type: "set-owner", staffId: "s-sv", name: "Sam Survey" }, T.book, { actor: ADMIN });
  assert.deepEqual(p.owner, { staffId: "s-sv", name: "Sam Survey" });
  assert.equal(p.events.at(-1)!.type, "owner-set");
  assert.equal(p.events.at(-1)!.internal, true);
  refuses(p, { type: "set-owner", staffId: "s-sv", name: "Sam Survey" }, T.book, {}, /already owns/);
  refuses(p, { type: "set-owner", staffId: "s-tl", name: " " }, T.book, {}, /Pick who/);
  p = step(p, { type: "set-owner", staffId: "", name: "" }, T.book, { actor: ADMIN });
  assert.equal(p.owner, undefined);
  refuses(p, { type: "set-owner", staffId: "", name: "" }, T.book, {}, /no owner/);
  assert.equal(step(walk(), { type: "set-owner", staffId: "s-tl", name: "Tess Lead" }, T.close, { actor: ADMIN }).owner?.name, "Tess Lead");
});

test("prep checklist ticks, informational items don't", () => {
  const p = step(fresh(), { type: "prep-toggled", itemId: "parking", done: true }, T.book);
  assert.ok(p.booking.prep.find((i) => i.id === "parking")!.done);
  assert.equal(p.events.at(-1)!.internal, true);
  refuses(p, { type: "prep-toggled", itemId: "power-off", done: true }, T.book, {}, /informational/);
  refuses(p, { type: "prep-toggled", itemId: "nope", done: true }, T.book, {}, /Unknown/);
});

test("aftercare: check-in and feedback request once each, feedback scored 0–10", () => {
  const p = walk("aftercare-checkin-sent");
  refuses(p, { type: "aftercare-checkin-sent" }, T.close, {}, /already/);
  const asked = step(p, { type: "feedback-requested" }, T.close);
  refuses(asked, { type: "feedback-requested" }, T.close, {}, /already/);
  refuses(asked, { type: "feedback-submitted", score: 11 }, T.close, {}, /0 to 10/);
  refuses(asked, { type: "feedback-submitted", score: 7.5 }, T.close, {}, /0 to 10/);
  assert.ok(apply(asked, { type: "feedback-submitted", score: 0 }, T.close).ok);
});

test("review request: everyone, at the same point, never on the score; once; only with a review link", () => {
  const withLink = ready({ company: { reviewUrl: "https://reviews.example/dang-its-hot" } });
  const handed = walk(); // handed over 19 Nov, paperwork done, feedback 9/10
  const day = (n: number) => new Date(Date.parse("2026-11-19T12:00:00.000Z") + n * 86_400_000).toISOString();
  assert.equal(reviewRequestDue(handed, day(REVIEW_REQUEST_DAYS - 1), withLink), false);
  assert.equal(reviewRequestDue(handed, day(REVIEW_REQUEST_DAYS), withLink), true);
  assert.equal(reviewRequestDue(handed, day(REVIEW_REQUEST_DAYS), READY), false, "no review link in settings: never");
  // The score makes no difference at all (no review gating).
  for (const score of [0, 3, 10]) {
    const scored = { ...handed, aftercare: { ...handed.aftercare, feedback: { at: T.close, score } } };
    assert.equal(reviewRequestDue(scored, day(REVIEW_REQUEST_DAYS), withLink), true, `score ${score}`);
  }
  const noFeedback = { ...handed, aftercare: { ...handed.aftercare, feedback: undefined, feedbackRequestedAt: undefined } };
  assert.equal(reviewRequestDue(noFeedback, day(REVIEW_REQUEST_DAYS), withLink), true);
  // Not while the paperwork is incomplete, not after an opt-out, not twice.
  const certPending = { ...handed, handover: { ...handed.handover, electricalCert: "pending" as const } };
  assert.equal(reviewRequestDue(certPending, day(60), withLink), false);
  const asked = step(handed, { type: "review-requested" }, day(REVIEW_REQUEST_DAYS));
  assert.equal(asked.events.at(-1)!.internal, true);
  assert.equal(reviewRequestDue(asked, day(60), withLink), false);
  refuses(asked, { type: "review-requested" }, day(60), {}, /already/);
  const optedOut = step(handed, { type: "aftercare-opt-out", optedOut: true }, day(10));
  assert.equal(reviewRequestDue(optedOut, day(60), withLink), false);
  assert.equal(reviewRequestDue(walk("handover-pack-published"), day(60), withLink), false);
});

test("change-of-season check: the first turn of the season after handover, once", () => {
  const at = (handedOverAt: string) => {
    const p = walk();
    return { ...p, handover: { ...p.handover, handedOverAt } };
  };
  assert.deepEqual(seasonalCheck(at("2026-11-19T16:00:00.000Z")), { on: "2027-06-01", mode: "cooling" }); // winter install
  assert.deepEqual(seasonalCheck(at("2026-02-10T16:00:00.000Z")), { on: "2026-06-01", mode: "cooling" });
  assert.deepEqual(seasonalCheck(at("2026-07-14T16:00:00.000Z")), { on: "2026-10-01", mode: "heating" }); // summer install
  assert.deepEqual(seasonalCheck(at("2026-09-20T16:00:00.000Z")), { on: "2026-10-18", mode: "heating" }); // never within 28 days
  assert.equal(seasonalCheck(walk("handover-pack-published")), null);

  const p = walk();
  assert.equal(seasonalCheckDue(p, "2027-05-31"), false);
  assert.equal(seasonalCheckDue(p, "2027-06-01"), true);
  const sent = step(p, { type: "seasonal-check-sent" }, "2027-06-01T09:00:00.000Z");
  assert.equal(seasonalCheckDue(sent, "2027-06-02"), false);
  refuses(sent, { type: "seasonal-check-sent" }, "2027-06-02T09:00:00.000Z", {}, /already/);
  assert.equal(seasonalCheckDue(step(p, { type: "aftercare-opt-out", optedOut: true }, T.close), "2027-06-01"), false);
});

test("aftercare-opt-out: the customer can stop follow-ups (and start them again), even after close", () => {
  const p = walk(); // closed
  const off = step(p, { type: "aftercare-opt-out", optedOut: true }, "2026-12-21T09:00:00.000Z");
  assert.equal(off.aftercare.followUpsOptedOutAt, "2026-12-21T09:00:00.000Z");
  assert.equal(off.events.at(-1)!.actor, "customer");
  assert.match(off.events.at(-1)!.label, /No more follow-up emails/);
  refuses(off, { type: "aftercare-opt-out", optedOut: true }, T.close, {}, /already off/);
  const on = step(off, { type: "aftercare-opt-out", optedOut: false }, "2026-12-22T09:00:00.000Z", { actor: ADMIN });
  assert.equal(on.aftercare.followUpsOptedOutAt, undefined);
  assert.equal(on.events.at(-1)!.actor, "ops");
  refuses(on, { type: "aftercare-opt-out", optedOut: false }, T.close, {}, /already on/);
});

test("next action, pilot tag, contact details and notes are internal records", () => {
  let p = step(fresh(), { type: "set-next-action", text: "Call about parking", dueOn: "2026-10-21", ownerRole: "surveyor" }, T.book, { actor: ADMIN });
  assert.deepEqual(p.nextAction, { text: "Call about parking", dueOn: "2026-10-21", ownerRole: "surveyor" });
  p = step(p, { type: "set-next-action", text: "" }, T.book, { actor: ADMIN });
  assert.equal(p.nextAction, undefined);
  p = step(p, { type: "set-pilot", number: 2, label: "Purley" }, T.book, { actor: ADMIN });
  assert.deepEqual(p.pilot, { number: 2, label: "Purley" });
  refuses(p, { type: "set-pilot", number: 0, label: "x" }, T.book, {}, /1 or more/);
  p = step(p, { type: "set-customer-contact", phone: "07700 900000", parkingNotes: "Permit zone B", email: "" }, T.book);
  assert.equal(p.customer.phone, "07700 900000");
  assert.equal(p.customer.parkingNotes, "Permit zone B");
  assert.equal(p.customer.email, undefined); // cleared
  refuses(p, { type: "set-customer-contact" }, T.book, {}, /Nothing/);
  p = step(p, { type: "note", text: "Dog is friendly" }, T.book, { actor: ADMIN });
  assert.equal(p.events.at(-1)!.internal, true);
  refuses(p, { type: "note", text: " " }, T.book, {}, /Write something/);
  assert.ok(p.events.filter((e) => e.type !== "project-created").every((e) => e.internal));
});

/* ------------------------------------------------------------------ */
/* Readiness + next gate                                               */
/* ------------------------------------------------------------------ */

test("readiness lists blockers for every gate not yet passed, in order", () => {
  const p = walk("survey-submitted");
  const all = readiness(p, ctx(T.surveyDone, { design: { status: "draft", compatibilityErrors: [] } }));
  const gates = [...new Set(all.map((b) => b.gate))];
  assert.equal(gates[0], "proposal-issue");
  assert.ok(!gates.includes("survey-complete")); // passed gates are history
  const order = (g: GateId) => ["proposal-issue", "proposal-accept", "booking", "ready-to-install", "install-complete", "commissioned", "handed-over", "closed"].indexOf(g);
  assert.ok(all.every((b, i) => i === 0 || order(all[i - 1]!.gate) <= order(b.gate)));
  assert.deepEqual(readiness(walk("project-closed"), ctx(T.close)), []);
  assert.ok(all.every((b) => b.message.length > 0 && b.owner));
});

test("a blocking issue holds its gate and every later one", () => {
  const p = walk("survey-submitted");
  const c = ctx(T.surveyDone, { openIssues: [{ id: "i1", title: "Structural crack", kind: "safety", severity: "high", blocking: true, gate: "proposal-issue" }] });
  for (const g of ["proposal-issue", "booking", "closed"] as GateId[]) assert.ok(codes(blockersFor(p, c, g)).includes("issue:i1"), g);
  assert.ok(!codes(blockersFor(p, c, "survey-complete")).includes("issue:i1"));
});

test("nextGate and isGatePassed track the project's own state", () => {
  assert.equal(nextGate(fresh()), "survey-complete");
  assert.equal(nextGate(walk("survey-submitted")), "proposal-issue");
  assert.equal(nextGate(walk("proposal-issued")), "proposal-accept");
  assert.equal(nextGate(walk("proposal-accepted")), "booking");
  assert.equal(nextGate(walk("booking-confirmed")), "ready-to-install");
  assert.equal(nextGate(walk("day-1")), "install-complete");
  assert.equal(nextGate(walk("install-completed")), "commissioned");
  assert.equal(nextGate(walk("commissioning-signed")), "handed-over");
  assert.equal(nextGate(walk("handover-signed")), "closed");
  assert.ok(isGatePassed(walk("proposal-accepted"), "proposal-issue"));
});

test("survey-complete gate tells the customer to book first", () => {
  const bs = blockersFor(fresh(), ctx(T.create, { surveyCompleteness: undefined }), "survey-complete");
  assert.deepEqual(codes(bs), ["survey-not-booked", "survey-not-started"]);
  assert.equal(bs[0]!.owner, "customer");
});

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

test("timeline: actual where it happened, confirmed where booked, estimated ahead", () => {
  const f = projectTimeline(fresh(), T.create);
  assert.deepEqual(f.map((e) => e.stage), [...PROJECT_STAGES]);
  assert.equal(f[0]!.date?.kind, "actual");
  assert.ok(f.slice(1).every((e) => e.date?.kind === "estimated"));
  const by = (entries: typeof f) => Object.fromEntries(entries.map((e) => [e.stage, e]));
  const fe = by(f);
  assert.equal(fe.survey!.date!.iso, "2026-10-26"); // Mon + 5 working days
  assert.equal(fe.proposal!.date!.iso, "2026-10-29"); // + 3 working days
  // Acceptance + 14-day cancellation, then the next working day.
  assert.equal(fe.install!.date!.iso, "2026-11-13");
  assert.ok(f.every((e) => !e.date || e.date.iso.slice(0, 10) >= "2026-10-19"));

  const booked = by(projectTimeline(walk("kit-confirmed"), "2026-10-30T10:00:00.000Z"));
  assert.equal(booked.survey!.date!.kind, "actual");
  assert.equal(booked.proposal!.date!.kind, "actual");
  assert.equal(booked.booking!.date!.kind, "actual");
  assert.deepEqual(booked.install!.date, { kind: "confirmed", iso: "2026-11-17" });
  assert.deepEqual(booked.kit!.date, { kind: "confirmed", iso: "2026-11-13" });
  assert.deepEqual(booked.handover!.date, { kind: "estimated", iso: "2026-11-19" });
  assert.deepEqual(booked.aftercare!.date, { kind: "estimated", iso: "2026-11-26" });
  assert.equal(booked.kit!.state, "current");

  // Ordered (not supplier-confirmed) kit with a date stays an estimate.
  const ordered = step(walk("booking-confirmed"), { type: "kit-updated", status: "ordered", expectedDate: "2026-11-12", shortages: 0 }, T.dates, { actor: ADMIN });
  assert.deepEqual(by(projectTimeline(ordered, T.dates)).kit!.date, { kind: "estimated", iso: "2026-11-12" });

  // Chosen but unconfirmed dates are an estimate too.
  assert.equal(by(projectTimeline(walk("install-dates-set"), T.dates)).install!.date!.kind, "estimated");

  const done = by(projectTimeline(walk(), "2026-12-20T10:00:00.000Z"));
  for (const stage of PROJECT_STAGES) assert.equal(done[stage]!.date!.kind, "actual", stage);
  assert.equal(done.kit!.date!.iso, T.kit);
  assert.equal(done.aftercare!.date!.iso, T.close);
});

test("timeline estimates never sit in the past", () => {
  const overdue = walk("book-survey"); // survey slot 22 Oct, now it's November
  const entries = projectTimeline(overdue, "2026-11-02T09:00:00.000Z");
  for (const e of entries.slice(2)) assert.ok(e.date!.iso.slice(0, 10) >= "2026-11-02", e.stage);
  assert.equal(entries[1]!.date!.kind, "confirmed"); // the booked slot is still shown as booked
});

/* ------------------------------------------------------------------ */
/* Customer next action                                                */
/* ------------------------------------------------------------------ */

test("customerNextAction: one clear label per state", () => {
  const label = (p: Project) => customerNextAction(p)?.label ?? null;
  assert.deepEqual(customerNextAction(fresh()), { label: "Book your home survey", href: "/p/proj-1#survey" });
  assert.equal(label(walk("book-survey")), "Get ready for your survey");
  assert.equal(label(walk("survey-started")), null);
  // While we design, the one thing they can do: agree to email delivery (the proposal can't go without it).
  assert.deepEqual(customerNextAction(walk("survey-submitted")), { label: "Agree to get your documents by email", href: "/p/proj-1#proposal" });
  assert.equal(label(walk("documents-consent-recorded")), null); // we're designing
  assert.deepEqual(customerNextAction(walk("proposal-issued")), { label: "Review your proposal", href: "/p/proj-1/proposal" });
  assert.equal(label(step(walk("proposal-viewed"), { type: "proposal-changes-requested", text: "Left a bit" }, T.accept)), null);
  assert.equal(label(step(walk("proposal-viewed"), { type: "proposal-expired" }, "2026-11-26T10:00:00.000Z")), "Ask us for an updated proposal");
  assert.equal(label(walk("proposal-accepted")), "Choose your install dates");
  assert.equal(label(walk("contract-confirmation-sent")), "Choose your install dates"); // dates first
  // They ticked "start early": the confirmation email asks them to reply with the wording.
  assert.deepEqual(customerNextAction(walk("install-dates-set")), { label: "Reply to confirm your early start", href: "/p/proj-1#booking" });
  assert.equal(label(walk("early-start-evidenced")), null); // we confirm
  assert.equal(label(walk("install-dates-set", { early: false })), null);
  const deposit = step(walk("proposal-accepted"), { type: "deposit-requested", amountPence: 129_000 }, T.dates, { actor: ADMIN });
  assert.deepEqual(customerNextAction(deposit), { label: "Pay your deposit", href: "/p/proj-1/pay" });
  assert.equal(label(walk("booking-confirmed")), "Get your home ready");
  let ready = walk("booking-confirmed");
  for (const item of ready.booking.prep.filter((i) => i.confirmable)) {
    ready = step(ready, { type: "prep-toggled", itemId: item.id, done: true }, T.dates);
  }
  assert.equal(label(ready), null);
  assert.equal(label(walk("day-1")), null);
  assert.equal(label(walk("commissioning-signed")), null);
  assert.equal(label(walk("handover-pack-published")), "Check your handover pack");
  assert.equal(label(walk("handover-signed")), "Check your handover pack");
  assert.equal(label(walk("invoice-issued")), "Pay your balance");
  assert.equal(label(walk("payment-recorded")), "Check your handover pack");
  assert.equal(label(walk("project-closed")), null);
  assert.deepEqual(customerNextAction(walk("feedback-requested")), { label: "Tell us how it's going", href: "/p/proj-1#aftercare" });
  assert.equal(label(walk()), null); // feedback given
});

/* ------------------------------------------------------------------ */
/* Creation, fees, copy                                                */
/* ------------------------------------------------------------------ */

test("createProject seeds a v2 project from the quote", () => {
  const p = fresh();
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.customer.email, "alex@example.test");
  assert.equal(p.survey.status, "not-booked");
  assert.equal(p.survey.mode, "in-person");
  assert.equal(p.survey.feeGbp, 0);
  assert.equal(p.survey.paymentStatus, "not-required");
  assert.equal(p.survey.durationMinutes, 90);
  assert.equal(p.booking.installDays, 3);
  assert.equal(p.booking.prep.length, 6);
  assert.equal(p.proposal.status, "not-issued");
  assert.equal(p.electrics.status, "provisional");
  assert.equal(p.events.length, 1);
  const paid = fresh({}, { surveyFeeGbp: 150 });
  assert.equal(paid.survey.paymentStatus, "unpaid");
  assert.equal(paid.survey.feeGbp, 150);
  assert.equal(projectFees(paid).surveyPaidGbp, 0);
});

test("reschedule fees keep the v1 bands, with the site visit as the survey", () => {
  assert.equal(rescheduleFeeGbp("survey", 7), 0);
  assert.equal(rescheduleFeeGbp("survey", 6), 25);
  assert.equal(rescheduleFeeGbp("survey", 0), 25);
  assert.equal(rescheduleFeeGbp("installation", 7), 0);
  assert.equal(rescheduleFeeGbp("installation", 1), 150);
  assert.equal(rescheduleFeeGbp("installation", -3), 150);
});

test("stage copy covers every stage and never states warranty years", () => {
  for (const stage of PROJECT_STAGES) {
    const info = STAGE_INFO[stage];
    assert.equal(info.id, stage);
    assert.ok(info.label && info.title && info.strap && info.explainer.length >= 2);
    const all = [info.title, info.strap, ...info.explainer].join(" ");
    assert.doesNotMatch(all, /\d+[- ]year/i, stage);
  }
  assert.deepEqual(PROJECT_STAGES.map((s) => STAGE_INFO[s].label), ["Price", "Survey", "Proposal", "Booking", "Kit", "Install", "Handover", "Aftercare"]);
});

test("stage copy never hard-codes what settings control; stageInfo fills it in", () => {
  const generic = PROJECT_STAGES.map((s) => [STAGE_INFO[s].strap, ...STAGE_INFO[s].explainer].join(" ")).join(" ");
  assert.doesNotMatch(generic, /14 days|three-day|Three days|day three|90 minutes/);

  const defaults = (stage: (typeof PROJECT_STAGES)[number]) => stageInfo(stage, DEFAULT_SETTINGS);
  assert.doesNotMatch(generic, /of accepting/);
  assert.match(defaults("booking").explainer[0]!, /three-day block/);
  assert.match(defaults("booking").explainer[2]!, /until 14 days after your equipment is delivered \(or 14 days after you accept, if you're supplying the equipment yourself\)/);
  assert.doesNotMatch(defaults("booking").explainer[2]!, /of accepting/);
  // With the project, its own contract's sentence.
  assert.match(stageInfo("booking", READY, walk("kit-delivered")).explainer[2]!, /^You can cancel without giving a reason until the end of Friday 27 November 2026\. We start after it ends/);
  assert.match(defaults("install").strap, /^Three days,/);
  assert.match(defaults("install").explainer[0]!, /day three is pipes/);
  assert.match(defaults("survey").strap, /about 90 minutes/);

  const other = mergeSettings({ scheduling: { installBlockDays: 2, cancellationDays: 21, surveyDurationMinutes: 60 } });
  assert.match(stageInfo("booking", other).explainer[0]!, /two-day block/);
  assert.match(stageInfo("booking", other).explainer[2]!, /until 21 days after/);
  assert.match(stageInfo("install", other).strap, /^Two days,/);
  assert.equal(stageInfo("install", other).explainer[0], STAGE_INFO.install.explainer[0]); // no day-by-day for two days
  assert.match(stageInfo("survey", other).strap, /about 60 minutes/);
  assert.match(stageInfo("install", mergeSettings({ scheduling: { installBlockDays: 1 } })).strap, /^One day,/);
  assert.equal(stageInfo("price", other).strap, STAGE_INFO.price.strap);
  assert.notEqual(stageInfo("booking", other).explainer, STAGE_INFO.booking.explainer, "a copy, never the shared array");
  assert.match(STAGE_INFO.booking.explainer[0]!, /^Choose install dates/);
});

test("daysBetween is shared with v1", () => {
  assert.equal(daysBetween("2026-07-01T23:00:00.000Z", "2026-07-08"), 7);
});

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

const V1_NOW = "2026-07-01T10:00:00.000Z";

function v1(actions: ProjectActionV1[]): ProjectV1 {
  const s = survey();
  let p = createProjectV1({ id: "v1-1", quoteId: "q-1", createdAt: V1_NOW, customerName: "Jo Legacy", survey: s, quote: generateQuote(s) });
  for (const action of actions) {
    const r = applyProjectActionV1(p, action, V1_NOW);
    assert.ok(r.ok, `${action.type}: ${r.ok ? "" : r.error}`);
    p = r.project;
  }
  return p;
}

const V1_ACCEPTED: ProjectActionV1[] = [{ type: "approve-floor-plan" }, { type: "accept-final-quote" }];
const V1_VISITED: ProjectActionV1[] = [
  ...V1_ACCEPTED,
  { type: "book-site-visit", scheduledFor: "2026-07-08T14:00:00.000Z", mode: "video" },
  { type: "pay-site-visit" },
  {
    type: "ops-complete-site-visit",
    summary: "All validated.",
    approvedForInstall: true,
    electricsStatus: "validated",
    electricsSummary: "Spare way 7.",
  },
];
const V1_INSTALLED: ProjectActionV1[] = [
  ...V1_VISITED,
  { type: "book-installation", date: "2026-07-20" },
  { type: "ops-mark-dispatched", courier: "DPD", trackingRef: "DPD-123" },
  { type: "ops-mark-delivered" },
  { type: "ops-assign-installer", installer: { name: "Dana Demo", role: "Installer", bio: "", yearsExperience: 3 } },
  { type: "ops-complete-installation" },
];

test("migrateProject: a fresh v1 project", () => {
  const old = v1([]);
  const p = migrateProject(old);
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.id, "v1-1");
  assert.equal(p.customer.name, "Jo Legacy");
  assert.equal(p.roughPlan.archetypeName, old.floorPlan.archetypeName);
  assert.equal(p.survey.status, "not-booked");
  assert.equal(p.survey.mode, "in-person"); // nothing agreed yet, so the v2 default
  assert.equal(old.siteVisit.feeGbp, 150);
  assert.equal(p.survey.feeGbp, 0); // never booked, so never agreed: the v2 (free) terms
  assert.equal(p.survey.paymentStatus, "not-required");
  // v1 auto-issued the final quote on a high-confidence survey.
  assert.equal(p.proposal.status, "issued");
  assert.equal(p.proposal.proposalId, undefined);
  assert.equal(p.booking.status, "not-booked");
  assert.equal(p.kit.status, "not-ordered");
  assert.equal(p.design.status, "not-started");
  assert.deepEqual(p.events, old.events);
  assert.equal(currentStage(p), "price");
});

test("migrateProject: accepted, and site visit completed", () => {
  const accepted = migrateProject(v1(V1_ACCEPTED));
  assert.equal(accepted.proposal.status, "accepted");
  assert.equal(accepted.proposal.contractTotalPence, accepted.quoteSummary.totalGbp * 100);
  assert.equal(accepted.money.contractTotalPence, accepted.quoteSummary.totalGbp * 100);
  // v1 always supplied the kit: supply-and-install, so no end date before delivery,
  // and no pre-contract information was ever sent (reg 31 applies once it is).
  assert.equal(accepted.proposal.contractType, "supply-and-install");
  assert.equal(accepted.proposal.cancellationEndsOn, undefined);
  assert.equal(cancellationStatus(accepted, "2026-08-01").basis, "goods-delivery");

  const visited = migrateProject(v1(V1_VISITED));
  assert.equal(visited.survey.status, "submitted");
  assert.equal(visited.survey.mode, "video");
  assert.equal(visited.survey.scheduledFor, "2026-07-08T14:00:00.000Z");
  assert.equal(visited.survey.paymentStatus, "paid"); // paid stays paid
  assert.equal(visited.survey.feeGbp, 150);
  assert.equal(projectFees(visited).surveyPaidGbp, 150); // what the balance invoice credits
  assert.equal(visited.survey.submittedAt, V1_NOW); // from the site-visit-completed event
  assert.equal(visited.electrics.status, "validated");
  assert.equal(currentStage(visited), "booking");
  assert.equal(visited.money.paidPence, 0); // a v1 button press isn't a verified payment
  const flag = visited.events.at(-1)!;
  assert.equal(flag.type, "migrated-survey-fee");
  assert.equal(flag.internal, true); // ops only: check it, then credit it
  assert.match(flag.label, /£150 site visit fee was marked paid/);
  assert.equal(visited.events.filter((e) => e.type === "migrated-survey-fee").length, 1);

  // Booked but unpaid: the fee was agreed at booking, so it stays.
  const booked = migrateProject(v1([...V1_ACCEPTED, { type: "book-site-visit", scheduledFor: "2026-07-08T14:00:00.000Z", mode: "video" }]));
  assert.deepEqual([booked.survey.feeGbp, booked.survey.paymentStatus], [150, "unpaid"]);
  assert.ok(!booked.events.some((e) => e.type === "migrated-survey-fee"));
});

test("isLegacySnapshot matches migrateProject's own v1 test", () => {
  assert.equal(isLegacySnapshot(v1([])), true);
  assert.equal(isLegacySnapshot({ id: "x", siteVisit: { status: "booked" } }), true);
  assert.equal(isLegacySnapshot(walk("book-survey")), false);
  assert.equal(isLegacySnapshot(migrateProject(v1(V1_VISITED))), false);
  assert.equal(isLegacySnapshot({ id: "y", survey: {} }), false); // a v2 snapshot missing its version
  assert.equal(isLegacySnapshot(null), false);
  assert.equal(isLegacySnapshot([]), false);
});

test("migrateProject: installed", () => {
  const p = migrateProject(v1(V1_INSTALLED));
  assert.equal(p.booking.status, "booked");
  assert.equal(p.booking.startDate, "2026-07-20");
  assert.equal(p.booking.dates.length, p.booking.installDays);
  assert.equal(p.booking.dates[0], "2026-07-20");
  assert.deepEqual(p.booking.crew, [{ staffId: "legacy", name: "Dana Demo", role: "installer", external: false }]);
  assert.equal(p.kit.status, "delivered");
  assert.equal(p.kit.expectedDate, "2026-07-18");
  assert.equal(p.kit.summary, "DPD, tracking DPD-123");
  // Delivered in v1: the supply-and-install period runs from that day.
  assert.equal(p.proposal.goodsReceivedOn, p.kit.deliveredAt!.slice(0, 10));
  assert.equal(p.proposal.cancellationEndsOn, "2026-07-15");
  assert.equal(p.install.status, "complete");
  assert.equal(p.handover.status, "pending");
  assert.equal(currentStage(p), "handover");
});

test("migrateProject: v1 fees carry over, multi-day bookings span working days", () => {
  const old = v1(V1_VISITED);
  old.installation = { ...old.installation, status: "booked", date: "2026-07-24", installDays: 2, rescheduleFeesGbp: 150 };
  old.delivery = { ...old.delivery, rescheduleFeesGbp: 60 };
  old.siteVisit = { ...old.siteVisit, rescheduleFeesGbp: 25 };
  const p = migrateProject(old);
  assert.deepEqual(p.booking.dates, ["2026-07-24", "2026-07-27"]); // Fri, then Mon
  assert.equal(projectFees(p).changeFeesGbp, 235);
  assert.equal(p.money.changeFeesPence, 23_500);
});

test("migrateProject is idempotent on v2 and tolerant of missing fields", () => {
  for (const raw of [v1([]), v1(V1_VISITED), v1(V1_INSTALLED)]) {
    const once = migrateProject(raw);
    assert.deepEqual(migrateProject(once), once);
    assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(once))), once);
  }
  const v2 = walk("booking-confirmed");
  assert.deepEqual(migrateProject(v2), v2);

  const sparse = migrateProject({ id: "x", siteVisit: { status: "booked" } });
  assert.equal(sparse.schemaVersion, 2);
  assert.equal(sparse.survey.status, "not-booked"); // booked with no slot isn't a booking
  assert.equal(sparse.booking.prep.length, 6);
  assert.deepEqual(sparse.events, []);

  const junkType = migrateProject({ schemaVersion: 2, id: "z", proposal: { status: "not-issued", contractType: "lease" } });
  assert.equal(junkType.proposal.contractType, "supply-and-install");
  const olderV2 = migrateProject({ schemaVersion: 2, id: "z2", proposal: { status: "accepted", acceptedAt: T.accept, earlyStartRequested: true } });
  assert.equal(olderV2.proposal.contractType, "supply-and-install");
  assert.equal(olderV2.proposal.earlyStart, undefined); // nothing invented; the boolean still reads as a request

  const partialV2 = migrateProject({ schemaVersion: 2, id: "y", survey: { status: "booked", scheduledFor: T.slot } });
  assert.equal(partialV2.survey.status, "booked");
  assert.equal(partialV2.survey.durationMinutes, 90);
  assert.equal(partialV2.kit.status, "not-ordered");
  assert.deepEqual(partialV2.install.days, []);
  assert.throws(() => migrateProject(null), /not a project/);
  assert.throws(() => migrateProject([1, 2]), /not a project/);
});

test("a migrated project keeps moving through the v2 reducer", () => {
  const p = migrateProject(v1(V1_VISITED));
  const r = applyProjectAction(p, { type: "install-dates-set", startDate: "2026-07-21", dates: ["2026-07-21", "2026-07-22", "2026-07-23"].slice(0, p.booking.installDays) }, "2026-07-15T10:00:00.000Z", ctx("2026-07-15"));
  assert.ok(r.ok, r.ok ? "" : r.error);
});
