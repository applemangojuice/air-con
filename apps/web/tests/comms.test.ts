import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import {
  COMMS_EVENTS,
  DEFAULT_SETTINGS,
  LINK_PLACEHOLDER,
  applyProjectAction,
  createProject,
  generateQuote,
  idempotencyKey,
  mergeSettings,
  type CommsEventId,
  type PilotSettings,
  type Project,
  type ProjectAction,
  type Survey,
} from "@aircon/domain";

/*
 * lib/email.ts imports "./brand" without an extension: fine for Next's
 * bundler, not for Node's ESM loader. Teach this test process to retry an
 * extensionless relative import as ".ts", then load the modules under test.
 */
function resolveExtensionlessTs(): void {
  const needsTs = (s: string) => s.startsWith(".") && !/\.[cm]?[jt]sx?$|\.json$/.test(s);
  type Next = (specifier: string, context?: unknown) => unknown;
  const m = nodeModule as unknown as {
    registerHooks?: (hooks: { resolve: (specifier: string, context: unknown, next: Next) => unknown }) => void;
    register?: (url: string) => void;
  };
  if (m.registerHooks) {
    m.registerHooks({
      resolve(specifier, context, next) {
        try {
          return next(specifier, context);
        } catch (err) {
          if (needsTs(specifier)) return next(`${specifier}.ts`, context);
          throw err;
        }
      },
    });
  } else if (m.register) {
    m.register(
      `data:text/javascript,${encodeURIComponent(
        'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (s.startsWith(".") && !/\\.[cm]?[jt]sx?$|\\.json$/.test(s)) return n(s + ".ts", c); throw e; } }',
      )}`,
    );
  }
}
resolveExtensionlessTs();

const { renderMessage, templateContext, firstNameOf, linkPathFor } = await import("../lib/comms/templates.ts");
type CommsData = import("../lib/comms/templates.ts").CommsData;
const { cancellationForm, cancellationInstructions, CANCELLATION_NOTICE_VERSION } = await import("../lib/comms/legal-text.ts");
const { commsForAction, textHash } = await import("../lib/comms/action-map.ts");
const { createOutbox, consentAllows, addressFor, headline } = await import("../lib/comms/outbox-core.ts");
type OutboxDeps = import("../lib/comms/outbox-core.ts").OutboxDeps;
const { messageStore } = await import("../lib/repo/messages.ts");
const { createLocalClient } = await import("../lib/db/local-client.ts");
const { smsLength } = await import("../lib/providers/sms.ts");

/* ------------------------------------------------------------------ */
/* Fixtures (fictional DEMO people, Ofcom drama numbers)              */
/* ------------------------------------------------------------------ */

const ALL_EVENTS = Object.keys(COMMS_EVENTS) as CommsEventId[];
const SETTINGS: PilotSettings = mergeSettings(DEFAULT_SETTINGS);
const PHONE = SETTINGS.company.phone;
const PORTAL = "https://dang.example/auth/verify?t=demo-token";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";

const CUSTOMER = {
  name: "DEMO Sam Taylor",
  email: "sam@example.test",
  phone: "07700 900123",
  addressLine: "12 Demo Road",
  postcode: "SW16 2BE",
};

function ctxFor(customer: Partial<typeof CUSTOMER> = {}, settings: PilotSettings = SETTINGS) {
  return templateContext({ settings, portalUrl: PORTAL, project: { id: PROJECT_ID, customer: { ...CUSTOMER, ...customer } } });
}

/** Every event with every optional field set. */
const FULL: { [E in CommsEventId]: CommsData[E] } = {
  "magic-link": { link: PORTAL, name: "DEMO Sam Taylor", audience: "customer", expiresInMinutes: 60 },
  "survey-booked": {
    scheduledFor: "2026-11-03T10:00:00.000Z",
    durationMinutes: 90,
    mode: "in-person",
    surveyorName: "Alex Demo",
    rescheduled: false,
    feeGbp: 0,
  },
  "survey-reminder": { scheduledFor: "2026-11-03T10:00:00.000Z", durationMinutes: 90, mode: "in-person", surveyorName: "Alex Demo" },
  "surveyor-on-my-way": { etaMinutes: 20, at: "2026-11-03T09:40:00.000Z", name: "Alex Demo" },
  "survey-complete": { proposalBy: "2026-11-10" },
  "proposal-issued": { version: 2, validUntil: "2026-12-03", optionCount: 2, engineerApproved: true },
  "proposal-reminder": { version: 1, validUntil: "2026-12-03" },
  "proposal-accepted": {
    version: 2,
    optionLabel: "Quiet",
    contractTotalPence: 612_350,
    acceptedAt: "2026-11-12T15:04:00.000Z",
    signedName: "Sam Taylor",
    termsVersion: "pilot-draft-1",
    cancellationNoticeVersion: CANCELLATION_NOTICE_VERSION,
    cancellationEndsOn: "2026-11-26",
    earlyStartRequested: true,
    acknowledgedLossOfRight: true,
    installDays: 3,
    proposalRef: "DIH-PR-00AA-v2",
  },
  "proposal-changes-requested": { text: "Could the landing unit go on the other wall?", version: 2 },
  "invoice-issued": { invoiceNumber: "DIH-0003", kind: "balance", totalPence: 612_350, outstandingPence: 562_350, dueOn: "2026-12-10" },
  "payment-received": { amountPence: 50_000, receivedAt: "2026-11-13T09:00:00.000Z", invoiceNumber: "DIH-0002", method: "card", outstandingPence: 0 },
  "install-booked": {
    dates: ["2026-12-03", "2026-12-01", "2026-12-02"],
    crew: [
      { name: "Jo Demo", role: "installer" },
      { name: "Pat Demo", role: "tech-lead" },
    ],
    prep: ["Clear a metre under each unit's wall", "Make sure we can get to the fuse board"],
    moved: false,
  },
  "kit-update": { status: "confirmed", expectedDate: "2026-11-28", shortages: 1 },
  "install-prep": { startDate: "2026-12-01", prep: ["Clear a metre under each unit's wall"] },
  "install-day-before": { startDate: "2026-12-01", crewNames: ["Jo Demo", "Pat Demo"], arrival: "8:30", parkingNotes: "Permit in the hall" },
  "installer-on-my-way": { etaMinutes: 25, at: "2026-12-01T08:05:00.000Z", name: "Jo Demo" },
  "install-day-update": { n: 1, totalDays: 3, text: "Holes drilled and sealed, brackets up.", photoCount: 3, nextDate: "2026-12-02", by: "Jo Demo" },
  "variation-approval": { title: "Condensate pump in the loft room", description: "No fall to an outside wall.", totalDeltaPence: 18_000, issueNumber: 4 },
  "issue-update": { title: "Drip from the bedroom unit", update: "We've found a kinked drain hose.", nextStep: "Jo will replace it.", dueOn: "2026-12-08", issueNumber: 5 },
  "handover-ready": { electricalCertPending: true },
  "check-in-7d": {},
  "feedback-30d": {},
  "service-reminder": { dueOn: "2027-12-03" },
  "team-alert": { title: "Proposal accepted: DEMO Sam Taylor", detail: "Quiet option.", lines: ["Early start requested"], urgent: true, legalCheck: true },
};

