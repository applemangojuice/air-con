import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createProject, generateQuote, mergeSettings, type Project, type Survey } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();

const schedule = await import("../components/portal/schedule.ts");
const view = await import("../components/portal/view.ts");

const SURVEY: Survey = {
  postcode: "SW4 7AA",
  addressLine: "1 Test Road (DEMO)",
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
      photos: [],
    },
  ],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

function project(now = "2026-10-19T09:00:00.000Z"): Project {
  return createProject({
    id: "11111111-1111-4111-8111-111111111111",
    quoteId: "22222222-2222-4222-8222-222222222222",
    createdAt: now,
    customerName: "Test Customer (DEMO)",
    survey: SURVEY,
    quote: generateQuote(SURVEY),
    installDays: 3,
  });
}

/** Accepted on `acceptedAt`, with the pre-contract information sent first (so reg 31 doesn't stretch the period). */
function accepted(acceptedAt: string, opts: { early?: boolean; contractType?: Project["proposal"]["contractType"] } = {}): Project {
  const p = project();
  p.survey.status = "submitted";
  p.proposal = {
    status: "accepted",
    contractType: opts.contractType ?? "supply-and-install",
    proposalId: "33333333-3333-4333-8333-333333333333",
    version: 1,
    issuedAt: "2026-10-01T09:00:00.000Z",
    preContractInfoSentAt: "2026-10-01T09:00:00.000Z",
    acceptedAt,
    acceptedOptionLabel: "Standard",
    contractTotalPence: 300_000,
    earlyStartRequested: opts.early ?? false,
    earlyStart: { requested: opts.early ?? false, wordingVersion: "early-start-v1" },
  };
  return p;
}

/* ------------------------------------------------------------------ */
/* Survey slots                                                        */
/* ------------------------------------------------------------------ */

test("survey slots: next 10 working days, weekends skipped, too-soon slots dropped", () => {
  // Monday 19 Oct 2026, 11:00 in London.
  const days = schedule.surveySlotDays({ settings: DEFAULT_SETTINGS, nowWall: "2026-10-19T11:00:00.000Z", taken: [] });
  assert.equal(days.length, 10);
  assert.equal(days[0]!.date, "2026-10-19");
  // 10:00 has passed and 13:00 is inside the four-hour notice: only 16:00 today.
  assert.deepEqual(days[0]!.slots.map((s) => s.time), ["16:00"]);
  assert.deepEqual(days[1]!.slots.map((s) => s.time), ["10:00", "13:00", "16:00"]);
  assert.ok(days.every((d) => ![6, 7].includes(schedule.isoWeekday(d.date))), "no weekend days");
  assert.equal(days[9]!.date, "2026-10-30");
  assert.equal(days[1]!.slots[0]!.iso, "2026-10-20T10:00:00.000Z");
});

test("survey slots: another project's booking takes its slot (and anything overlapping it)", () => {
  const days = schedule.surveySlotDays({
    settings: DEFAULT_SETTINGS,
    nowWall: "2026-10-19T07:00:00.000Z",
    taken: ["2026-10-19T13:00:00.000Z", "2026-10-20T10:30:00.000Z", "not a date"],
  });
  assert.deepEqual(days[0]!.slots.map((s) => s.time), ["16:00"], "10:00 too soon, 13:00 taken");
  assert.deepEqual(days[1]!.slots.map((s) => s.time), ["13:00", "16:00"], "10:30 survey overlaps the 10:00 slot");
  assert.equal(schedule.isOfferedSlot(days, "2026-10-20T13:00:00.000Z"), true);
  assert.equal(schedule.isOfferedSlot(days, "2026-10-20T10:00:00.000Z"), false);
});

test("survey slots: junk slot times are ignored and a fully booked day is left out", () => {
  const settings = mergeSettings({ scheduling: { surveySlotTimes: ["9am", "10:00"] } });
  const days = schedule.surveySlotDays({ settings, nowWall: "2026-10-19T05:00:00.000Z", taken: ["2026-10-20T10:00:00.000Z"], workingDays: 3 });
  assert.deepEqual(days.map((d) => d.date), ["2026-10-19", "2026-10-21"]);
  assert.deepEqual(days[0]!.slots.map((s) => s.time), ["10:00"]);
});

