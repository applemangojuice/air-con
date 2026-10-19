import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ISSUE_KIND_LABEL,
  ISSUE_STATUS_LABEL,
  createIssue,
  defaultsForKind,
  isOpen,
  sendVariationToCustomer,
  transitionIssue,
  variationAmounts,
  variationPricing,
  type Issue,
  type IssueKind,
} from "./issues.ts";

const AT = "2026-11-10T09:00:00.000Z";
const RAISER = { kind: "staff" as const, id: "s1", name: "DEMO Ivo (installer)" };

function issue(kind: IssueKind = "defect", over: Partial<Issue> = {}): Issue {
  return { ...createIssue({ id: "i1", projectId: "p1", number: 1, kind, title: "DEMO: loose clip", raisedBy: RAISER, raisedAt: AT }), ...over };
}

test("defaultsForKind: every kind has defaults; safety stops the job, snags are the customer's", () => {
  for (const kind of Object.keys(ISSUE_KIND_LABEL) as IssueKind[]) {
    const d = defaultsForKind(kind);
    assert.ok(["low", "medium", "high", "critical"].includes(d.severity), kind);
    assert.equal(typeof d.blocking, "boolean");
  }
  assert.deepEqual(defaultsForKind("safety"), { severity: "critical", blocking: true, ownerRole: "tech-lead", customerVisible: false });
  assert.equal(defaultsForKind("shortage").blocking, true);
  assert.equal(defaultsForKind("blocker").blocking, true);
  assert.equal(defaultsForKind("snag").customerVisible, true);
  assert.equal(defaultsForKind("variation").ownerRole, "customer");
  assert.equal(defaultsForKind("clarification").blocking, false);
  // A copy: callers may tweak it.
  const d = defaultsForKind("defect");
  d.severity = "critical";
  assert.equal(defaultsForKind("defect").severity, "medium");
  assert.throws(() => defaultsForKind("nope" as IssueKind));
});

test("createIssue: defaults applied, overrides win, first history line, media de-duplicated", () => {
  const i = createIssue({
    id: "i2",
    projectId: "p1",
    number: 0,
    kind: "safety",
    title: "  Suspected asbestos behind the board  ",
    detail: " ",
    raisedBy: RAISER,
    raisedAt: AT,
    mediaIds: ["m1", "m1", "m2"],
    gate: "install-complete",
  });
  assert.equal(i.title, "Suspected asbestos behind the board");
  assert.equal(i.detail, undefined, "blank detail left out");
  assert.equal(i.number, 1, "numbers start at 1");
  assert.equal(i.severity, "critical");
  assert.equal(i.blocking, true);
  assert.equal(i.status, "open");
  assert.equal(i.gate, "install-complete");
  assert.deepEqual(i.mediaIds, ["m1", "m2"]);
  assert.deepEqual(i.history, [{ at: AT, by: RAISER.name, note: "Raised.", status: "open" }]);
  assert.equal(isOpen(i), true);
  const quiet = createIssue({ id: "i3", projectId: "p1", number: 2, kind: "safety", title: "DEMO", raisedBy: RAISER, raisedAt: AT, blocking: false, severity: "high" });
  assert.equal(quiet.blocking, false);
  assert.equal(quiet.severity, "high");
  assert.throws(() => createIssue({ id: "x", projectId: "p1", number: 1, kind: "defect", title: "  ", raisedBy: RAISER, raisedAt: AT }), /title/);
});

test("variations: priced with tax from the contract's rate, proposed, waiting for the customer, visible to them", () => {
  assert.deepEqual(variationAmounts(12_000, 0), { priceDeltaNetPence: 12_000, taxPence: 0, totalDeltaPence: 12_000 });
  assert.deepEqual(variationAmounts(12_000, 20), { priceDeltaNetPence: 12_000, taxPence: 2_400, totalDeltaPence: 14_400 });
  assert.deepEqual(variationAmounts(10_001, 5), { priceDeltaNetPence: 10_001, taxPence: 500, totalDeltaPence: 10_501 });
  assert.deepEqual(variationAmounts(-5_000, 20), { priceDeltaNetPence: -5_000, taxPence: -1_000, totalDeltaPence: -6_000 });
  // Priced on a code: its rate, and the code kept so the invoice splits the total the same way.
  assert.deepEqual(variationPricing(12_000, "standard-20"), { priceDeltaNetPence: 12_000, taxPence: 2_400, totalDeltaPence: 14_400, taxCode: "standard-20" });
  assert.deepEqual(variationPricing(10_000, "reduced-5"), { priceDeltaNetPence: 10_000, taxPence: 500, totalDeltaPence: 10_500, taxCode: "reduced-5" });
  assert.deepEqual(variationPricing(10_000, "outside-scope"), { priceDeltaNetPence: 10_000, taxPence: 0, totalDeltaPence: 10_000, taxCode: "outside-scope" });
  assert.deepEqual(variationPricing(10_000, "junk" as never), { priceDeltaNetPence: 10_000, taxPence: 0, totalDeltaPence: 10_000 });
  const v = createIssue({
    id: "v1",
    projectId: "p1",
    number: 3,
    kind: "variation",
    title: "Condensate pump in the office",
    raisedBy: RAISER,
    raisedAt: AT,
    customerVisible: false,
    variation: { description: "The office wall has no fall to the outside: a pump is needed.", priceDeltaNetPence: 18_000, taxCode: "outside-scope" },
  });
  assert.equal(v.status, "awaiting-customer");
  assert.equal(v.variation?.taxCode, "outside-scope", "the code it was priced on is kept for its invoice");
  assert.equal(v.customerVisible, true, "a variation is always the customer's to see");
  assert.equal(v.variation?.status, "proposed");
  assert.equal(v.variation?.totalDeltaPence, 18_000);
  assert.equal(v.history[0]!.note, "Variation proposed.");
  assert.equal(isOpen(v), true);
});