/** Every event with only its required fields. */
const MIN: { [E in CommsEventId]: CommsData[E] } = {
  "magic-link": { link: PORTAL },
  "survey-booked": { scheduledFor: "2026-11-03T13:00:00.000Z" },
  "survey-reminder": { scheduledFor: "2026-11-03T13:00:00.000Z" },
  "surveyor-on-my-way": { etaMinutes: 15, at: "" },
  "survey-complete": {},
  "proposal-issued": { version: 1, validUntil: "2026-12-03" },
  "proposal-reminder": { validUntil: "2026-12-03" },
  "proposal-accepted": { version: 1, optionLabel: "Standard", contractTotalPence: 450_000, acceptedAt: "2026-11-12T15:04:00.000Z", earlyStartRequested: false },
  "proposal-changes-requested": { text: "" },
  "invoice-issued": { invoiceNumber: "DIH-0001", kind: "deposit", totalPence: 45_000 },
  "payment-received": { amountPence: 45_000, receivedAt: "2026-11-13T09:00:00.000Z" },
  "install-booked": { dates: ["2026-12-01"] },
  "kit-update": { status: "delivered" },
  "install-prep": { startDate: "2026-12-01" },
  "install-day-before": { startDate: "2026-12-01" },
  "installer-on-my-way": { etaMinutes: 10, at: "" },
  "install-day-update": { n: 2, text: "" },
  "variation-approval": { title: "Extra trunking", totalDeltaPence: 0 },
  "issue-update": { title: "Remote not pairing", update: "" },
  "handover-ready": {},
  "check-in-7d": {},
  "feedback-30d": {},
  "service-reminder": { dueOn: "2027-12-03" },
  "team-alert": { title: "Something to know" },
};

const render = <E extends CommsEventId>(event: E, data: CommsData[E], ctx = ctxFor()) => renderMessage(event, ctx, data);
const JUNK = /undefined|\bnull\b|NaN|\[object Object\]|Invalid Date/;

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

test("every event renders a subject, text and HTML, with full and with minimal data", () => {
  for (const event of ALL_EVENTS) {
    for (const [label, data] of [["full", FULL[event]], ["minimal", MIN[event]]] as const) {
      const m = render(event, data as never);
      const where = `${event} (${label})`;
      assert.ok(m.subject.length > 5, `${where}: subject`);
      assert.ok(m.text.length > 40, `${where}: text`);
      assert.ok(m.html.includes("<table"), `${where}: branded shell`);
      for (const [part, value] of Object.entries(m)) {
        assert.doesNotMatch(String(value), JUNK, `${where}: ${part} has junk`);
      }
    }
  }
});

test("customer messages greet by first name, name the property, link once and give our phone", () => {
  for (const event of ALL_EVENTS) {
    if (COMMS_EVENTS[event].audience !== "customer") continue;
    const m = render(event, FULL[event] as never);
    assert.match(m.text, /^Hi Sam,/, `${event}: greeting`);
    assert.ok(m.text.includes(PHONE), `${event}: support phone`);
    assert.ok(m.text.includes(SETTINGS.company.tradingName), `${event}: names us`);
    if (event !== "magic-link") assert.ok(m.text.includes("12 Demo Road"), `${event}: the property`);
    if (!COMMS_EVENTS[event].channels.includes("email")) continue; // SMS-only: no email link to count
    assert.equal(m.text.split(PORTAL).length - 1, 1, `${event}: exactly one link in the text`);
    assert.equal(m.html.split(`href="${PORTAL}"`).length - 1, 1, `${event}: exactly one link in the HTML`);
  }
});

test("team messages carry the customer and the ops link, without a greeting", () => {
  for (const event of ["team-alert", "proposal-changes-requested"] as const) {
    const m = render(event, FULL[event] as never);
    assert.doesNotMatch(m.text, /^Hi /, event);
    assert.ok(m.text.includes("Sam Taylor"), event);
  }
  const alert = render("team-alert", FULL["team-alert"]);
  assert.match(alert.subject, /^\[Urgent\] /);
  assert.match(alert.text, /not yet marked reviewed/, "unreviewed legal wording is called out to the team");
  const reviewed = mergeSettings({ legal: { termsReviewed: true, cancellationReviewed: true } });
  assert.doesNotMatch(render("team-alert", FULL["team-alert"], ctxFor({}, reviewed)).text, /not yet marked reviewed/);
});