test("survey slots: a day every surveyor spends on an install isn't offered", () => {
  const ALEX = "a1", JO = "j1", SAM = "s1";
  const installs = [
    { dates: ["2026-10-20", "2026-10-21", "2026-10-22"], crewIds: [ALEX, JO] },
    { dates: ["2026-10-23"], crewIds: [ALEX] },
  ];
  // Both founders on Tue to Thu: no surveyor those days. Friday Jo is free.
  assert.deepEqual(schedule.datesWithNoSurveyor(installs, [ALEX, JO]), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  // A third surveyor who isn't installing keeps every day open; with nobody known, nothing is closed.
  assert.deepEqual(schedule.datesWithNoSurveyor(installs, [ALEX, JO, SAM]), []);
  assert.deepEqual(schedule.datesWithNoSurveyor(installs, []), []);
  const days = schedule.surveySlotDays({
    settings: DEFAULT_SETTINGS,
    nowWall: "2026-10-19T07:00:00.000Z",
    taken: [],
    unavailableDates: schedule.datesWithNoSurveyor(installs, [ALEX, JO]),
    workingDays: 6,
  });
  assert.deepEqual(days.map((d) => d.date), ["2026-10-19", "2026-10-23", "2026-10-26"]);
  assert.equal(schedule.isOfferedSlot(days, "2026-10-22T10:00:00.000Z"), false);
});

test("londonWallClock encodes London time the house way", () => {
  // 1 July: BST (UTC+1). 1 December: GMT.
  assert.equal(schedule.londonWallClock(new Date("2026-07-01T09:30:00Z")), "2026-07-01T10:30:00.000Z");
  assert.equal(schedule.londonWallClock(new Date("2026-12-01T09:30:00Z")), "2026-12-01T09:30:00.000Z");
});

/* ------------------------------------------------------------------ */
/* Install blocks                                                      */
/* ------------------------------------------------------------------ */

test("earliest offered start: supply-and-install with no early start waits for a possible delivery plus the period", () => {
  const p = accepted("2026-10-19T10:00:00.000Z");
  // Nothing ordered yet: the supplier's usual 5 working days → delivered Mon 26 Oct → period to 9 Nov → start Tue 10 Nov.
  assert.deepEqual(schedule.earliestOfferedStart(p, "2026-10-19", DEFAULT_SETTINGS), { date: "2026-11-10", reason: "awaiting-delivery" });
  // The orders say Thu 22 Oct (a confirmed ETA): period to 5 Nov → start Fri 6 Nov.
  assert.deepEqual(schedule.earliestOfferedStart(p, "2026-10-19", DEFAULT_SETTINGS, "2026-10-22"), { date: "2026-11-06", reason: "awaiting-delivery" });
  // Never sooner than a delivery tomorrow: 20 Oct → period to 3 Nov → start Wed 4 Nov.
  assert.deepEqual(schedule.earliestOfferedStart(p, "2026-10-19", DEFAULT_SETTINGS, "2026-10-01"), { date: "2026-11-04", reason: "awaiting-delivery" });
  // The cards and the server's check use the same floor.
  const blocks = schedule.installBlockOptions({ project: p, settings: DEFAULT_SETTINGS, today: "2026-10-19", booked: [], kitArrivesOn: "2026-10-22" });
  assert.ok(blocks.every((b) => b.startDate >= "2026-11-06"));
  assert.match(
    schedule.blockProblem({ project: p, settings: DEFAULT_SETTINGS, today: "2026-10-19", booked: [], dates: ["2026-11-05", "2026-11-06", "2026-11-09"], kitArrivesOn: "2026-10-22" }) ?? "",
    /earliest we can start is Fri 6 Nov/,
  );
});

test("earliest offered start: an early-start request or a known end date use the reducer's floor", () => {
  const early = accepted("2026-10-19T10:00:00.000Z", { early: true });
  assert.deepEqual(schedule.earliestOfferedStart(early, "2026-10-19", DEFAULT_SETTINGS), { date: "2026-10-26", reason: "early-start" });

  const delivered = accepted("2026-10-19T10:00:00.000Z");
  delivered.proposal.goodsReceivedOn = "2026-10-21";
  delivered.proposal.cancellationEndsOn = "2026-11-04";
  assert.deepEqual(schedule.earliestOfferedStart(delivered, "2026-10-21", DEFAULT_SETTINGS), {
    date: "2026-11-05",
    reason: "cancellation-ends",
  });

  const installOnly = accepted("2026-10-19T10:00:00.000Z", { contractType: "install-only" });
  installOnly.proposal.cancellationEndsOn = "2026-11-02";
  assert.equal(schedule.earliestOfferedStart(installOnly, "2026-10-19", DEFAULT_SETTINGS).date, "2026-11-03");
});

test("install blocks: one per week, Tuesday start preferred, booked dates avoided", () => {
  const p = accepted("2026-10-19T10:00:00.000Z", { early: true });
  const blocks = schedule.installBlockOptions({
    project: p,
    settings: DEFAULT_SETTINGS,
    today: "2026-10-19",
    // Another job on Wed 28 Oct: Tue 27 – Thu 29 is out, so that week falls back to the earliest free block.
    booked: ["2026-10-28"],
  });
  assert.equal(blocks.length, 6);
  // Week of 26 Oct: Mon 26 – Wed 28 clashes too, so the first clean block is Thu 29 – … which would straddle: none that week.
  assert.equal(blocks[0]!.startDate, "2026-11-03");
  assert.deepEqual(blocks[0]!.dates, ["2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.equal(blocks[0]!.label, "Tue 3 – Thu 5 Nov");
  assert.ok(blocks.every((b) => schedule.isoWeekday(b.startDate) === 2), "Tuesday starts when free");
  const weeks = new Set(blocks.map((b) => b.startDate.slice(0, 8)));
  assert.ok(weeks.size >= 2);
});

test("install blocks: a busy Tuesday falls back to that week's earliest clean block", () => {
  const p = accepted("2026-10-19T10:00:00.000Z", { early: true });
  const blocks = schedule.installBlockOptions({ project: p, settings: DEFAULT_SETTINGS, today: "2026-10-19", booked: ["2026-11-05"], count: 2 });
  // Week of 26 Oct: Tue 27 – Thu 29 free. Week of 2 Nov: Tue 3 – Thu 5 clashes; Mon 2 – Wed 4 is clean.
  assert.deepEqual(blocks.map((b) => b.label), ["Tue 27 – Thu 29 Oct", "Mon 2 – Wed 4 Nov"]);
});

test("blockProblem accepts any clean block and explains a bad one", () => {
  const p = accepted("2026-10-19T10:00:00.000Z", { early: true });
  const base = { project: p, settings: DEFAULT_SETTINGS, today: "2026-10-19", booked: ["2026-11-12"] };
  assert.equal(schedule.blockProblem({ ...base, dates: ["2026-10-28", "2026-10-29", "2026-10-30"] }), null);
  assert.match(schedule.blockProblem({ ...base, dates: ["2026-10-28", "2026-10-29"] }) ?? "", /Pick 3/);
  assert.match(schedule.blockProblem({ ...base, dates: ["2026-10-20", "2026-10-21", "2026-10-22"] }) ?? "", /earliest/);
  assert.match(schedule.blockProblem({ ...base, dates: ["2026-11-10", "2026-11-11", "2026-11-12"] }) ?? "", /taken/);
  assert.match(schedule.blockProblem({ ...base, dates: ["2026-10-28", "2026-10-30", "2026-11-02"] }) ?? "", /back to back/);
});

test("blockLabel reads naturally across months and for one day", () => {
  assert.equal(schedule.blockLabel(["2026-10-30", "2026-11-02", "2026-11-03"]), "Fri 30 Oct – Tue 3 Nov");
  assert.equal(schedule.blockLabel(["2026-11-04"]), "Wed 4 Nov");
  assert.equal(schedule.blockLabel([]), "");
});

/* ------------------------------------------------------------------ */
/* Hub view                                                            */
/* ------------------------------------------------------------------ */

test("customerSafeProject drops internal events, ops fields and working notes", () => {
  const p = project();
  p.events.push({ at: "2026-10-19T10:00:00.000Z", type: "note", label: "Customer seemed keen", actor: "ops", internal: true });
  p.nextAction = { text: "Call them" };
  p.owner = { staffId: "x", name: "Ops" };
  p.pilot = { number: 1, label: "Pilot 1" };
  p.kit.summary = "DPD, tracking 123";
  p.install.days = [{ n: 1, date: "2026-11-03", status: "done", summary: "Internal day note", customerUpdate: { text: "Day 1 done", mediaIds: [], sentAt: "x" } }];
  const safe = view.customerSafeProject(p);
  assert.equal(safe.events.some((e) => e.internal), false);
  assert.equal(safe.nextAction, undefined);
  assert.equal(safe.owner, undefined);
  assert.equal(safe.pilot, undefined);
  assert.equal(safe.kit.summary, undefined);
  assert.equal(safe.install.days[0]!.summary, undefined);
  assert.equal(safe.install.days[0]!.customerUpdate?.text, "Day 1 done");
  assert.equal(p.nextAction?.text, "Call them", "the original is untouched");
});

test("stageForHash: email anchors open their stage, #survey opens booking until booked", () => {
  const p = project();
  assert.equal(view.stageForHash("#survey", p), "price");
  p.survey.status = "booked";
  assert.equal(view.stageForHash("#survey", p), "survey");
  assert.equal(view.stageForHash("#kit", p), "kit");
  assert.equal(view.stageForHash("#nonsense", p), null);
});

test("kit steps never run ahead of what someone recorded", () => {
  const p = project();
  p.kit = { status: "dispatched", expectedDate: "2026-11-02", shortages: 0 };
  const steps = view.kitSteps(p);
  assert.deepEqual(steps.map((s) => s.done), [true, true, false, false], "dispatched reads as confirmed, not delivered");
  assert.equal(steps[1]!.label, "Supplier confirmed for Mon 2 Nov");
  p.kit = { status: "inspected", deliveredAt: "2026-11-02T10:00:00.000Z", inspectedAt: "2026-11-03T08:00:00.000Z", shortages: 0 };
  assert.deepEqual(view.kitSteps(p).map((s) => s.done), [true, true, true, true]);
  assert.match(view.kitHeadline(p), /checked by our team/);
});

test("waitingCopy promises only the date the survey email gave", () => {
  const p = project();
  p.survey.status = "submitted";
  p.survey.submittedAt = "2026-10-19T15:00:00.000Z";
  p.proposal.documentsByEmailConsent = { at: "2026-10-19T15:00:00.000Z", channel: "portal" };
  assert.equal(view.proposalReadyBy(p), "2026-10-22");
  assert.match(view.waitingCopy(p).body, /by Thu 22 Oct/);
});

test("an overdue proposal says sorry instead of repeating a date that's gone", () => {
  const p = project();
  p.survey.status = "submitted";
  p.survey.submittedAt = "2026-10-12T15:00:00.000Z";
  p.proposal.documentsByEmailConsent = { at: "2026-10-12T15:00:00.000Z", channel: "portal" };
  assert.equal(view.proposalReadyBy(p), "2026-10-15");
  assert.equal(view.proposalLate(p, "2026-10-15"), false);
  assert.match(view.waitingCopy(p, null, "2026-10-15").body, /by Thu 15 Oct/);
  assert.equal(view.proposalLate(p, "2026-10-19"), true);
  const late = view.waitingCopy(p, null, "2026-10-19").body;
  assert.doesNotMatch(late, /15 Oct/);
  assert.match(late, /taking a little longer than we said\. Sorry/);
  p.proposal.status = "issued";
  assert.equal(view.proposalLate(p, "2026-10-19"), false);
});

test("waitingCopy promises a text on the way only when one will really go", () => {
  const promise = view.onTheWayPromise;
  assert.equal(promise("sms"), "We'll text you when we're on the way.");
  assert.equal(promise("email"), "We'll email you when we're on the way.");
  assert.equal(promise(null), "");
  assert.doesNotMatch(JSON.stringify(view.waitingCopy(project(), "email")), /text you/);
});

test("the hub's 'to pay' line names only the ways the pay page offers", () => {
  const company = { tradingName: "DEMO", phone: null, email: "hello@demo.invalid" };
  const bank = { accountName: "DEMO Ltd", sortCode: "00-00-00", accountNumber: "00000000" };
  const withBank = mergeSettings({ ...DEFAULT_SETTINGS, company: { ...DEFAULT_SETTINGS.company, bank } });
  const p = project();
  // No bank details and no card: nothing to name, so say how to get the details.
  const none = view.hubFacts(p, DEFAULT_SETTINGS, "2026-10-19", null).payBy;
  assert.deepEqual(none, { card: false, bank: false });
  assert.equal(view.toPayLine("£10.00", none, company), "£10.00 to pay. Email us at hello@demo.invalid and we'll give you our bank details.");
  // The demo simulator counts as card; bank needs the account in settings.
  const sim = view.hubFacts(p, DEFAULT_SETTINGS, "2026-10-19", null, { available: false, simulate: true }).payBy;
  assert.equal(view.toPayLine("£10.00", sim, company), "£10.00 to pay, by card.");
  const both = view.hubFacts(p, withBank, "2026-10-19", null, { available: true, simulate: false }).payBy;
  assert.equal(view.toPayLine("£10.00", both, company), "£10.00 to pay, by card or bank transfer.");
  const bankOnly = view.hubFacts(p, withBank, "2026-10-19", null).payBy;
  assert.equal(view.toPayLine("£10.00", bankOnly, { ...company, phone: "020 0000 0000" }), "£10.00 to pay, by bank transfer.");
  const noCardMethod = mergeSettings({ ...withBank, payments: { ...withBank.payments, methods: ["bank-transfer"] } });
  assert.deepEqual(view.hubFacts(p, noCardMethod, "2026-10-19", null, { available: true, simulate: false }).payBy, { card: false, bank: true });
});

test("install plan: three named days by default, extra days in the middle", () => {
  assert.deepEqual(view.installPlan(3).map((d) => d.title), ["Prep and drilling", "Units, pipes and power", "Testing and handover"]);
  const five = view.installPlan(5);
  assert.equal(five.length, 5);
  assert.equal(five[4]!.title, "Testing and handover");
  assert.deepEqual(five.map((d) => d.n), [1, 2, 3, 4, 5]);
  assert.equal(view.installPlan(1).length, 1);
});

test("on-my-way banners go stale after three hours", () => {
  const omw = { at: "2026-11-03T07:40:00.000Z", etaMinutes: 20 };
  assert.equal(view.onMyWayFresh(omw, "2026-11-03T08:00:00.000Z"), true);
  assert.equal(view.onMyWayFresh(omw, "2026-11-03T11:00:00.000Z"), false);
  assert.equal(view.onMyWayFresh(undefined, "2026-11-03T08:00:00.000Z"), false);
  assert.equal(view.arrivalTime(omw), "08:00");
});

test("outstanding counts live invoices only", () => {
  assert.equal(
    view.outstandingOf([
      { status: "issued", totalPence: 60_000, paidPence: 0 },
      { status: "part-paid", totalPence: 100_000, paidPence: 40_000 },
      { status: "paid", totalPence: 50_000, paidPence: 50_000 },
      { status: "draft", totalPence: 9_999, paidPence: 0 },
      { status: "void", totalPence: 9_999, paidPence: 0 },
    ]),
    120_000,
  );
});

test("personCard lists only qualifications held today and verified, never the admin role", () => {
  const checked = { verifiedAt: "2026-01-05T09:00:00.000Z", mediaId: "media-cert" };
  const card = view.personCard(
    {
      name: "Sam (DEMO)",
      roles: ["admin", "tech-lead"],
      bio: "  Twenty years on the tools.  ",
      qualifications: [
        { kind: "fgas-cat1", reference: "DEMO-1", expiresOn: "2030-01-01", ...checked },
        { kind: "part-p", reference: "DEMO-2", expiresOn: "2020-01-01", ...checked },
        { kind: "ipaf", reference: "", ...checked },
        // Typed in, never checked against the certificate: customers never see it.
        { kind: "pasma", reference: "DEMO-3", expiresOn: "2030-01-01" },
        { kind: "18th-edition", reference: "DEMO-4", verifiedAt: "2026-01-05T09:00:00.000Z" },
      ],
    },
    "2026-10-19",
  );
  assert.equal(card.role, "Technical lead");
  assert.deepEqual(card.qualifications, ["F-gas Category I"]);
  assert.equal(card.bio, "Twenty years on the tools.");
});

test("payHeadline: 'all paid up' only once something has been paid", async () => {
  const { payHeadline } = await import("../app/p/[id]/pay/headline.ts");
  assert.equal(payHeadline({ first: "Alex", cancelled: false, payableCount: 0, paidSomething: false }).title, "Nothing to pay yet, Alex");
  assert.match(payHeadline({ first: "Alex", cancelled: false, payableCount: 0, paidSomething: false }).nothingDue, /there isn't one yet/);
  assert.equal(payHeadline({ first: "Alex", cancelled: false, payableCount: 0, paidSomething: true }).title, "You're all paid up, Alex");
  assert.equal(payHeadline({ first: "Alex", cancelled: false, payableCount: 2, paidSomething: true }).title, "Hi Alex, here's what's due");
  assert.equal(payHeadline({ first: "Alex", cancelled: true, payableCount: 0, paidSomething: true }).title, "Your contract is cancelled, Alex");
});

test("a cancelled contract on the hub: it says cancelled, with the refund and collection inside the period and nothing promised after it", () => {
  const p = accepted("2026-10-10T10:00:00.000Z");
  p.booking = { ...p.booking, status: "booked", startDate: "2026-10-26", dates: ["2026-10-26", "2026-10-27", "2026-10-28"] };
  p.kit = { ...p.kit, status: "delivered", deliveredAt: "2026-10-15T10:00:00.000Z" };
  p.money = { ...p.money, contractTotalPence: 300_000, invoicedPence: 152_830, paidPence: 152_830 };
  // Reached us at 00:30 BST on Sun 25 Oct (23:30 UTC on the 24th): the London day is the 25th.
  p.cancellation = { receivedAt: "2026-10-24T23:30:00.000Z", channel: "phone", evidenceRef: "DEMO call", recordedAt: "2026-10-25T09:00:00.000Z", withinPeriod: true, refundDueBy: "2026-11-08" };
  p.closure = { closed: true, closedAt: "2026-10-25T09:00:00.000Z", reason: "cancelled" };

  assert.equal(view.isCancelledProject(p), true);
  const copy = view.cancelledCopy(p)!;
  assert.equal(copy.title, "Your contract is cancelled");
  assert.match(copy.body, /We received your cancellation on Sun 25 Oct\./);
  assert.match(copy.body, /We'll refund the £1,528\.30 you've paid by Sun 8 Nov at the latest/);
  assert.match(copy.body, /We'll collect the equipment we supplied, at our cost/);
  assert.deepEqual(view.waitingCopy(p), copy, "the next-step card says it, not 'This project is closed'");

  // The stages that won't happen are cancelled (never "now" with the booked date); what was done stays done.
  const cancelled = (["price", "survey", "proposal", "booking", "kit", "install", "handover", "aftercare"] as const).filter((s) => view.stageCancelled(p, s));
  assert.deepEqual(cancelled, ["install", "handover", "aftercare"], "aftercare isn't 'done': it only closed");
  // The panels with plans in them give way to the cancellation notice, from the proposal on.
  assert.equal(view.showsCancelledPanel(p, "install"), true, "no day-by-day plan, prep list or power-off notice");
  assert.equal(view.showsCancelledPanel(p, "booking"), true);
  assert.equal(view.showsCancelledPanel(p, "proposal"), true);
  assert.equal(view.showsCancelledPanel(p, "survey"), false, "history stays");

  // Refunded already: nothing promised that's been done.
  const refunded = structuredClone(p);
  refunded.money.paidPence = 0;
  assert.match(view.cancelledCopy(refunded)!.body, /Nothing more is due from you/);
  // Install only: we supplied nothing, so nothing to collect.
  const installOnly = structuredClone(p);
  installOnly.proposal.contractType = "install-only";
  assert.doesNotMatch(view.cancelledCopy(installOnly)!.body, /collect/);

  // After the period: only that it reached us, and that we'll be in touch.
  const late = structuredClone(p);
  late.cancellation!.withinPeriod = false;
  const lateCopy = view.cancelledCopy(late)!;
  assert.equal(lateCopy.title, "We've received your cancellation");
  assert.match(lateCopy.body, /after your cancellation period had ended\. We'll be in touch in writing/);
  assert.doesNotMatch(lateCopy.body, /refund|collect/);

  // Closed as cancelled before any contract: no cancellation record, the plain closed line.
  const before = project();
  before.closure = { closed: true, closedAt: "2026-10-25T09:00:00.000Z", reason: "cancelled" };
  assert.equal(view.cancelledCopy(before)!.title, "This project is closed");
  // Not cancelled: none of this.
  assert.equal(view.cancelledCopy(accepted("2026-10-10T10:00:00.000Z")), null);
  assert.equal(view.stageCancelled(accepted("2026-10-10T10:00:00.000Z"), "install"), false);
});