test("a variation proposed on site waits for the office; sending it re-prices it and shows the customer", () => {
  const draft = createIssue({
    id: "v2",
    projectId: "p1",
    number: 4,
    kind: "variation",
    title: "2 m more trunking",
    raisedBy: RAISER,
    raisedAt: AT,
    variation: { description: "The run round the bay is longer than measured.", priceDeltaNetPence: 18_000, taxCode: "outside-scope", officeReview: true },
  });
  assert.equal(draft.variation?.status, "draft");
  assert.equal(draft.customerVisible, false, "the customer can't see an unchecked price");
  assert.equal(draft.status, "open");
  assert.equal(draft.ownerRole, "ops");
  assert.match(draft.nextAction ?? "", /Check the price and send it to the customer/);
  assert.match(draft.history[0]!.note, /office checks the price/);

  const sent = sendVariationToCustomer(draft, { description: "  2 m of trunking round the bay window.  ", priceDeltaNetPence: 12_000, taxCode: "standard-20" }, "DEMO Ada", "2026-11-10T12:00:00.000Z");
  assert.equal(draft.variation?.status, "draft", "pure");
  assert.equal(sent.variation?.status, "proposed");
  assert.equal(sent.status, "awaiting-customer");
  assert.equal(sent.customerVisible, true);
  assert.equal(sent.ownerRole, "customer");
  assert.equal(sent.variation?.description, "2 m of trunking round the bay window.");
  assert.deepEqual([sent.variation?.priceDeltaNetPence, sent.variation?.taxPence, sent.variation?.totalDeltaPence], [12_000, 2_400, 14_400]);
  assert.equal(sent.variation?.taxCode, "standard-20", "re-priced on the contract's code, and the code kept");
  assert.match(sent.history.at(-1)!.note, /sent to the customer at £120 before VAT \(estimated on site at £180\)/);

  assert.throws(() => sendVariationToCustomer(sent, { description: "Again", priceDeltaNetPence: 1, taxCode: "outside-scope" }, "Ada", AT), /already gone to the customer/);
  const withdrawn = transitionIssue(draft, "rejected", "Ada", "Not needed", AT);
  assert.throws(() => sendVariationToCustomer(withdrawn, { description: "Trunking", priceDeltaNetPence: 1, taxCode: "outside-scope" }, "Ada", AT), /withdrawn/);
  assert.throws(() => sendVariationToCustomer(draft, { description: " ", priceDeltaNetPence: 1, taxCode: "outside-scope" }, "Ada", AT), /Describe the change/);
});

test("transitionIssue: history appended, resolvedAt stamped once, reopening clears it, pure", () => {
  const start = issue();
  const working = transitionIssue(start, "in-progress", "DEMO Ada", "Booked a revisit", "2026-11-10T10:00:00.000Z");
  assert.equal(start.status, "open", "the original is untouched");
  assert.equal(start.history.length, 1);
  assert.equal(working.status, "in-progress");
  assert.equal(working.history.length, 2);
  assert.deepEqual(working.history[1], { at: "2026-11-10T10:00:00.000Z", by: "DEMO Ada", note: "Booked a revisit", status: "in-progress" });
  assert.equal(working.resolvedAt, undefined);

  const fixed = transitionIssue(working, "resolved", "DEMO Ivo", "Clip replaced", "2026-11-11T15:00:00.000Z");
  assert.equal(fixed.resolvedAt, "2026-11-11T15:00:00.000Z");
  assert.equal(fixed.resolution, "Clip replaced");
  assert.equal(isOpen(fixed), false);

  const closed = transitionIssue(fixed, "closed", "DEMO Ada", "", "2026-11-12T09:00:00.000Z");
  assert.equal(closed.resolvedAt, "2026-11-11T15:00:00.000Z", "closing keeps when it was fixed");
  assert.equal(closed.resolution, "Clip replaced");
  assert.equal(closed.history.at(-1)!.note, "Marked closed.");

  const reopened = transitionIssue(closed, "open", "DEMO customer", "It's loose again", "2026-11-20T09:00:00.000Z");
  assert.equal(reopened.resolvedAt, undefined);
  assert.equal(reopened.resolution, undefined);
  assert.equal(isOpen(reopened), true);
  assert.equal(reopened.history.length, 5);

  // Straight to closed stamps resolvedAt too.
  assert.equal(transitionIssue(start, "closed", "DEMO", "Duplicate", "2026-11-10T11:00:00.000Z").resolvedAt, "2026-11-10T11:00:00.000Z");
  // Rejected: not open, not resolved.
  const rejected = transitionIssue(start, "rejected", "DEMO", "Not ours: existing damage, photographed on day 1", "2026-11-10T11:00:00.000Z");
  assert.equal(isOpen(rejected), false);
  assert.equal(rejected.resolvedAt, undefined);
  assert.equal(rejected.resolution, "Not ours: existing damage, photographed on day 1");
  // A note without a status change is an update.
  const noted = transitionIssue(start, "open", "DEMO", "  ", "2026-11-10T11:00:00.000Z");
  assert.equal(noted.history.at(-1)!.note, "Update.");
  assert.throws(() => transitionIssue(start, "done" as never, "DEMO", "x", AT));
  assert.equal(Object.keys(ISSUE_STATUS_LABEL).length, 6);
});