test("SMS events have texts within two GSM-7 segments that give our number", () => {
  const smsEvents = ALL_EVENTS.filter((e) => COMMS_EVENTS[e].channels.includes("sms"));
  assert.ok(smsEvents.length >= 5);
  const ctxs = [
    ctxFor(),
    ctxFor({ name: "Zoë Brontë-Fitzwilliam", addressLine: "Flat 14, The Old Ropeworks, 221 Very Long Avenue Name" }),
    ctxFor({ name: "" }),
  ];
  for (const event of smsEvents) {
    for (const ctx of ctxs) {
      for (const data of [FULL[event], MIN[event]]) {
        const m = renderMessage(event, ctx, data as never);
        assert.ok(m.sms, `${event}: has an SMS`);
        const len = smsLength(m.sms!);
        assert.ok(len.segments <= 2, `${event}: ${len.segments} segments: ${m.sms}`);
        assert.equal(len.encoding, "gsm7", `${event}: GSM-7`);
        assert.ok(m.sms!.includes(PHONE), `${event}: our phone number`);
        assert.doesNotMatch(m.sms!, JUNK, event);
      }
    }
  }
  for (const event of ALL_EVENTS.filter((e) => !COMMS_EVENTS[e].channels.includes("sms"))) {
    assert.equal(render(event, FULL[event] as never).sms, undefined, `${event}: email only`);
  }
});

test("on-my-way texts give the arrival time in London time and the ETA", () => {
  // 09:40 UTC on 3 Nov is 09:40 in London (GMT); 20 minutes on is 10:00.
  assert.match(render("surveyor-on-my-way", FULL["surveyor-on-my-way"]).sms!, /Alex Demo is on the way .* around 10:00 \(about 20 min\)/);
  // In summer, BST: 08:05 UTC + 25 min is 09:30 in London.
  const summer = render("installer-on-my-way", { etaMinutes: 25, at: "2026-07-01T08:05:00.000Z", name: "Jo Demo" });
  assert.match(summer.sms!, /around 09:30/);
  assert.match(render("installer-on-my-way", MIN["installer-on-my-way"]).sms!, /in about 10 min/);
});

test("user-supplied text is escaped in HTML", () => {
  const m = render("proposal-changes-requested", { text: "<script>alert(1)</script> & more" }, ctxFor({ name: "<b>Eve</b>" }));
  assert.ok(!m.html.includes("<script>"), "no raw script");
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.ok(!m.html.includes("<b>Eve</b>"));
  assert.ok(m.text.includes("<script>alert(1)</script> & more"), "text stays literal");
});

