import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTALL_TEMPLATE_VERSION, jobTargets, openExceptions, runsheetFromDesign, type CatalogueItem, type DesignRecord, type InstallJobV2 } from "@aircon/domain";
import { withAnswers, withHeaderState } from "../components/field/answers.ts";
import type { FieldHeader, FieldHeaderState } from "../components/field/types.ts";

/**
 * A field screen shows a step's result from the server's answer, laid over
 * the page's data, and never goes backwards: a refresh that set off before
 * the step and lands after it can't undo it on screen; a newer one takes
 * over. (The handover flake: components/field/server-answer.ts.)
 */

const header = (over: Partial<FieldHeader> = {}): FieldHeader => ({
  projectId: "8a8a8a8a-1111-4111-8111-00000000f701",
  customerName: "DEMO Customer",
  address: "1 Demo Street",
  postcode: "SW16 9ZZ",
  mapsUrl: "https://maps.example/",
  dates: ["2026-11-10", "2026-11-11", "2026-11-12"],
  days: [],
  totalDays: 3,
  currentDay: 3,
  nextDay: null,
  crew: [],
  installStatus: "complete",
  handoverStatus: "commissioned",
  bookingStatus: "booked",
  kitLabel: "Kit checked",
  kitTone: "success",
  risks: [],
  onMyWay: { at: "2026-11-12T07:40:00.000Z", etaMinutes: 20, by: "DEMO Ian" },
  electricalCert: "pending",
  today: "2026-11-12",
  version: 40,
  ...over,
});

const answer = (over: Partial<FieldHeaderState> = {}): FieldHeaderState => ({
  version: 41,
  days: [],
  totalDays: 3,
  currentDay: 3,
  nextDay: null,
  installStatus: "complete",
  handoverStatus: "commissioned",
  bookingStatus: "booked",
  packDocumentId: "8a8a8a8a-2222-4222-8222-00000000f702",
  electricalCert: "pending",
  ...over,
});

test("the pack's published from the answer at once, whatever the page's data still says", () => {
  const page = header();
  const shown = withHeaderState(page, answer());
  assert.equal(shown.packDocumentId, "8a8a8a8a-2222-4222-8222-00000000f702", "the sign-off opens from the answer");
  assert.equal(shown.customerName, page.customerName, "the rest of the header is the page's");
  assert.equal(shown.onMyWay, undefined, "the answer's optional parts replace the page's (it had none)");
});

test("a refresh that set off before the step lands after it: the screen doesn't go back", () => {
  const stale = header({ version: 40 });
  assert.equal(withHeaderState(stale, answer({ version: 41 })).packDocumentId, "8a8a8a8a-2222-4222-8222-00000000f702");
});

test("a refresh with the step in it (or anything newer) takes over from the answer", () => {
  const same = header({ version: 41, packDocumentId: "8a8a8a8a-2222-4222-8222-00000000f702" });
  assert.equal(withHeaderState(same, answer({ version: 41 })), same, "as new as the answer: the page's own data");
  const newer = header({ version: 43, handoverStatus: "handed-over", signoff: { at: "2026-11-12T15:00:00.000Z", name: "Pat Example", outcome: "all-good", snagCount: 0 } });
  assert.equal(withHeaderState(newer, answer({ version: 41 })), newer);
  assert.equal(withHeaderState(header(), undefined).version, 40, "no answer: the page");
});

test("a signed handover from the answer: handed over, with the sign-off on record", () => {
  const signoff = { at: "2026-11-12T15:00:00.000Z", name: "Pat Example", outcome: "all-good" as const, snagCount: 0 };
  const shown = withHeaderState(header(), answer({ version: 42, handoverStatus: "handed-over", signoff }));
  assert.equal(shown.handoverStatus, "handed-over");
  assert.deepEqual(shown.signoff, signoff);
});

/* ---------------- commissioning: targets, reviews, the signature ---------------- */

