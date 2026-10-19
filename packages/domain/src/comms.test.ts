import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMS_EVENTS, FOLLOW_UP_EVENTS, idempotencyKey, type CommsEventId } from "./comms.ts";

const ALL: CommsEventId[] = [
  "magic-link",
  "survey-booked",
  "survey-reminder",
  "surveyor-on-my-way",
  "survey-complete",
  "proposal-issued",
  "proposal-reminder",
  "proposal-accepted",
  "proposal-changes-requested",
  "invoice-issued",
  "payment-received",
  "install-booked",
  "kit-update",
  "install-prep",
  "install-day-before",
  "installer-on-my-way",
  "install-day-update",
  "variation-approval",
  "variation-accepted",
  "cancellation-confirmed",
  "issue-update",
  "handover-ready",
  "certificate-issued",
  "check-in-7d",
  "feedback-30d",
  "review-request",
  "seasonal-check",
  "service-reminder",
  "team-alert",
];

test("every event is registered, keyed by its own id, with a channel and a description", () => {
  assert.deepEqual(Object.keys(COMMS_EVENTS).sort(), [...ALL].sort());
  for (const id of ALL) {
    const def = COMMS_EVENTS[id];
    assert.equal(def.id, id);
    assert.ok(def.channels.length > 0, id);
    assert.ok(def.description.length > 10, id);
    assert.ok(Number.isInteger(def.templateVersion) && def.templateVersion >= 1, id);
  }
});

test("on-my-way messages are SMS; team events go to the team; cron events are the scheduled ones", () => {
  assert.deepEqual(COMMS_EVENTS["surveyor-on-my-way"].channels, ["sms"]);
  assert.deepEqual(COMMS_EVENTS["installer-on-my-way"].channels, ["sms"]);
  assert.equal(COMMS_EVENTS["team-alert"].audience, "team");
  assert.equal(COMMS_EVENTS["proposal-changes-requested"].audience, "team");
  assert.ok(COMMS_EVENTS["proposal-accepted"].channels.includes("email")); // the durable copy
  const cron = ALL.filter((id) => COMMS_EVENTS[id].trigger === "cron").sort();
  assert.deepEqual(cron, [
    "check-in-7d",
    "feedback-30d",
    "install-day-before",
    "install-prep",
    "proposal-reminder",
    "review-request",
    "seasonal-check",
    "service-reminder",
    "survey-reminder",
  ]);
  assert.equal(COMMS_EVENTS["issue-update"].trigger, "manual");
  assert.equal(COMMS_EVENTS["certificate-issued"].trigger, "auto");
  assert.equal(COMMS_EVENTS["certificate-issued"].audience, "customer");
});

test("follow-ups are customer emails with an opt-out; the review request is never tied to the score", () => {
  assert.deepEqual([...FOLLOW_UP_EVENTS].sort(), ["check-in-7d", "feedback-30d", "review-request", "seasonal-check", "service-reminder"]);
  for (const id of FOLLOW_UP_EVENTS) {
    assert.equal(COMMS_EVENTS[id].audience, "customer", id);
    assert.equal(COMMS_EVENTS[id].trigger, "cron", id);
    assert.deepEqual(COMMS_EVENTS[id].channels, ["email"], id);
    assert.match(COMMS_EVENTS[id].description, /Opt-out line/, id);
  }
  assert.doesNotMatch(COMMS_EVENTS["feedback-30d"].description, /only if they're happy/);
  assert.match(COMMS_EVENTS["feedback-30d"].description, /everyone/);
  assert.match(COMMS_EVENTS["feedback-30d"].description, /never tied to the review request/);
  assert.match(COMMS_EVENTS["review-request"].description, /no incentive/);
  assert.match(COMMS_EVENTS["review-request"].description, /never depends on the feedback score/);
  for (const id of ALL) {
    if (!FOLLOW_UP_EVENTS.has(id)) assert.doesNotMatch(COMMS_EVENTS[id].description, /Opt-out line/, id);
  }
});

test("idempotency keys are deterministic and distinct per event, project, occurrence and channel", () => {
  const k = idempotencyKey("survey-booked", "p-1", "2026-11-03T10:00:00.000Z", "email");
  assert.equal(k, idempotencyKey("survey-booked", "p-1", "2026-11-03T10:00:00.000Z", "email"));
  assert.equal(k, "survey-booked:p-1:2026-11-03T10:00:00.000Z:email");
  const variants = [
    idempotencyKey("survey-reminder", "p-1", "2026-11-03T10:00:00.000Z", "email"),
    idempotencyKey("survey-booked", "p-2", "2026-11-03T10:00:00.000Z", "email"),
    idempotencyKey("survey-booked", "p-1", "2026-11-04T10:00:00.000Z", "email"),
    idempotencyKey("survey-booked", "p-1", "2026-11-03T10:00:00.000Z", "sms"),
  ];
  for (const v of variants) assert.notEqual(v, k);
  assert.equal(new Set(variants).size, variants.length);
});

test("idempotency keys work without a project", () => {
  assert.equal(idempotencyKey("magic-link", null, "token-hash-abc", "email"), "magic-link:-:token-hash-abc:email");
  assert.equal(idempotencyKey("team-alert", null, "  ", "email"), "team-alert:-:-:email");
});