test("the acceptance email is the durable copy: contract, record, early start and the statutory text", () => {
  const m = render("proposal-accepted", FULL["proposal-accepted"]);
  for (const s of ["Quiet", "£6,123.50", "Version 2 (DIH-PR-00AA-v2)", "pilot-draft-1", "Sam Taylor", "12 Nov 2026 at 15:04 (UK time)"]) {
    assert.ok(m.text.includes(s), `contract summary / record: ${s}`);
  }
  assert.ok(m.text.includes(CANCELLATION_NOTICE_VERSION));
  assert.match(m.text, /You asked us to start work during your cancellation period/);
  assert.match(m.text, /once the work is fully completed, you lose the right to cancel/);
  assert.match(m.text, /You have the right to cancel this contract within 14 days without giving any reason\./);
  assert.match(m.text, /proportion to what has been provided/);
  assert.match(m.text, /I\/We \[\*\] hereby give notice that I\/We \[\*\] cancel/);
  assert.match(m.text, new RegExp(`To: ${SETTINGS.company.legalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(m.text, /None charged: we're not VAT registered/);

  const plain = render("proposal-accepted", { ...MIN["proposal-accepted"], cancellationEndsOn: "2026-11-26" });
  assert.match(plain.text, /Your cancellation period ends at the end of 26 Nov 2026\. We won't start work until it has ended/);
  assert.doesNotMatch(plain.text, /You asked us to start/);
  assert.match(plain.text, /Accepted by: DEMO Sam Taylor/, "falls back to the customer's name");
});

test("legal text fills in our details and keeps the statutory wording", () => {
  const trader = { legalName: "Demo Trading Ltd", tradingName: "Demo", registeredAddress: "1 Demo Street, London", phone: "0800 000 0000", email: "hello@example.test" };
  const a = cancellationInstructions(trader);
  assert.ok(a.some((p) => p.text.includes("inform us (Demo Trading Ltd (trading as Demo), 1 Demo Street, London, phone 0800 000 0000, email hello@example.test)")));
  assert.equal(a[0].heading, "Right to cancel");
  const b = cancellationForm(trader);
  assert.equal(b[1], "To: Demo Trading Ltd (trading as Demo), 1 Demo Street, London, email hello@example.test");
  assert.ok(b.includes("[*] Delete as appropriate."));
  assert.ok(!a.some((p) => p.text.includes("{TRADER}")) && !b.some((l) => l.includes("{TRADER}")));
});

test("invoices show bank details only when settings have them, and never claim payment early", () => {
  const noBank = render("invoice-issued", FULL["invoice-issued"]);
  assert.match(noBank.text, /call us for our bank details/);
  assert.match(noBank.subject, /^Invoice DIH-0003: £5,623\.50 due Thu 10 Dec$/);
  const banked = mergeSettings({ company: { ...SETTINGS.company, bank: { accountName: "Demo Ltd", sortCode: "00-00-00", accountNumber: "00000000" } } });
  const withBank = render("invoice-issued", FULL["invoice-issued"], ctxFor({}, banked));
  assert.match(withBank.text, /Sort code: 00-00-00/);
  assert.match(withBank.text, /Reference: DIH-0003/);
  assert.match(render("payment-received", FULL["payment-received"]).text, /You're all paid up/);
  assert.doesNotMatch(render("payment-received", MIN["payment-received"]).text, /paid up|left to pay/, "no balance claim without the number");
});

test("first names: titles, DEMO labels and blanks", () => {
  assert.equal(firstNameOf("Sam Taylor"), "Sam");
  assert.equal(firstNameOf("DEMO Sam Taylor"), "Sam");
  assert.equal(firstNameOf("Dr Sam Taylor"), "Dr Taylor");
  assert.equal(firstNameOf("  "), "there");
  assert.equal(firstNameOf(undefined), "there");
});

test("links go to the right screen", () => {
  assert.equal(linkPathFor("proposal-issued", "p1"), "/p/p1/proposal");
  assert.equal(linkPathFor("invoice-issued", "p1"), "/p/p1/pay");
  assert.equal(linkPathFor("survey-booked", "p1"), "/p/p1#survey");
  assert.equal(linkPathFor("issue-update", "p1"), "/p/p1");
  assert.equal(linkPathFor("team-alert", "p1"), "/ops/projects/p1");
  assert.equal(linkPathFor("team-alert", undefined), "/ops");
  assert.equal(linkPathFor("magic-link", "p1"), null);
  assert.equal(linkPathFor("survey-booked", undefined), null);
});

/* ------------------------------------------------------------------ */
/* Action → messages, and key stability                                */
/* ------------------------------------------------------------------ */

function demoSurvey(): Survey {
  return {
    postcode: "SW16 2BE",
    addressLine: "12 Demo Road",
    property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
    rooms: [
      { id: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
    ],
    outdoor: { location: "ground-rear", photos: [] },
    electrics: { condition: "modern-spare-ways", photos: [] },
  } as Survey;
}

function baseProject(): Project {
  const s = demoSurvey();
  return createProject({
    id: PROJECT_ID,
    quoteId: "00000000-0000-4000-8000-0000000000bb",
    createdAt: "2026-10-18T09:00:00.000Z",
    customerName: CUSTOMER.name,
    customerEmail: CUSTOMER.email,
    customerPhone: CUSTOMER.phone,
    survey: s,
    quote: generateQuote(s),
  });
}

const keysOf = (p: Project, a: ProjectAction, actor?: { staffId?: string; name?: string }) =>
  commsForAction(p, a, actor).flatMap((n) => COMMS_EVENTS[n.event].channels.map((ch) => idempotencyKey(n.event, p.id, n.discriminator, ch)));

test("survey bookings: the same slot is one message; a new slot is another; customers' own bookings alert the team", () => {
  const p = baseProject();
  p.survey.status = "booked";
  p.survey.scheduledFor = "2026-11-03T10:00:00.000Z";
  const book: ProjectAction = { type: "book-survey", scheduledFor: "2026-11-03T10:00:00.000Z", mode: "in-person" };
  assert.deepEqual(keysOf(p, book), keysOf(p, book), "a retry maps to the same keys");
  assert.deepEqual(
    commsForAction(p, book).map((n) => n.event),
    ["survey-booked", "team-alert"],
  );
  assert.deepEqual(
    commsForAction(p, { ...book, type: "ops-book-survey" }, { staffId: "s1", name: "Ops Demo" }).map((n) => n.event),
    ["survey-booked"],
    "staff booked it: no alert to themselves",
  );
  assert.deepEqual(
    commsForAction(p, book, { name: "DEMO Sam Taylor" }).map((n) => n.event),
    ["survey-booked", "team-alert"],
    "a customer actor (no staffId) still alerts the team",
  );

  const moved = baseProject();
  moved.survey.status = "booked";
  moved.survey.scheduledFor = "2026-11-04T13:00:00.000Z";
  const resched: ProjectAction = { type: "reschedule-survey", scheduledFor: "2026-11-04T13:00:00.000Z" };
  const [notice] = commsForAction(moved, resched);
  assert.equal(notice.event, "survey-booked");
  assert.equal((notice.data as CommsData["survey-booked"]).rescheduled, true);
  assert.notDeepEqual(keysOf(moved, resched), keysOf(p, book), "a new slot is a new message");
});

test("on-my-way: a retry is deduped, a corrected ETA is a new text", () => {
  const p = baseProject();
  p.survey.status = "booked";
  p.survey.scheduledFor = "2026-11-03T10:00:00.000Z";
  p.survey.onMyWay = { at: "2026-11-03T09:40:00.000Z", etaMinutes: 20 };
  const a: ProjectAction = { type: "surveyor-on-my-way", etaMinutes: 20, by: "Alex Demo" };
  assert.deepEqual(keysOf(p, a), keysOf(p, a));
  assert.notDeepEqual(keysOf(p, a), keysOf(p, { ...a, etaMinutes: 35 }));
  assert.deepEqual(keysOf(p, a), [`surveyor-on-my-way:${PROJECT_ID}:2026-11-03T10:00:00.000Z:20:sms`]);
});

test("proposals: one message per version; acceptance tells the customer and the team; change requests key on their text", () => {
  const p = baseProject();
  p.design.status = "approved";
  const v1: ProjectAction = { type: "proposal-issued", proposalId: "prop-v1", version: 1, validUntil: "2026-12-03", optionCount: 2 };
  const v2: ProjectAction = { ...v1, proposalId: "prop-v2", version: 2 };
  assert.notDeepEqual(keysOf(p, v1), keysOf(p, v2));
  assert.equal((commsForAction(p, v1)[0].data as CommsData["proposal-issued"]).engineerApproved, true);

  p.proposal.status = "accepted";
  p.proposal.acceptedAt = "2026-11-12T15:04:00.000Z";
  p.proposal.cancellationEndsOn = "2026-11-26";
  const accept: ProjectAction = {
    type: "proposal-accepted",
    proposalId: "prop-v2",
    version: 2,
    optionLabel: "Quiet",
    contractTotalPence: 612_350,
    earlyStartRequested: false,
  };
  const notices = commsForAction(p, accept);
  assert.deepEqual(notices.map((n) => n.event), ["proposal-accepted", "team-alert"]);
  const keys = keysOf(p, accept);
  assert.equal(new Set(keys).size, keys.length, "distinct keys for customer copy and team alert");
  assert.equal((notices[0].data as CommsData["proposal-accepted"]).cancellationEndsOn, "2026-11-26");

  p.proposal.proposalId = "prop-v2";
  const ask = (text: string): ProjectAction => ({ type: "proposal-changes-requested", text });
  assert.deepEqual(keysOf(p, ask("Other wall please")), keysOf(p, ask("  Other   wall please ")), "whitespace doesn't make it new");
  assert.notDeepEqual(keysOf(p, ask("Other wall please")), keysOf(p, ask("Cheaper option?")));
  assert.equal(textHash("abc"), textHash("abc"));
});

test("bookings, kit, install days and handover map per the contract", () => {
  const p = baseProject();
  p.booking.status = "booked";
  p.booking.dates = ["2026-12-01", "2026-12-02", "2026-12-03"];
  p.booking.crew = [{ staffId: "s1", name: "Jo Demo", role: "installer", external: false }];
  const confirmed = commsForAction(p, { type: "booking-confirmed" });
  assert.equal(confirmed[0].event, "install-booked");
  assert.equal(confirmed[0].discriminator, "confirmed:2026-12-01,2026-12-02,2026-12-03");

  const moveTo: ProjectAction = { type: "install-dates-set", startDate: "2026-12-08", dates: ["2026-12-08", "2026-12-09", "2026-12-10"] };
  p.booking.dates = moveTo.type === "install-dates-set" ? moveTo.dates : [];
  p.events.push({ at: "2026-11-20T10:00:00.000Z", type: "install-rescheduled", label: "Install moved", actor: "customer" });
  const [move] = commsForAction(p, moveTo);
  assert.equal((move.data as CommsData["install-booked"]).moved, true);
  assert.equal(move.discriminator, "moved:1:2026-12-08,2026-12-09,2026-12-10");

  const unbooked = baseProject();
  assert.deepEqual(commsForAction(unbooked, moveTo), [], "dates chosen before confirmation: nothing yet");

  for (const status of ["ordered", "dispatched", "not-ordered"] as const) {
    assert.deepEqual(commsForAction(p, { type: "kit-updated", status, shortages: 0 }), [], `kit ${status}: silent`);
  }
  p.kit.expectedDate = "2026-11-28";
  assert.equal(commsForAction(p, { type: "kit-updated", status: "confirmed", shortages: 0 })[0].discriminator, "confirmed:2026-11-28");
  assert.equal(commsForAction(p, { type: "kit-updated", status: "inspected", shortages: 0 })[0].event, "kit-update");

  p.install.days = [
    { n: 1, date: "2026-12-08", status: "done" },
    { n: 2, date: "2026-12-09", status: "planned" },
  ];
  assert.deepEqual(commsForAction(p, { type: "install-day-ended", n: 1, summary: "ok" }), [], "no customer update, no email");
  const [day] = commsForAction(p, { type: "install-day-ended", n: 1, summary: "ok", customerUpdate: { text: "Brackets up.", mediaIds: ["m1", "m2"] } });
  assert.equal(day.event, "install-day-update");
  assert.equal(day.discriminator, "day-1");
  assert.deepEqual(
    { photos: (day.data as CommsData["install-day-update"]).photoCount, next: (day.data as CommsData["install-day-update"]).nextDate },
    { photos: 2, next: "2026-12-09" },
  );

  const [handover] = commsForAction(p, { type: "handover-pack-published", documentId: "doc-1" });
  assert.equal(handover.event, "handover-ready");
  assert.deepEqual(commsForAction(p, { type: "note", text: "internal" }), []);
});

/* ------------------------------------------------------------------ */
/* Outbox engine against the in-memory backend                         */
/* ------------------------------------------------------------------ */

function harness(
  opts: {
    email?: boolean;
    sms?: boolean;
    emailOk?: boolean[];
    project?: Project | null;
    settings?: PilotSettings;
    /** The address on the project's customer record (what a token signs in as). */
    customerEmail?: string;
  } = {},
) {
  const db = createLocalClient({ backend: "memory" });
  const store = messageStore(db);
  const sent: { channel: string; to: string; body: string; subject?: string }[] = [];
  const minted: { projectId: string; path: string; recipient: string }[] = [];
  const emailResults = [...(opts.emailOk ?? [])];
  const project = opts.project === undefined ? baseProject() : opts.project;
  const recordEmail = opts.customerEmail ?? CUSTOMER.email;
  const deps: OutboxDeps = {
    store,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    getSettings: async () => opts.settings ?? SETTINGS,
    loadProject: async (id) => (project && project.id === id ? project : null),
    // Like lib/auth/magic: a token only for the customer's own address, a fresh one per call.
    customerLink: async (projectId, path, recipient) => {
      if (recipient.trim().toLowerCase() !== recordEmail) return `https://dang.example${path}`;
      minted.push({ projectId, path, recipient });
      return `https://dang.example/auth/verify?t=fresh${minted.length}&next=${encodeURIComponent(path)}`;
    },
    appUrl: () => "https://dang.example",
    teamInbox: () => "team@example.test",
    email: {
      provider: "resend",
      configured: () => opts.email ?? false,
      send: async (to, subject, html) => {
        const ok = emailResults.length ? emailResults.shift()! : true;
        if (ok) sent.push({ channel: "email", to, body: html, subject });
        return ok ? { ok } : { ok, error: "Resend said no" };
      },
    },
    sms: {
      provider: "twilio",
      configured: () => opts.sms ?? false,
      send: async (to, body) => {
        sent.push({ channel: "sms", to, body });
        return { ok: true, providerRef: "SM-demo" };
      },
    },
    log: () => {},
  };
  return { db, store, sent, minted, outbox: createOutbox(deps) };
}

const surveyBooked = { scheduledFor: "2026-11-03T10:00:00.000Z" } as const;

test("demo mode stores the rendered message as demo and never as sent; the same occurrence is never stored twice", async () => {
  const h = harness();
  const first = await h.outbox.notify("survey-booked", { projectId: PROJECT_ID, data: surveyBooked, discriminator: surveyBooked.scheduledFor });
  assert.equal(first.status, "demo");
  assert.equal(first.results[0].to, CUSTOMER.email);
  const again = await h.outbox.notify("survey-booked", { projectId: PROJECT_ID, data: surveyBooked, discriminator: surveyBooked.scheduledFor });
  assert.equal(again.status, "duplicate");
  assert.equal(again.results[0].messageId, first.results[0].messageId);

  const { data: rows } = await h.db.from("messages").select("*");
  assert.equal(rows!.length, 1);
  const stored = await h.store.get(first.results[0].messageId!);
  assert.equal(stored!.status, "demo");
  assert.equal(stored!.sentAt, undefined, "demo is not sent");
  assert.equal(stored!.idempotencyKey, idempotencyKey("survey-booked", PROJECT_ID, surveyBooked.scheduledFor, "email"));
  assert.match(stored!.bodyText, /^Hi Sam,/);
  // No sign-in token is ever stored: the link is minted only when a provider takes it.
  assert.ok(stored!.bodyText.includes(LINK_PLACEHOLDER));
  assert.ok(stored!.bodyHtml!.includes(LINK_PLACEHOLDER));
  assert.doesNotMatch(`${stored!.bodyText}${stored!.bodyHtml}`, /verify\?t=/);
  assert.equal(stored!.linkPath, `/p/${PROJECT_ID}#survey`);
  assert.equal(h.minted.length, 0, "a demo message never gets a token");
  assert.equal(h.sent.length, 0);
});

test("live email: the link is minted at send, for the recipient, and never stored", async () => {
  const h = harness({ email: true });
  const r = await h.outbox.notify("survey-booked", { projectId: PROJECT_ID, data: surveyBooked, discriminator: "live-1" });
  assert.equal(r.status, "sent");
  assert.deepEqual(h.minted, [{ projectId: PROJECT_ID, path: `/p/${PROJECT_ID}#survey`, recipient: CUSTOMER.email }]);
  assert.match(h.sent[0]!.body, /href="https:\/\/dang\.example\/auth\/verify\?t=fresh1&amp;next=%2Fp%2F[^"]+%23survey"/);
  assert.ok(!h.sent[0]!.body.includes(LINK_PLACEHOLDER));
  const stored = (await h.store.get(r.results[0]!.messageId!))!;
  assert.equal(stored.status, "sent");
  assert.doesNotMatch(`${stored.bodyText}${stored.bodyHtml}`, /fresh|verify\?t=/);

  // A resend mints a new token rather than replaying the spent one.
  await h.outbox.resend(stored.id);
  assert.equal(h.minted.length, 2);
  assert.match(h.sent[1]!.body, /t=fresh2/);
});

test("a sign-in link only goes to the customer's own address", async () => {
  // The project's email was changed to an address that isn't the customer record's.
  const changed = applyProjectAction(baseProject(), { type: "set-customer-contact", email: "someone.else@example.test" }, new Date().toISOString());
  assert.ok(changed.ok);
  const h = harness({ email: true, project: changed.project });
  const r = await h.outbox.notify("proposal-issued", { projectId: PROJECT_ID, data: { version: 1, validUntil: "2026-12-03" }, discriminator: "p1" });
  assert.equal(r.results[0]!.to, "someone.else@example.test");
  assert.equal(h.minted.length, 0, "no token for someone who isn't the customer");
  assert.match(h.sent[0]!.body, new RegExp(`href="https://dang\\.example/p/${PROJECT_ID}/proposal"`));
  // Once the project belongs to that address's customer (dispatch relinks it), it gets a token.
  const relinked = harness({ email: true, project: changed.project, customerEmail: "someone.else@example.test" });
  await relinked.outbox.notify("proposal-issued", { projectId: PROJECT_ID, data: { version: 1, validUntil: "2026-12-03" }, discriminator: "p1" });
  assert.equal(relinked.minted[0]!.recipient, "someone.else@example.test");
});

test("a removed email stays removed: no recipient, never the quote's old address", async () => {
  const cleared = applyProjectAction(baseProject(), { type: "set-customer-contact", email: "" }, new Date().toISOString());
  assert.ok(cleared.ok && cleared.project.customer.email === undefined);
  const h = harness({ email: true, project: cleared.project });
  const r = await h.outbox.notify("proposal-issued", { projectId: PROJECT_ID, data: { version: 1, validUntil: "2026-12-03" }, discriminator: "p2" });
  assert.equal(r.results[0]!.status, "no-recipient");
  assert.equal(h.sent.length, 0);
  assert.equal(h.minted.length, 0);
});

test("magic links: sent once from memory, never stored, never retried", async () => {
  const h = harness({ email: true, emailOk: [true] });
  const link = "https://dang.example/auth/verify?t=staff-token";
  const r = await h.outbox.notify("magic-link", { to: "staff@example.test", data: { link, name: "Alex Demo", audience: "staff" }, discriminator: "tok-a" });
  assert.equal(r.status, "sent");
  assert.ok(h.sent[0]!.body.includes(link), "the first send carries the real link");
  const stored = (await h.store.get(r.results[0]!.messageId!))!;
  assert.ok(!`${stored.bodyText}${stored.bodyHtml}`.includes("staff-token"), "the token isn't in the database");
  assert.ok(stored.bodyText.includes(LINK_PLACEHOLDER));
  assert.equal(stored.linkPath, undefined);

  // A failed one isn't sent again with a dead link: it's skipped, and says why.
  const f = harness({ email: true, emailOk: [false] });
  const failed = await f.outbox.notify("magic-link", { to: "staff@example.test", data: { link, audience: "staff" }, discriminator: "tok-b" });
  assert.equal(failed.status, "failed");
  const later = new Date(Date.now() + 10 * 60_000).toISOString();
  assert.deepEqual(await f.outbox.dispatchDue(later), { due: 1, sent: 0, demo: 0, failed: 0, skipped: 1, errors: 0 });
  const after = (await f.store.get(failed.results[0]!.messageId!))!;
  assert.equal(after.status, "skipped");
  assert.match(after.error ?? "", /Ask for a new link/);
  assert.equal((await f.outbox.resend(after.id)).status, "skipped");
  assert.equal(f.sent.length, 0);
});

test("concurrent notifies for one occurrence store exactly one message", async () => {
  const h = harness();
  const send = () => h.outbox.notify("survey-booked", { projectId: PROJECT_ID, data: surveyBooked, discriminator: "slot-a" });
  const results = await Promise.all([send(), send(), send()]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["demo", "duplicate", "duplicate"]);
  const { data: rows } = await h.db.from("messages").select("id");
  assert.equal(rows!.length, 1);
});

test("live providers: email and SMS are sent and acknowledged; phones are normalised", async () => {
  const h = harness({ email: true, sms: true });
  const r = await h.outbox.notify("survey-reminder", { projectId: PROJECT_ID, data: surveyBooked, discriminator: "d1" });
  assert.deepEqual(r.results.map((x) => [x.channel, x.status, x.to]), [
    ["email", "sent", CUSTOMER.email],
    ["sms", "sent", "+447700900123"],
  ]);
  const sms = await h.store.get(r.results[1].messageId!);
  assert.equal(sms!.providerRef, "SM-demo");
  assert.equal(sms!.attempts, 1);
  assert.ok(sms!.sentAt);
  assert.ok(sms!.bodyText.includes(PHONE));
  assert.equal(h.sent.length, 2);
});

test("failures are recorded, retried by the cron up to three attempts, and resend is one more try on the same key", async () => {
  const h = harness({ email: true, emailOk: [false, false, false, false] });
  const r = await h.outbox.notify("proposal-issued", { projectId: PROJECT_ID, data: { version: 1, validUntil: "2026-12-03" }, discriminator: "prop-1" });
  assert.equal(r.status, "failed");
  const id = r.results[0].messageId!;
  assert.equal((await h.store.get(id))!.error, "Resend said no");

  const later = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();
  assert.equal((await h.outbox.dispatchDue(new Date().toISOString())).due, 0, "a just-touched row is in flight");
  assert.deepEqual(await h.outbox.dispatchDue(later(10)), { due: 1, sent: 0, demo: 0, failed: 1, skipped: 0, errors: 0 });
  await h.outbox.dispatchDue(later(20));
  assert.equal((await h.store.get(id))!.attempts, 3);
  assert.equal((await h.outbox.dispatchDue(later(30))).due, 0, "three strikes: a person decides");

  const again = await h.outbox.resend(id); // the fourth scripted result is also a failure
  assert.equal(again.status, "failed");
  const ok = await h.outbox.resend(id); // scripted results exhausted: success
  assert.equal(ok.status, "sent");
  const final = (await h.store.get(id))!;
  assert.equal(final.attempts, 5);
  assert.equal(final.error, undefined, "the old error is cleared");
  assert.equal(final.idempotencyKey, idempotencyKey("proposal-issued", PROJECT_ID, "prop-1", "email"));
  assert.equal((await h.outbox.resend("00000000-0000-4000-8000-00000000dead")).status, "error");
});

test("scheduled messages wait for the cron; turning the event off before then skips them", async () => {
  const h = harness({ email: true });
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const r = await h.outbox.notify("check-in-7d", { projectId: PROJECT_ID, data: {}, discriminator: "7d", scheduledFor: tomorrow });
  assert.equal(r.status, "queued");
  assert.equal(h.sent.length, 0);
  assert.equal((await h.outbox.dispatchDue(new Date(Date.now() + 3_600_000).toISOString())).due, 0, "not due yet");
  const summary = await h.outbox.dispatchDue(new Date(Date.now() + 2 * 86_400_000).toISOString());
  assert.equal(summary.sent, 1);
  assert.equal(h.sent.length, 1);

  const off = mergeSettings({ comms: { disabledEvents: ["service-reminder"] } });
  const h2 = harness({ email: true, settings: SETTINGS });
  const q = await h2.outbox.notify("service-reminder", { projectId: PROJECT_ID, data: { dueOn: "2027-12-03" }, discriminator: "y1", scheduledFor: tomorrow });
  assert.equal(q.status, "queued");
  const h2off = createOutboxOver(h2, off);
  const s2 = await h2off.dispatchDue(new Date(Date.now() + 2 * 86_400_000).toISOString());
  assert.equal(s2.skipped, 1);
  assert.equal((await h2.store.get(q.results[0].messageId!))!.status, "skipped");
});

/** A second engine over the same store, with different settings (as if someone saved them in between). */
function createOutboxOver(h: ReturnType<typeof harness>, settings: PilotSettings) {
  return createOutbox({
    store: h.store,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    getSettings: async () => settings,
    loadProject: async () => null,
    customerLink: async () => "",
    appUrl: () => "",
    teamInbox: () => null,
    email: { provider: "resend", configured: () => true, send: async () => ({ ok: true }) },
    sms: { provider: "twilio", configured: () => true, send: async () => ({ ok: true }) },
    log: () => {},
  });
}

test("disabled events, missing recipients and team routing", async () => {
  const off = harness({ settings: mergeSettings({ comms: { disabledEvents: ["survey-booked"] } }) });
  const r = await off.outbox.notify("survey-booked", { projectId: PROJECT_ID, data: surveyBooked, discriminator: "x" });
  assert.equal(r.status, "disabled");
  assert.equal((await off.db.from("messages").select("id")).data!.length, 0, "disabled: nothing stored");

  const noContact = baseProject();
  noContact.customer.email = undefined;
  noContact.customer.phone = "020 7946 0018"; // a landline can't take a text
  const h = harness({ project: noContact });
  const rem = await h.outbox.notify("survey-reminder", { projectId: PROJECT_ID, data: surveyBooked, discriminator: "y" });
  assert.deepEqual(rem.results.map((x) => x.status), ["no-recipient", "no-recipient"]);

  const team = harness();
  const t = await team.outbox.notify("team-alert", { projectId: PROJECT_ID, data: { title: "Hello team" }, discriminator: "t1" });
  assert.equal(t.results[0].to, "team@example.test");
  const msg = await team.store.get(t.results[0].messageId!);
  assert.match(msg!.bodyText, /https:\/\/dang\.example\/ops\/projects\//, "team mail links to ops, without a customer token");

  const explicit = await team.outbox.notify("magic-link", { to: "staff@example.test", data: { link: "https://dang.example/auth/verify?t=abc", name: "Alex Demo", audience: "staff" }, discriminator: "tok-1" });
  assert.equal(explicit.results[0].to, "staff@example.test");
  const ml = await team.store.get(explicit.results[0].messageId!);
  assert.match(ml!.bodyText, /^Hi Alex,/);
  assert.equal(ml!.projectId, undefined);
});

test("the engine never throws: a broken dependency becomes an error result", async () => {
  const h = harness();
  const broken = createOutbox({
    store: h.store,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    getSettings: async () => {
      throw new Error("settings table on fire");
    },
    loadProject: async () => null,
    customerLink: async () => "",
    appUrl: () => "",
    teamInbox: () => null,
    email: { provider: "resend", configured: () => true, send: async () => ({ ok: true }) },
    sms: { provider: "twilio", configured: () => true, send: async () => ({ ok: true }) },
    log: () => {},
  });
  const r = await broken.notify("survey-booked", { projectId: PROJECT_ID, data: surveyBooked, discriminator: "z" });
  assert.equal(r.status, "error");
  assert.match(r.results[0].error ?? "", /on fire/);

  const throwingSend = harness({ email: true });
  const engine = createOutbox({
    store: throwingSend.store,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    getSettings: async () => SETTINGS,
    loadProject: async () => baseProject(),
    customerLink: async () => {
      throw new Error("token table down");
    },
    appUrl: () => "https://dang.example",
    teamInbox: () => null,
    email: {
      provider: "resend",
      configured: () => true,
      send: async () => {
        throw new Error("socket hang up");
      },
    },
    sms: { provider: "twilio", configured: () => false, send: async () => ({ ok: true }) },
    log: () => {},
  });
  const res = await engine.notify("survey-complete", { projectId: PROJECT_ID, data: {}, discriminator: "s1" });
  assert.equal(res.status, "failed");
  const stored = await throwingSend.store.get(res.results[0].messageId!);
  assert.ok(stored!.bodyText.includes(LINK_PLACEHOLDER), "the stored body never holds a link with a token");
  assert.equal(stored!.error, "socket hang up");

  // When minting fails, the send goes out with a plain link instead.
  const attempted: string[] = [];
  const plainFallback = createOutbox({
    store: throwingSend.store,
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    getSettings: async () => SETTINGS,
    loadProject: async () => baseProject(),
    customerLink: async () => {
      throw new Error("token table down");
    },
    appUrl: () => "https://dang.example",
    teamInbox: () => null,
    email: {
      provider: "resend",
      configured: () => true,
      send: async (_to, _subject, html) => {
        attempted.push(html);
        return { ok: true };
      },
    },
    sms: { provider: "twilio", configured: () => false, send: async () => ({ ok: true }) },
    log: () => {},
  });
  const sentPlain = await plainFallback.notify("survey-complete", { projectId: PROJECT_ID, data: {}, discriminator: "s2" });
  assert.equal(sentPlain.status, "sent");
  assert.match(attempted[0]!, new RegExp(`href="https://dang\\.example/p/${PROJECT_ID}#survey"`), "a plain link when the magic link fails");
});

test("pure helpers: consent, addresses, headline", () => {
  for (const e of ALL_EVENTS) assert.equal(consentAllows(e, false), true, `${e} is operational`);
  assert.equal(addressFor("email", { email: " sam@example.test " }), "sam@example.test");
  assert.equal(addressFor("email", { email: "not-an-email" }), null);
  assert.equal(addressFor("sms", { phone: "07700 900123" }), "+447700900123");
  assert.equal(addressFor("sms", { phone: "020 7946 0018" }), null);
  assert.equal(headline([{ channel: "email", status: "failed" }, { channel: "sms", status: "sent" }]), "sent");
  assert.equal(headline([{ channel: "email", status: "no-recipient" }]), "no-recipient");
  assert.equal(headline([]), "no-recipient");
});