const CATALOGUE: CatalogueItem[] = [
  { id: "in", kind: "indoor", label: "DEMO indoor", model: "DEMO-IN", manufacturer: "Daikin", specs: { liquidPipeMm: 6.35, gasPipeMm: 9.52 }, costPence: null, status: "available", confidence: "provisional", sources: [], active: true },
  { id: "out", kind: "outdoor", label: "DEMO outdoor", model: "DEMO-OUT", specs: { prechargedPipeM: 10, additionalChargeGPerM: 20 }, costPence: null, status: "available", confidence: "provisional", sources: [], active: true },
];
const DESIGN = {
  id: "8a8a8a8a-3333-4333-8333-00000000f703",
  projectId: "8a8a8a8a-1111-4111-8111-00000000f701",
  version: 1,
  status: "approved",
  rooms: [{ roomId: "r1", roomName: "Main bedroom", floor: "first", preliminaryLoadW: 2000, suggestedKw: 2.5, chosenKw: 2.5, pipeRunM: 6, heightDiffM: 3, condensate: "gravity", layoutMediaIds: [] }],
  variants: [
    {
      id: "v",
      label: "Standard",
      tier: "standard",
      systems: [{ id: "s", topology: "single", outdoorItemId: "out", roomIds: ["r1"], compatibility: { ok: true, errors: [], warnings: [] }, electrical: { breaker: "16 A", cableMm2: 2.5, isolator: "Isolator" }, refrigerant: { totalPipeM: 6, prechargedPipeM: 10, additionalChargeG: 0 } }],
      roomUnits: [{ roomId: "r1", indoorItemId: "in" }],
      bom: [],
      rules: [],
      verdict: "auto-approved",
      installDays: 3,
    },
  ],
  overrides: [],
  createdAt: "2026-11-01T09:00:00.000Z",
} as DesignRecord;

const job = (): InstallJobV2 => ({
  id: "8a8a8a8a-4444-4444-8444-00000000f704",
  customer: "DEMO Customer",
  postcode: "SW16 9ZZ",
  engineer: "DEMO Ian",
  scheduledOn: "2026-11-10",
  projectId: DESIGN.projectId,
  designId: DESIGN.id,
  templateVersion: INSTALL_TEMPLATE_VERSION,
  runsheet: runsheetFromDesign(DESIGN, "v", CATALOGUE),
  evidence: [],
  stepStatuses: [],
  exceptionReviews: [],
  qa: { status: "in-progress" },
});

test("a target the tech lead set shows at once; the page's newer setting of it wins once it lands", () => {
  const page = job();
  const key = "pressure.test" as const;
  assert.notEqual(jobTargets(page.runsheet).find((t) => t.key === key)?.basis, "tech-lead");
  const set = { input: { key, min: 2, max: 41.5 }, by: "DEMO Tess", at: "2026-11-12T14:00:00.000Z" };
  const shown = withAnswers(page, { targets: [set], reviews: [], signed: null });
  const t = jobTargets(shown.runsheet).find((x) => x.key === key)!;
  assert.deepEqual([t.basis, t.min, t.max, t.setBy], ["tech-lead", 2, 41.5, "DEMO Tess"]);
  // A refresh lands with a later setting by someone else: the page's wins, the answer steps aside.
  const later = withAnswers(page, { targets: [{ ...set, input: { key, min: 3, max: 40 }, at: "2026-11-12T14:05:00.000Z" }], reviews: [], signed: null });
  const relaid = withAnswers(later, { targets: [set], reviews: [], signed: null });
  assert.equal(jobTargets(relaid.runsheet).find((x) => x.key === key)!.min, 3);
});

test("a review and the signature show at once, once each", () => {
  const page = job();
  const review = { specId: "spec-x", resolution: "accepted" as const, reason: "DEMO: within the manual", by: "DEMO Tess", byStaffId: "t", at: "2026-11-12T14:10:00.000Z" };
  const shown = withAnswers(page, { targets: [], reviews: [review], signed: null });
  assert.equal(shown.exceptionReviews.length, 1);
  const landed = withAnswers({ ...page, exceptionReviews: [review] }, { targets: [], reviews: [review], signed: null });
  assert.equal(landed.exceptionReviews.length, 1, "not twice once the page has it");
  assert.deepEqual(openExceptions(shown), openExceptions(page).filter((x) => x.slot.spec.id !== review.specId));
  const record = { signedBy: { staffId: "t", name: "DEMO Tess", qualificationRef: "DEMO-F" }, at: "2026-11-12T15:00:00.000Z", results: [] };
  const signed = withAnswers(page, { targets: [], reviews: [], signed: { record, certificate: { id: "c", ref: "DIH-CC-1" } } });
  assert.equal(signed.commissioning?.at, record.at, "signed off on screen from the answer");
});
