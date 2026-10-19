import { test } from "node:test";
import assert from "node:assert/strict";
import { editDraft, followDefaults, openDraft } from "../components/field/end-day-draft.ts";

const first = { summary: "Done today: on site and introduced.", message: "Today we did: on site and introduced. Tomorrow: indoor unit." };
const synced = { summary: "Done today: on site and introduced, protection down.", message: "Today we did: on site and introduced, protection down. Tomorrow: indoor unit." };

test("end of day: a sync never replaces what the installer typed", () => {
  let d = openDraft(first);
  assert.deepEqual([d.summary, d.message], [first.summary, first.message]);
  d = editDraft(d, "summary", "MY OWN SUMMARY: drilled 2 of 3 cores");
  d = editDraft(d, "message", "MY OWN MESSAGE to the customer");
  // The outbox syncs a photo (new items, acks, a router refresh): new defaults, again and again.
  for (let i = 0; i < 3; i++) d = followDefaults(d, synced, true);
  assert.equal(d.summary, "MY OWN SUMMARY: drilled 2 of 3 cores");
  assert.equal(d.message, "MY OWN MESSAGE to the customer");
});

test("end of day: untouched fields follow the runsheet only on the first screen; nothing moves after the preview", () => {
  let d = openDraft(first);
  d = editDraft(d, "summary", "Mine");
  d = followDefaults(d, synced, true);
  assert.equal(d.summary, "Mine");
  assert.equal(d.message, synced.message, "the untouched customer update picks up the step that just synced");
  // On the photos screen (the preview), a sync changes nothing: what's sent is what was previewed.
  const later = { summary: "x", message: "a different default" };
  const frozen = followDefaults(d, later, false);
  assert.equal(frozen, d);
  assert.equal(frozen.message, synced.message);
  // Clearing the message on purpose (close the day without emailing) is an edit too.
  const cleared = followDefaults(editDraft(d, "message", ""), later, true);
  assert.equal(cleared.message, "");
});
