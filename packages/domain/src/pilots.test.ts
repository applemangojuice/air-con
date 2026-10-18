import assert from "node:assert/strict";
import { test } from "node:test";
import type { OptionPricing } from "./costing.ts";
import type { Issue } from "./issues.ts";
import {
  HOURS_PER_DAY,
  LEARNING_PROMPTS,
  PILOT_METRIC_ROWS,
  chosenOption,
  csvCell,
  entryMinutes,
  extremes,
  pilotMetrics,
  pilotsCsv,
  type PilotMetrics,
  type TimeEntry,
} from "./pilots.ts";
import { generateQuote } from "./pricing.ts";
import { createProject, type Project } from "./project.ts";
import type { ProposalOption, ProposalRecord } from "./proposal.ts";
import type { PurchaseOrder } from "./purchasing.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import type { Survey } from "./types.ts";

/* ------------------------------------------------------------------ */
/* Fixtures: a fictional DEMO pilot, followed from quote to aftercare  */
/* ------------------------------------------------------------------ */

const SURVEY: Survey = {
  postcode: "SW16 9ZZ",
  addressLine: "1 Demo Street",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [
    { id: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
    { id: "r2", name: "Living room", type: "living-room", size: "large", floor: "ground", glazing: "high", orientation: "west", hasExternalWall: true, photos: [] },
  ],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

function baseProject(): Project {
  const quote = generateQuote(SURVEY);
  return createProject({
    id: "11111111-de5e-4000-8000-000000000001",
    quoteId: "q-demo-1",
    createdAt: "2026-11-02T09:00:00.000Z",
    customerName: "Demo Household (DEMO)",
    survey: SURVEY,
    quote,
  });
}

const PRICING: OptionPricing = {
  pricingBasis: "cost-plus",
  listNetPence: 500_000,
  discount: { code: "PILOT15", label: "Pilot discount (15%)", reason: "Early pilot home", amountPence: 75_000 },
  netPence: 425_000,
  taxCode: "outside-scope",
  taxPence: 0,
  totalPence: 425_000,
  costPence: 280_000,
  unpricedCostLines: 0,
  grossMarginPct: 34.1,
  grossMarginPctBeforeDiscount: 44,
  contributionPence: 145_000,
  belowMinMargin: false,
};

function option(over: Partial<ProposalOption> = {}): ProposalOption {
  return {
    id: "opt-std",
    label: "Standard",
    tier: "standard",
    designVariantId: "v-std",
    summary: "Two single splits",
    highlights: [],
    roomCards: [],
    outdoorMediaIds: [],
    priceLines: [],
    costLines: [
      { id: "c1", category: "equipment", label: "Indoor unit 2.5 kW (DEMO)", qty: 1, unit: "each", unitCostPence: 30_000, totalPence: 30_000, catalogueItemId: "demo-in-25", verified: false },
      { id: "c2", category: "equipment", label: "Outdoor unit 2.5 kW (DEMO)", qty: 1, unit: "each", unitCostPence: 90_000, totalPence: 90_000, catalogueItemId: "demo-out-25", verified: false },
      { id: "c3", category: "materials", label: "Pipe kit 5 m (DEMO)", qty: 2, unit: "kit", unitCostPence: 6_000, totalPence: 12_000, catalogueItemId: "demo-pipe-5", verified: false },
      { id: "c4", category: "subcontract", label: "Electrician (DEMO)", qty: 1, unit: "job", unitCostPence: 25_000, totalPence: 25_000, verified: false },
      { id: "c5", category: "labour", label: "Installer", qty: 3, unit: "day", unitCostPence: 22_000, totalPence: 66_000, verified: false },
    ],
    labour: { crewSize: 2, installerDays: 3, electricianDays: 1, techLeadDays: 2 },
    pricing: PRICING,
    installDays: 3,
    ...over,
  };
}

function proposal(over: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "p-1",
    projectId: "11111111-de5e-4000-8000-000000000001",
    version: 1,
    status: "accepted",
    designId: "d-1",
    designVersion: 1,
    options: [option(), option({ id: "opt-quiet", label: "Quiet", tier: "premium", pricing: { ...PRICING, listNetPence: 590_000, netPence: 501_500, totalPence: 501_500 } })],
    inclusions: [],
    exclusions: [],
    assumptions: [],
    warranty: null,
    validUntil: "2026-12-15",
    termsVersion: "pilot-draft-1",
    instantPriceGbp: 4200,
    createdAt: "2026-11-12T10:00:00.000Z",
    acceptance: {
      optionId: "opt-std",
      optionLabel: "Standard",
      totalPence: 425_000,
      name: "Demo Household",
      termsVersion: "pilot-draft-1",
      cancellationNoticeVersion: "cancel-v1",
      acknowledgedCancellationInfo: true,
      earlyStartRequested: false,
      acknowledgedLossOfRight: false,
      at: "2026-11-16T19:00:00.000Z",
    },
    ...over,
  };
}

/** The same pilot, handed over: surveyed, proposed, accepted, installed over three days, handed over, scored. */
function finishedProject(): Project {
  const p = baseProject();
  p.pilot = { number: 1, label: "Pilot 1 · Owner's home" };
  p.survey = { ...p.survey, status: "submitted", startedAt: "2026-11-09T10:00:00.000Z", submittedAt: "2026-11-09T11:35:00.000Z" };
  p.proposal = {
    ...p.proposal,
    status: "accepted",
    proposalId: "p-1",
    version: 1,
    issuedAt: "2026-11-12T10:00:00.000Z",
    acceptedAt: "2026-11-16T19:00:00.000Z",
    acceptedOptionLabel: "Standard",
    contractTotalPence: 425_000,
  };
  p.money = { contractTotalPence: 425_000, invoicedPence: 425_000, paidPence: 425_000, changeFeesPence: 0 };
  p.booking = { ...p.booking, status: "booked", startDate: "2026-12-08", dates: ["2026-12-08", "2026-12-09", "2026-12-10"], installDays: 3 };
  p.kit = { status: "inspected", deliveredAt: "2026-12-01T11:00:00.000Z", inspectedAt: "2026-12-08T09:00:00.000Z", shortages: 0 };
  p.install = {
    status: "complete",
    startedAt: "2026-12-08T08:05:00.000Z",
    completedAt: "2026-12-11T15:00:00.000Z",
    days: [
      { n: 1, date: "2026-12-08", status: "done", startedAt: "2026-12-08T08:05:00.000Z", endedAt: "2026-12-08T16:30:00.000Z" },
      { n: 2, date: "2026-12-09", status: "done", startedAt: "2026-12-09T08:00:00.000Z", endedAt: "2026-12-09T17:00:00.000Z" },
      { n: 3, date: "2026-12-10", status: "done", startedAt: "2026-12-10T08:00:00.000Z", endedAt: "2026-12-10T17:30:00.000Z" },
      { n: 4, date: "2026-12-11", status: "done", startedAt: "2026-12-11T08:00:00.000Z", endedAt: "2026-12-11T12:00:00.000Z" },
    ],
  };
  p.handover = { ...p.handover, status: "handed-over", handedOverAt: "2026-12-11T15:30:00.000Z", electricalCert: "received", warrantyRegistered: true };
  p.aftercare = { feedback: { at: "2027-01-12T09:00:00.000Z", score: 9 } };
  p.events.push(
    { at: "2026-11-12T10:00:00.000Z", type: "proposal-issued", label: "Your proposal is ready.", actor: "ops" },
    { at: "2026-11-13T10:00:00.000Z", type: "proposal-changes-requested", label: "You asked for some changes.", actor: "customer" },
  );
  return p;
}

const PO: PurchaseOrder = {
  id: "po-1",
  projectId: "11111111-de5e-4000-8000-000000000001",
  supplier: "DEMO Supplies",
  status: "inspected",
  destination: "customer",
  lines: [
    { id: "l1", catalogueItemId: "demo-in-25", label: "Indoor 2.5 kW", qty: 2, unitCostPence: 30_000, actualUnitCostPence: 28_500, receivedQty: 2, inspectedQty: 2, damagedQty: 0, serials: [], required: true },
    { id: "l2", catalogueItemId: "demo-out-25", label: "Outdoor 2.5 kW", qty: 2, unitCostPence: 90_000, actualUnitCostPence: 92_000, receivedQty: 2, inspectedQty: 2, damagedQty: 0, serials: [], required: true },
    { id: "l3", catalogueItemId: "demo-pipe-5", label: "Pipe kit", qty: 2, unitCostPence: 6_000, receivedQty: 2, inspectedQty: 2, damagedQty: 0, serials: [], required: true },
    { id: "l4", label: "Condensate pump (added on day 2)", qty: 1, unitCostPence: 8_500, actualUnitCostPence: 9_000, receivedQty: 1, inspectedQty: 1, damagedQty: 0, serials: [], required: false },
  ],
  expectedTotalPence: 260_500,
  shippingPence: 2_500,
  mediaIds: [],
  history: [],
};

const entry = (over: Partial<TimeEntry> & Pick<TimeEntry, "kind" | "staffName">): TimeEntry => ({
  id: `t-${Math.random()}`,
  projectId: "11111111-de5e-4000-8000-000000000001",
  startedAt: "2026-12-08T08:00:00.000Z",
  ...over,
});

const TIME: TimeEntry[] = [
  entry({ kind: "survey", staffName: "DEMO Sam", staffId: "s-sam", minutes: 95, startedAt: "2026-11-09T10:00:00.000Z" }),
  entry({ kind: "travel", staffName: "DEMO Ivo", staffId: "s-ivo", minutes: 45 }),
  entry({ kind: "install", staffName: "DEMO Ivo", staffId: "s-ivo", startedAt: "2026-12-08T08:00:00.000Z", endedAt: "2026-12-08T16:30:00.000Z" }),
  entry({ kind: "install", staffName: "DEMO Tess", staffId: "s-tess", minutes: 480 }),
  entry({ kind: "rework", staffName: "DEMO Ivo", staffId: "s-ivo", minutes: 90 }),
  entry({ kind: "commissioning", staffName: "DEMO Tess", staffId: "s-tess", minutes: 180 }),
  entry({ kind: "install", staffName: "DEMO Eli", staffId: "s-eli", minutes: 240 }),
  // A clock still running counts nothing yet.
  entry({ kind: "install", staffName: "DEMO Ivo", staffId: "s-ivo", startedAt: "2026-12-11T08:00:00.000Z" }),
];

const issue = (over: Partial<Issue> & Pick<Issue, "kind" | "raisedAt">): Issue => ({
  id: `i-${Math.random()}`,
  projectId: "11111111-de5e-4000-8000-000000000001",
  number: 1,
  title: "Something",
  severity: "low",
  status: "resolved",
  blocking: false,
  ownerRole: "ops",
  raisedBy: { kind: "staff", name: "DEMO Ivo" },
  mediaIds: [],
  customerVisible: false,
  history: [],
  ...over,
});

const ISSUES: Issue[] = [
  issue({ kind: "shortage", raisedAt: "2026-12-09T10:00:00.000Z" }),
  issue({ kind: "snag", raisedAt: "2026-12-11T15:20:00.000Z" }), // at handover, same day: counts in both windows
  issue({ kind: "defect", raisedAt: "2026-12-15T09:00:00.000Z" }), // day 4
  issue({ kind: "fault", raisedAt: "2027-01-05T09:00:00.000Z" }), // day 25
  issue({ kind: "defect", raisedAt: "2027-02-20T09:00:00.000Z" }), // day 71: outside both
  issue({
    kind: "variation",
    raisedAt: "2026-12-09T12:00:00.000Z",
    variation: { description: "Extra trunking", priceDeltaNetPence: 12_000, taxPence: 0, totalDeltaPence: 12_000, status: "accepted" },
  }),
  issue({
    kind: "variation",
    raisedAt: "2026-12-09T13:00:00.000Z",
    variation: { description: "Move the unit", priceDeltaNetPence: 30_000, taxPence: 0, totalDeltaPence: 30_000, status: "declined" },
  }),
];

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test("the eight learning prompts keep their stable ids", () => {
  assert.equal(LEARNING_PROMPTS.length, 8);
  assert.equal(new Set(LEARNING_PROMPTS.map((p) => p.id)).size, 8);
  assert.ok(LEARNING_PROMPTS.every((p) => p.question.endsWith("?")));
});

test("a project with nothing recorded yet: nulls, never guesses", () => {
  const p = baseProject();
  const m = pilotMetrics({ project: p, purchaseOrders: [], time: [], issues: [], messagesSent: 0 });
  assert.equal(m.stage, "price");
  assert.equal(m.label, "Demo Household (DEMO)");
  assert.equal(m.pilotNumber, undefined);
  assert.equal(m.instantPricePence, Math.round(p.quoteSummary.totalGbp * 100));
  assert.equal(m.listPricePence, null);
  assert.equal(m.contractPricePence, null);
  assert.equal(m.revenuePence, 0);
  assert.equal(m.grossProfitPence, null);
  assert.equal(m.grossMarginPct, null);
  assert.equal(m.estimatedCostPence, null);
  assert.equal(m.estimatedLabourHours, null);
  assert.equal(m.actualInstallDays, null);
  assert.equal(m.surveyMinutes, null);
  assert.equal(m.daysQuoteToSurvey, null);
  assert.equal(m.daysSurveyToProposal, null);
  assert.equal(m.daysAcceptanceToInstall, null);
  assert.equal(m.satisfaction, null);
  assert.equal(m.selfSurveyAccuracyPct, null);
  assert.equal(m.labourCostPence, null);
  assert.equal(m.costBasis, "none");
  assert.equal(m.actualCostPence, 0);
  assert.equal(m.plannedInstallDays, 3);
  assert.deepEqual(m.issuesByKind, {});
  assert.deepEqual(m.labourHoursByPerson, {});
});

test("a finished pilot: prices, revenue, costs by category and margin", () => {
  const m = pilotMetrics({
    project: finishedProject(),
    proposal: proposal(),
    purchaseOrders: [PO],
    time: TIME,
    issues: ISSUES,
    messagesSent: 14,
    settings: DEFAULT_SETTINGS,
    staffRoles: { "s-sam": ["surveyor"], "s-ivo": ["installer"], "s-tess": ["tech-lead"], "s-eli": ["electrician"] },
  });
  assert.equal(m.pilotNumber, 1);
  assert.equal(m.label, "Pilot 1 · Owner's home");
  assert.equal(m.stage, "aftercare");
  // Not VAT registered: the list price carries no tax.
  assert.equal(m.listPricePence, 500_000);
  assert.equal(m.contractPricePence, 425_000);
  // Net price + the accepted variation (the declined one doesn't count).
  assert.equal(m.revenuePence, 425_000 + 12_000);
  // Actual where recorded, expected for the pipe kits; the unmatched pump is materials.
  assert.equal(m.equipmentCostPence, 2 * 28_500 + 2 * 92_000);
  assert.equal(m.materialsCostPence, 2 * 6_000 + 9_000 + 2_500);
  assert.equal(m.costBasis, "mixed");
  // No subcontract PO: the proposal's expected figure stands in.
  assert.equal(m.subcontractCostPence, 25_000);
  assert.equal(m.estimatedCostPence, 280_000);
  // Logged hours at the default rates: survey 95 min at £40/h, Ivo's 8.5 h install +
  // 0.75 h travel + 1.5 h rework at £220/day, Tess 11 h at £280/day, Eli 4 h at £250/day.
  const r = DEFAULT_SETTINGS.pricing.labourRates;
  const expectedLabour = Math.round(
    (95 / 60) * r.surveyorHourPence +
      (8.5 + 0.75 + 1.5) * (r.installerDayPence / HOURS_PER_DAY) +
      11 * (r.techLeadDayPence / HOURS_PER_DAY) +
      4 * (r.electricianDayPence / HOURS_PER_DAY),
  );
  assert.equal(m.labourCostPence, expectedLabour);
  const costs = m.equipmentCostPence + m.materialsCostPence + m.subcontractCostPence + expectedLabour;
  assert.equal(m.actualCostPence, costs);
  assert.equal(m.grossProfitPence, m.revenuePence - costs);
  assert.equal(m.grossMarginPct, Math.round(((m.revenuePence - costs) / m.revenuePence) * 1000) / 10);
});

test("a finished pilot: hours, days, durations and quality", () => {
  const m = pilotMetrics({
    project: finishedProject(),
    proposal: proposal(),
    purchaseOrders: [PO],
    time: TIME,
    issues: ISSUES,
    messagesSent: 14,
    surveyDiff: [
      { room: "Main bedroom", field: "size", customerSaid: "medium", measured: "13 m²", match: true },
      { room: "Living room", field: "size", customerSaid: "large", measured: "28 m²", match: false },
      { room: "Outdoor", field: "location", customerSaid: "ground-rear", measured: "ground-rear", match: true },
      { room: "Electrics", field: "board", customerSaid: "unsure", measured: "modern-rcbo", match: null },
    ],
  });
  assert.equal(m.estimatedLabourHours, (3 + 1 + 2) * HOURS_PER_DAY);
  assert.equal(m.actualLabourHours, Math.round(((95 + 45 + 510 + 480 + 90 + 180 + 240) / 60) * 10) / 10);
  assert.equal(m.installLabourHours, Math.round(((510 + 480 + 90 + 180 + 240) / 60) * 10) / 10);
  assert.deepEqual(m.labourHoursByPerson, { "DEMO Sam": 1.6, "DEMO Ivo": 10.8, "DEMO Tess": 11, "DEMO Eli": 4 });
  assert.equal(m.labourHoursByKind.install, 20.5);
  assert.equal(m.travelHours, 0.8);
  assert.equal(m.reworkHours, 1.5);
  assert.equal(m.labourCostPence, null, "no settings: hours aren't costed");
  assert.equal(m.plannedInstallDays, 3);
  assert.equal(m.actualInstallDays, 4, "a fourth day was needed");
  assert.equal(m.surveyMinutes, 95, "the logged survey time wins over the start-to-submit span");
  assert.equal(m.daysQuoteToSurvey, 7);
  assert.equal(m.daysSurveyToProposal, 3);
  assert.equal(m.daysAcceptanceToInstall, 22);
  assert.deepEqual(m.issuesByKind, { shortage: 1, snag: 1, defect: 2, fault: 1, variation: 2 });
  assert.equal(m.unplannedMaterials, 1);
  assert.equal(m.customerChanges, 1 + 2, "one change request plus two variations");
  assert.equal(m.messagesSent, 14);
  assert.equal(m.satisfaction, 9);
  assert.equal(m.defects7d, 2);
  assert.equal(m.defects30d, 3);
  assert.equal(m.selfSurveyAccuracyPct, 67, "2 of the 3 comparable rows matched");
});

test("survey minutes fall back to the start-to-submit span, then the record's own timing wins", () => {
  const p = finishedProject();
  const noLog = pilotMetrics({ project: p, purchaseOrders: [], time: [], issues: [], messagesSent: 0 });
  assert.equal(noLog.surveyMinutes, 95);
  const recorded = pilotMetrics({ project: p, purchaseOrders: [], time: TIME, issues: [], messagesSent: 0, surveyMinutes: 88 });
  assert.equal(recorded.surveyMinutes, 88);
  const odd = finishedProject();
  odd.survey.submittedAt = "2026-11-11T11:35:00.000Z"; // submitted two days later: not a visit length
  assert.equal(pilotMetrics({ project: odd, purchaseOrders: [], time: [], issues: [], messagesSent: 0 }).surveyMinutes, null);
});

test("an issued, not yet accepted proposal: list price and estimate, no revenue", () => {
  const p = baseProject();
  p.survey = { ...p.survey, status: "submitted", submittedAt: "2026-11-09T11:35:00.000Z" };
  p.proposal = { ...p.proposal, status: "issued", proposalId: "p-1", version: 1, issuedAt: "2026-11-12T10:00:00.000Z" };
  const rec = proposal({ status: "issued", acceptance: undefined });
  const m = pilotMetrics({ project: p, proposal: rec, purchaseOrders: [], time: [], issues: [], messagesSent: 2 });
  assert.equal(m.stage, "proposal");
  assert.equal(m.listPricePence, 500_000, "the first option until one is chosen");
  assert.equal(m.contractPricePence, null);
  assert.equal(m.revenuePence, 0);
  assert.equal(m.grossProfitPence, null);
  assert.equal(m.estimatedCostPence, 280_000);
  assert.equal(m.daysSurveyToProposal, 3, "from the issue time when there's no event");
});

test("VAT-registered options carry their tax on the list price", () => {
  const p = finishedProject();
  const taxed = proposal({
    options: [option({ pricing: { ...PRICING, taxCode: "reduced-5", taxPence: 21_250, totalPence: 446_250 } })],
  });
  const m = pilotMetrics({ project: p, proposal: taxed, purchaseOrders: [], time: [], issues: [], messagesSent: 0 });
  assert.equal(m.listPricePence, 525_000);
});

test("expected-only and actual-only purchase orders are flagged; cancelled ones don't count", () => {
  const p = finishedProject();
  const expectedOnly: PurchaseOrder = { ...PO, lines: PO.lines.map(({ actualUnitCostPence: _a, ...l }) => l) };
  assert.equal(pilotMetrics({ project: p, purchaseOrders: [expectedOnly], time: [], issues: [], messagesSent: 0 }).costBasis, "expected");
  const actualOnly: PurchaseOrder = { ...PO, lines: PO.lines.map((l) => ({ ...l, actualUnitCostPence: l.unitCostPence ?? 0 })) };
  assert.equal(pilotMetrics({ project: p, purchaseOrders: [actualOnly], time: [], issues: [], messagesSent: 0 }).costBasis, "actual");
  const cancelled: PurchaseOrder = { ...PO, status: "cancelled" };
  const m = pilotMetrics({ project: p, purchaseOrders: [cancelled], time: [], issues: [], messagesSent: 0 });
  assert.equal(m.costBasis, "none");
  assert.equal(m.equipmentCostPence, 0);
  assert.equal(m.unplannedMaterials, 0);
});

test("chosenOption: the accepted one, then the named one, then the first", () => {
  const p = finishedProject();
  assert.equal(chosenOption(proposal(), p)?.id, "opt-std");
  const byLabel = proposal({ acceptance: undefined });
  p.proposal.acceptedOptionLabel = "Quiet";
  assert.equal(chosenOption(byLabel, p)?.id, "opt-quiet");
  assert.equal(chosenOption(undefined, p), undefined);
  assert.equal(chosenOption(proposal({ options: [] }), p), undefined);
});

test("entryMinutes: logged minutes, else end minus start, a running clock is zero", () => {
  assert.equal(entryMinutes({ minutes: 30, startedAt: "2026-12-08T08:00:00Z" }), 30);
  assert.equal(entryMinutes({ startedAt: "2026-12-08T08:00:00Z", endedAt: "2026-12-08T09:30:00Z" }), 90);
  assert.equal(entryMinutes({ startedAt: "2026-12-08T08:00:00Z" }), 0);
  assert.equal(entryMinutes({ startedAt: "2026-12-08T09:00:00Z", endedAt: "2026-12-08T08:00:00Z" }), 0);
  assert.equal(entryMinutes({ minutes: -5, startedAt: "2026-12-08T08:00:00Z" }), 0);
});

test("extremes: best and worst only among real numbers, and only when they differ", () => {
  assert.deepEqual(extremes([10, 20, null, 30], "higher"), { best: [3], worst: [0] });
  assert.deepEqual(extremes([10, 20, 10], "lower"), { best: [0, 2], worst: [1] });
  assert.deepEqual(extremes([5, 5], "lower"), { best: [], worst: [] });
  assert.deepEqual(extremes([5, null], "lower"), { best: [], worst: [] }, "a lone pilot isn't best at anything");
  assert.deepEqual(extremes([1, 2], null), { best: [], worst: [] });
});

test("the comparison rows name real metrics", () => {
  const sample = pilotMetrics({ project: baseProject(), purchaseOrders: [], time: [], issues: [], messagesSent: 0 });
  for (const row of PILOT_METRIC_ROWS) assert.ok(row.key in sample, `${row.key} is a metric`);
});

test("pilotsCsv: header, pounds, empty unknowns, breakdowns and safe cells", () => {
  const finished = pilotMetrics({ project: finishedProject(), proposal: proposal(), purchaseOrders: [PO], time: TIME, issues: ISSUES, messagesSent: 14 });
  const fresh: PilotMetrics = { ...pilotMetrics({ project: baseProject(), purchaseOrders: [], time: [], issues: [], messagesSent: 0 }), label: '=HYPERLINK("x"), "quoted"' };
  const csv = pilotsCsv([finished, fresh]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(csv.endsWith("\r\n"));
  const header = lines[0]!.split(",");
  assert.equal(header[0], "pilot_number");
  assert.ok(header.includes("self_survey_accuracy_pct"));
  assert.ok(header.includes("hours_by_person"));
  const row = lines[1]!;
  assert.ok(row.startsWith("1,Pilot 1 · Owner's home,"));
  assert.ok(row.includes(",4250.00,"), "contract price in pounds");
  assert.ok(row.includes("DEMO Eli: 4; DEMO Ivo: 10.8; DEMO Sam: 1.6; DEMO Tess: 11"), "breakdown sorted by name");
  // Unknowns are empty, not zero; the label is quoted and defused.
  assert.ok(lines[2]!.startsWith(`,"'=HYPERLINK(""x""), ""quoted""",`));
  assert.ok(lines[2]!.includes(",,"));
});

test("csvCell quotes and defuses", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(-12.5), "-12.5", "negative numbers stay numbers");
  assert.equal(csvCell("-12.5"), "'-12.5", "a typed string starting with - is defused");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell("@sum"), "'@sum");
});
