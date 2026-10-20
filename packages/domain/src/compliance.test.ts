import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPLIANCE_GATE_GROUPS,
  COMPLIANCE_TEMPLATE,
  addComplianceEvidence,
  asbestosSuspectedAtSurvey,
  companyFgasCertProblem,
  complianceProgress,
  complianceTemplateFor,
  instantiateCompliance,
  listedOnRecord,
  planningConsentForGate,
  reviewCompliance,
  syncCompliance,
  type ComplianceItem,
} from "./compliance.ts";
import { GATE_IDS, blockersFor, createProject, type Project, type ReadinessContext } from "./project.ts";
import { generateQuote } from "./pricing.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import type { DesignRecord } from "./design-record.ts";
import type { StaffMember, StaffRole } from "./staff.ts";
import type { Survey } from "./types.ts";

const NOW = "2026-10-18T10:00:00.000Z";

function person(roles: StaffRole[], over: Partial<StaffMember> = {}): StaffMember {
  return {
    id: `s-${roles.join("-")}`,
    email: "demo@example.test",
    name: `DEMO ${roles.join("/")}`,
    roles,
    external: false,
    active: true,
    qualifications: [],
    demo: true,
    ...over,
  };
}

const TECH = person(["tech-lead"]);
const ADMIN = person(["admin"]);
const SURVEYOR = person(["surveyor"]);
const INSTALLER = person(["installer"]);

let n = 0;
const makeId = () => `c-${++n}`;
const checklist = () => instantiateCompliance("p-1", makeId);
const item = (key: string, over: Partial<ComplianceItem> = {}): ComplianceItem => ({ ...checklist().find((i) => i.key === key)!, ...over });

const CONTRACT_KEYS = [
  "ownership-authority",
  "planning-pd",
  "designations",
  "noise-assessment",
  "planning-consent",
  "outdoor-siting",
  "structural-fixings",
  "asbestos",
  "concealed-services",
  "electrical-scope",
  "supply-and-dno",
  "heat-pump-building-regs",
  "fgas-company",
  "fgas-engineer",
  "manufacturer-requirements",
  "working-at-height",
  "rams",
  "equipment-compatibility",
  "design-approval",
  "commissioning-approval",
  "electrical-certificate",
  "commissioning-notice",
  "heat-pump-compliance-certificate",
  "warranty-registration",
  "cancellation-and-consent",
];

test("the template has every contract key once, with guidance and evidence hints", () => {
  assert.deepEqual([...COMPLIANCE_TEMPLATE.map((t) => t.key)].sort(), [...CONTRACT_KEYS].sort());
  assert.equal(new Set(COMPLIANCE_TEMPLATE.map((t) => t.key)).size, COMPLIANCE_TEMPLATE.length);
  for (const t of COMPLIANCE_TEMPLATE) {
    assert.ok(t.label.length > 5, t.key);
    assert.ok(t.guidance.length > 40, `${t.key} guidance`);
    assert.ok(t.evidenceHint.length > 10, `${t.key} evidence hint`);
    assert.ok(GATE_IDS.includes(t.gate), `${t.key} gate`);
    assert.ok(COMPLIANCE_GATE_GROUPS.some((g) => g.gate === t.gate), `${t.key} has a display group`);
  }
});

test("statutory flags: planning, asbestos, electrical, F-gas, height and RAMS are statutory", () => {
  const statutory = (k: string) => complianceTemplateFor(k)!.statutory;
  for (const k of ["planning-pd", "designations", "noise-assessment", "asbestos", "electrical-scope", "electrical-certificate", "fgas-company", "fgas-engineer", "working-at-height", "rams", "cancellation-and-consent"]) {
    assert.equal(statutory(k), true, k);
  }
  for (const k of ["ownership-authority", "manufacturer-requirements", "equipment-compatibility", "design-approval", "warranty-registration", "concealed-services"]) {
    assert.equal(statutory(k), false, k);
  }
});

test("auto items are exactly design approval, commissioning and warranty", () => {
  const auto = Object.fromEntries(COMPLIANCE_TEMPLATE.filter((t) => t.auto).map((t) => [t.key, t.auto]));
  assert.deepEqual(auto, {
    "design-approval": "design-approved",
    "commissioning-approval": "commissioning-signed",
    "warranty-registration": "warranty-registered",
  });
});

test("instantiateCompliance makes one item per key, with fresh ids, planning waiting for evidence", () => {
  const items = checklist();
  assert.equal(items.length, COMPLIANCE_TEMPLATE.length);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.ok(items.every((i) => i.projectId === "p-1" && i.mediaIds.length === 0));
  assert.equal(items.find((i) => i.key === "planning-pd")!.status, "evidence-required");
  assert.equal(items.find((i) => i.key === "asbestos")!.status, "not-started");
});

test("a statutory item needs a reviewer and evidence or a note to approve", () => {
  const asbestos = item("asbestos");
  const noReviewer = reviewCompliance(asbestos, "approved", SURVEYOR, "Checked", undefined, NOW);
  assert.equal(noReviewer.ok, false, "surveyors don't hold compliance.review");

  const bare = reviewCompliance(asbestos, "approved", TECH, undefined, undefined, NOW);
  assert.equal(bare.ok, false, "no evidence, no note");

  const withNote = reviewCompliance(asbestos, "approved", TECH, "1930s semi: no textured ceilings; board is modern. DEMO.", undefined, NOW);
  assert.ok(withNote.ok);
  if (withNote.ok) {
    assert.equal(withNote.item.status, "approved");
    assert.equal(withNote.item.reviewedBy, TECH.name);
    assert.equal(withNote.item.reviewedByStaffId, TECH.id);
    assert.equal(withNote.item.reviewedAt, NOW);
    assert.equal(withNote.item.history?.at(-1)?.to, "approved");
  }

  const withEvidence = reviewCompliance({ ...asbestos, mediaIds: ["m-1"] }, "approved", TECH, undefined, undefined, NOW);
  assert.ok(withEvidence.ok);
});

test("statutory items have no override path to approved", () => {
  const rams = item("rams");
  const r = reviewCompliance(rams, "approved", ADMIN, undefined, "We always do this", NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /can't be overridden/);
  // Even with evidence, an override reason on a statutory item is refused rather than silently stored.
  assert.equal(reviewCompliance({ ...rams, mediaIds: ["m-1"] }, "approved", ADMIN, undefined, "x", NOW).ok, false);
});

test("non-statutory items: approve with evidence, or an admin override with a reason", () => {
  const siting = item("outdoor-siting");
  assert.equal(reviewCompliance(siting, "approved", TECH, undefined, undefined, NOW).ok, false);
  assert.equal(reviewCompliance(siting, "approved", TECH, undefined, "Seen it", NOW).ok, false, "tech leads can't override");
  const ok = reviewCompliance(siting, "approved", ADMIN, undefined, "Same position as the survey photo", NOW);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.item.overrideReason, "Same position as the survey photo");
    assert.equal(ok.item.history?.at(-1)?.overrideReason, "Same position as the survey photo");
  }
});

test("planning is never approved without the written outcome", () => {
  const pd = item("planning-pd", { mediaIds: ["calc-pdf"] });
  const evidenceOnly = reviewCompliance(pd, "approved", TECH, undefined, undefined, NOW, { planningOutcome: "pd" });
  assert.equal(evidenceOnly.ok, false);
  assert.equal(reviewCompliance(pd, "not-applicable", TECH, "No planning needed", undefined, NOW).ok, false, "never 'not applicable'");
  const noChoice = reviewCompliance(pd, "approved", TECH, "PD checks passed: technical lead confirms. DEMO.", undefined, NOW);
  assert.ok(!noChoice.ok && /Choose the outcome/.test(noChoice.error), "the note alone can't say which way it went");
  const ok = reviewCompliance(pd, "approved", TECH, "PD checks passed: technical lead confirms. DEMO.", undefined, NOW, { planningOutcome: "pd" });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.item.planningOutcome, "pd");
});

test("not applicable needs a reason, and only where it can be true", () => {
  const height = item("working-at-height");
  assert.equal(reviewCompliance(height, "not-applicable", TECH, "", undefined, NOW).ok, false);
  assert.ok(reviewCompliance(height, "not-applicable", TECH, "Ground-level unit, drilled from inside", undefined, NOW).ok);
  for (const k of ["fgas-engineer", "rams", "electrical-scope", "designations", "cancellation-and-consent"]) {
    assert.equal(reviewCompliance(item(k), "not-applicable", TECH, "Not needed", undefined, NOW).ok, false, k);
  }
});

test("rejecting needs a reviewer and a reason", () => {
  const scope = item("electrical-scope");
  assert.equal(reviewCompliance(scope, "rejected", INSTALLER, "No", undefined, NOW).ok, false);
  assert.equal(reviewCompliance(scope, "rejected", TECH, undefined, undefined, NOW).ok, false);
  const r = reviewCompliance(scope, "rejected", TECH, "Board full: needs a new consumer unit", undefined, NOW);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.item.note, "Board full: needs a new consumer unit");
});

test("auto items can't be approved by hand", () => {
  const r = reviewCompliance(item("design-approval"), "approved", ADMIN, "Looks fine", undefined, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /updates itself/);
});

test("reopening a settled item needs a reviewer and a reason", () => {
  const approved = item("asbestos", { status: "approved", reviewedBy: TECH.name, reviewedAt: NOW });
  assert.equal(reviewCompliance(approved, "under-review", INSTALLER, "Hmm", undefined, NOW).ok, false);
  assert.equal(reviewCompliance(approved, "under-review", TECH, "", undefined, NOW).ok, false);
  const r = reviewCompliance(approved, "under-review", TECH, "Found textured ceiling in the hall", undefined, NOW);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.item.reviewedBy, undefined, "no longer reviewed");
});

test("evidence moves a waiting item to review and keeps a history", () => {
  const r = addComplianceEvidence(item("rams"), { mediaIds: ["rams-pdf", "rams-pdf"], note: "RAMS v1" }, { name: TECH.name, staffId: TECH.id }, NOW);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.item.status, "under-review");
    assert.deepEqual(r.item.mediaIds, ["rams-pdf"]);
    assert.deepEqual(r.item.history?.at(-1)?.mediaIds, ["rams-pdf"]);
  }
  assert.equal(addComplianceEvidence(item("rams"), {}, { name: "x" }, NOW).ok, false);
});

test("a written note of what was checked counts as evidence; a rejection reason doesn't", () => {
  const noted = addComplianceEvidence(item("asbestos"), { note: "DEMO: no textured ceilings; nothing suspected." }, { name: TECH.name }, NOW);
  assert.ok(noted.ok);
  if (!noted.ok) return;
  assert.equal(noted.item.evidenceNote, "DEMO: no textured ceilings; nothing suspected.");
  // The reviewer can approve it as it stands.
  assert.equal(reviewCompliance(noted.item, "approved", TECH, undefined, undefined, NOW).ok, true);
  // A rejection's reason isn't evidence: approving after it still needs some.
  const rejected = reviewCompliance(item("asbestos"), "rejected", TECH, "DEMO: survey photos missing", undefined, NOW);
  assert.ok(rejected.ok);
  if (rejected.ok) assert.equal(reviewCompliance(rejected.item, "approved", TECH, undefined, undefined, NOW).ok, false);
});

/* ---------------- sync with the project ---------------- */

const SURVEY: Survey = {
  postcode: "SW16 9ZZ",
  addressLine: "1 Demo Street",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [{ id: "r1", name: "Bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] }],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

function project(over: (p: Project) => void = () => {}): Project {
  const p = createProject({ id: "p-1", quoteId: "q-1", createdAt: NOW, customerName: "DEMO Customer", survey: SURVEY, quote: generateQuote(SURVEY) });
  over(p);
  return p;
}

test("sync approves the auto items from the project's records, and reopens them", () => {
  const items = checklist();
  const p = project((x) => {
    x.design = { status: "approved", designId: "d", version: 2, approvedAt: NOW, approvedBy: "DEMO Tess" };
    x.handover.warrantyRegistered = true;
    x.events.push({ at: NOW, type: "warranty-registered", label: "Warranty registered.", actor: "ops", actorName: "DEMO Ada" });
  });
  const changed = syncCompliance(items, p, NOW);
  const byKey = Object.fromEntries(changed.map((c) => [c.key, c]));
  assert.equal(byKey["design-approval"]?.status, "approved");
  assert.equal(byKey["design-approval"]?.reviewedBy, "DEMO Tess");
  assert.equal(byKey["warranty-registration"]?.status, "approved");
  assert.equal(byKey["warranty-registration"]?.reviewedBy, "DEMO Ada", "approved by the person who recorded it, not a phrase");
  assert.equal(byKey["commissioning-approval"], undefined, "not commissioned yet");

  // Idempotent: nothing more to change.
  const merged = items.map((i) => changed.find((c) => c.id === i.id) ?? i);
  assert.deepEqual(syncCompliance(merged, p, NOW), []);

  // A new draft design takes the approval away.
  const redraft = project((x) => (x.design = { status: "draft", designId: "d", version: 3 }));
  const reopened = syncCompliance(merged, redraft, NOW).find((c) => c.key === "design-approval");
  assert.equal(reopened?.status, "under-review");
});

test("equipment combination verified follows the approved design: compatibility clean, provisional rules confirmed", () => {
  const p = project((x) => (x.design = { status: "approved", designId: "d", version: 2, approvedAt: NOW, approvedBy: "DEMO Tess" }));
  const system = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    topology: "multi",
    outdoorItemId: "o",
    roomIds: ["r1", "r2"],
    compatibility: { ok: true, errors: [], warnings: [] },
    electrical: { breaker: "16 A", cableMm2: 2.5, isolator: "20 A" },
    refrigerant: { totalPipeM: 10, prechargedPipeM: 15, additionalChargeG: 0 },
    ruleConfidence: "verified",
    ...over,
  });
  const design = (systems: unknown[], extra: Partial<DesignRecord> = {}) =>
    ({
      id: "d",
      projectId: "p-1",
      version: 2,
      status: "approved",
      rooms: [],
      variants: [{ id: "v-std", label: "Standard", systems }],
      overrides: [],
      approval: { staffId: "t", name: "DEMO Tess", qualificationRef: "DEMO-FG", at: NOW },
      createdAt: NOW,
      ...extra,
    }) as unknown as DesignRecord;

  const compat = (d: DesignRecord | null, items = checklist()) => syncCompliance(items, p, NOW, d).find((c) => c.key === "equipment-compatibility");
  assert.equal(compat(design([system()]))?.status, "approved");
  assert.equal(compat(design([system()]))?.reviewedBy, "DEMO Tess");
  assert.equal(compat(design([system({ compatibility: { ok: false, errors: ["Too much pipe"], warnings: [] } })])), undefined, "an error leaves it for review");
  assert.equal(compat(design([system({ ruleConfidence: "provisional" })])), undefined, "a provisional rule nobody confirmed");
  assert.equal(
    compat(design([system({ ruleConfidence: "provisional" })], { acknowledgements: { combinationTable: { by: "DEMO Tess", at: NOW } } }))?.status,
    "approved",
    "confirmed against the combination table at approval",
  );
  assert.equal(compat(design([system({ topology: "single", ruleConfidence: undefined })]))?.status, "approved", "a matched single split needs no rule");
  assert.equal(syncCompliance(checklist(), p, NOW).find((c) => c.key === "equipment-compatibility"), undefined, "no design given: untouched");

  // Approved from the design, then the design is no longer approved: reopened; a hand approval is left alone.
  const approved = checklist().map((i) => (i.key === "equipment-compatibility" ? compat(design([system()]))! : i));
  assert.equal(compat(null, approved)?.status, "under-review");
  const byHand = checklist().map((i) => (i.key === "equipment-compatibility" ? { ...i, status: "approved" as const, history: [] } : i));
  assert.equal(compat(null, byHand), undefined);
});

test("sync moves planning to review after the survey, and never approves it", () => {
  const p = project((x) => {
    x.survey.status = "submitted";
    x.survey.submittedAt = NOW;
  });
  const changed = syncCompliance(checklist(), p, NOW);
  const pd = changed.find((c) => c.key === "planning-pd");
  assert.equal(pd?.status, "under-review");
  assert.ok(changed.every((c) => c.key !== "planning-pd" || c.status !== "approved"));
});

test("readiness blocks day 1 on open statutory items and only warns on the rest", () => {
  const items = checklist().map((i) => (i.key === "asbestos" || i.key === "outdoor-siting" ? i : { ...i, status: "approved" as const }));
  const ctx: ReadinessContext = {
    today: "2026-10-18",
    settings: DEFAULT_SETTINGS,
    compliance: items.map((i) => ({ key: i.key, label: i.label, status: i.status, statutory: i.statutory, gate: i.gate })),
    crew: [],
    openIssues: [],
  };
  const b = blockersFor(project(), ctx, "ready-to-install");
  assert.equal(b.find((x) => x.code === "compliance:asbestos")?.severity, "block");
  assert.equal(b.find((x) => x.code === "compliance:outdoor-siting")?.severity, "warn");
});

/* ---------------- planning consent (round 9) ---------------- */

const gateCtx = (items: ComplianceItem[]): ReadinessContext => ({
  today: "2026-10-18",
  settings: DEFAULT_SETTINGS,
  compliance: items.map((i) => ({ key: i.key, label: i.label, status: i.status, statutory: i.statutory, gate: i.gate })),
  crew: [],
  openIssues: [],
});
/** Every item settled except the planning ones, which the test drives. */
const allSettledBut = (keys: string[]) => checklist().map((i) => (keys.includes(i.key) ? i : { ...i, status: "approved" as const }));
const LISTED_SURVEY = { pd: { "not-listed": "no" as const } };
const planningBlocks = (items: ComplianceItem[]) => blockersFor(project(), gateCtx(items), "ready-to-install").filter((b) => /planning/.test(b.code));

test("the review's repro: 'planning route needed' on a listed house no longer clears day 1", () => {
  const pd = item("planning-pd", { status: "under-review" });
  // The approval now records the outcome as a choice, not just a note.
  const r = reviewCompliance(pd, "approved", TECH, "Planning route needed: Grade II listed, listed building consent required", undefined, NOW, {
    planningOutcome: "consent-needed",
    listed: true,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.item.planningOutcome, "consent-needed");
  // "PD checks passed" can't be recorded on a listed building.
  const passed = reviewCompliance(pd, "approved", TECH, "PD checks passed", undefined, NOW, { planningOutcome: "pd", listed: true });
  assert.ok(!passed.ok && /listed building, or anything in its curtilage, has no permitted development rights/.test(passed.error));

  // Every other item approved, the designations check approved by its map screenshot as before.
  let items = allSettledBut(["planning-pd", "planning-consent", "designations"]).map((i) =>
    i.key === "planning-pd" ? r.item : i.key === "designations" ? { ...i, status: "approved" as const, mediaIds: ["map"], listedBuilding: "yes" as const } : i,
  );
  const synced = new Map(syncCompliance(items, project(), NOW, undefined, { listing: LISTED_SURVEY }).map((c) => [c.key, c]));
  const consent = synced.get("planning-consent");
  assert.equal(consent?.status, "evidence-required");
  assert.match(consent?.note ?? "", /Needed: a listed building is on record/);
  items = items.map((i) => synced.get(i.key) ?? i);
  const blocks = planningBlocks(items);
  assert.equal(blocks.length, 1, "one clear block");
  assert.equal(blocks[0]!.severity, "block");
  assert.match(blocks[0]!.message, /No drilling until the council has granted planning permission or listed building consent: attach the decision notice/);

  // The consent item can't be marked not applicable, and approves only on the decision notice plus its reference.
  const c = items.find((i) => i.key === "planning-consent")!;
  assert.equal(reviewCompliance(c, "not-applicable", ADMIN, "Not needed", undefined, NOW).ok, false);
  const noteOnly = reviewCompliance(c, "approved", ADMIN, "2026/1234/L granted 3 Nov 2026", undefined, NOW);
  assert.ok(!noteOnly.ok && /decision notice/.test(noteOnly.error));
  assert.equal(reviewCompliance({ ...c, mediaIds: ["notice-pdf"] }, "approved", ADMIN, undefined, undefined, NOW).ok, false, "the file alone isn't enough");
  const granted = reviewCompliance({ ...c, mediaIds: ["notice-pdf"] }, "approved", ADMIN, "2026/1234/L granted 3 Nov 2026; no conditions on the condenser", undefined, NOW);
  assert.ok(granted.ok);
  if (granted.ok) items = items.map((i) => (i.key === "planning-consent" ? granted.item : i));
  assert.deepEqual(planningBlocks(items), [], "granted: day 1 can go ahead");
  // A later sync leaves a person's approval alone.
  assert.equal(syncCompliance(items, project(), NOW, undefined, { listing: LISTED_SURVEY }).find((x) => x.key === "planning-consent"), undefined);
});

test("planning consent: 'consent needed' on an unlisted house holds day 1 too; 'PD checks passed' settles it by itself", () => {
  const base = allSettledBut(["planning-pd", "planning-consent"]);
  const needed = base.map((i) => (i.key === "planning-pd" ? { ...i, status: "approved" as const, planningOutcome: "consent-needed" as const, reviewedBy: "DEMO Tess", reviewedAt: NOW } : i));
  const n = syncCompliance(needed, project(), NOW).find((c) => c.key === "planning-consent");
  assert.equal(n?.status, "evidence-required");
  assert.match(n?.note ?? "", /DEMO Tess recorded "planning permission or listed building consent needed"/);

  const pd = base.map((i) => (i.key === "planning-pd" ? { ...i, status: "approved" as const, planningOutcome: "pd" as const, reviewedBy: "DEMO Tess", reviewedAt: NOW } : i));
  const na = syncCompliance(pd, project(), NOW).find((c) => c.key === "planning-consent");
  assert.equal(na?.status, "not-applicable");
  assert.match(na?.note ?? "", /^Not needed: DEMO Tess recorded "PD checks passed" on 18 Oct 2026, and no listed building is on record\./);
  const settled = pd.map((i) => (i.key === "planning-consent" ? na! : i));
  assert.deepEqual(planningBlocks(settled), []);

  // The outcome reopened: the consent item goes back to waiting, and the open planning item is the one line.
  const reopened = settled.map((i) => (i.key === "planning-pd" ? { ...i, status: "under-review" as const, planningOutcome: undefined } : i));
  const back = syncCompliance(reopened, project(), NOW).find((c) => c.key === "planning-consent");
  assert.equal(back?.status, "not-started");
  const after = reopened.map((i) => (i.key === "planning-consent" ? back! : i));
  assert.deepEqual(planningBlocks(after).map((b) => b.code), ["compliance:planning-pd"]);

  // A listed building on record overrides "PD checks passed" (for example, the property record flags it).
  const flagged = syncCompliance(pd, project(), NOW, undefined, { listing: { intelListed: true } }).find((c) => c.key === "planning-consent");
  assert.equal(flagged?.status, "evidence-required");
});

test("listing on record: the designations check's answer decides once approved, else the survey or the property record", () => {
  const des = (over: Partial<ComplianceItem>) => [item("designations", over)];
  assert.equal(listedOnRecord(des({}), {}), false);
  assert.equal(listedOnRecord(des({}), { pd: { "not-listed": "no" } }), true);
  assert.equal(listedOnRecord(des({}), { pd: { "not-listed": "unsure" } }), false, "unsure isn't a listing (the designations check settles it)");
  assert.equal(listedOnRecord(des({}), { intelListed: true }), true);
  assert.equal(listedOnRecord(des({ status: "approved", listedBuilding: "no" }), { pd: { "not-listed": "no" } }), false, "the heritage list check corrects the survey");
  assert.equal(listedOnRecord(des({ status: "approved", listedBuilding: "yes" }), {}), true);
  // The designations check asks the question to approve, and keeps the answer only while approved.
  const d = item("designations", { mediaIds: ["map"] });
  assert.ok(!reviewCompliance(d, "approved", SURVEYOR, "Checked the map", undefined, NOW).ok);
  const ok = reviewCompliance(d, "approved", TECH, "Checked the map and the heritage list", undefined, NOW, { listedBuilding: "no" });
  assert.ok(ok.ok && ok.item.listedBuilding === "no");
  if (ok.ok) {
    const back = reviewCompliance(ok.item, "under-review", TECH, "Second look", undefined, NOW);
    assert.ok(back.ok && back.item.listedBuilding === undefined);
  }
});

test("approvals from before the outcome was a choice are asked again before day 1, never after", () => {
  const legacy = allSettledBut([]).map((i) => (i.key === "planning-pd" ? { ...i, note: "Planning route needed: Grade II listed" } : i));
  const changed = syncCompliance(legacy, project(), NOW);
  const pd = changed.find((c) => c.key === "planning-pd");
  assert.equal(pd?.status, "under-review");
  assert.match(pd?.history?.at(-1)?.note ?? "", /choose the outcome/);
  assert.equal(changed.find((c) => c.key === "designations")?.status, "under-review");
  const started = project((x) => (x.install.status = "in-progress"));
  assert.equal(syncCompliance(legacy, started, NOW).find((c) => c.key === "planning-pd"), undefined, "an install under way is left as it is");
});

test("the day-1 gate reads planning consent without the compliance page: added to an older checklist, and in line with the outcome", () => {
  const older = allSettledBut(["planning-pd"]).filter((i) => i.key !== "planning-consent");
  const pending = planningConsentForGate(older, project(), {}, NOW);
  assert.ok(pending.some((i) => i.key === "planning-consent"));
  const decided = older.map((i) => (i.key === "planning-pd" ? { ...i, status: "approved" as const, planningOutcome: "consent-needed" as const } : i));
  const view = planningConsentForGate(decided, project(), {}, NOW);
  assert.equal(view.find((i) => i.key === "planning-consent")?.status, "evidence-required");
  assert.equal(planningBlocks(view).length, 1);
  const pd = older.map((i) => (i.key === "planning-pd" ? { ...i, status: "approved" as const, planningOutcome: "pd" as const } : i));
  assert.deepEqual(planningBlocks(planningConsentForGate(pd, project(), {}, NOW)), []);
  assert.deepEqual(planningConsentForGate([], project(), {}, NOW), [], "no checklist: compliance-missing says so");
});

test("progress counts what's settled and what still holds a gate", () => {
  const items = checklist();
  items[0] = { ...items[0]!, status: "approved" };
  items[1] = { ...items[1]!, status: "rejected" };
  const p = complianceProgress(items);
  assert.equal(p.total, items.length);
  assert.equal(p.settled, 1);
  assert.equal(p.rejected, 1);
  assert.ok(p.statutoryOpen > 0);
});

test("company F-gas: approval rests on a current certificate in settings, or the subcontractor's attached; a lapse reopens it", () => {
  const cert = { body: "DEMO REFCOM", number: "DEMO-CO-1", expiresOn: "2026-11-30" };
  const booked = project((x) => (x.booking.dates = ["2026-11-25", "2026-11-26", "2026-12-01"]));
  assert.equal(companyFgasCertProblem(cert, project(), "2026-10-18"), null, "nothing booked: current today");
  assert.match(companyFgasCertProblem(cert, booked, "2026-10-18") ?? "", /expires on 30 Nov 2026, before the last install day \(1 Dec 2026\)/);
  assert.match(companyFgasCertProblem(undefined, booked, "2026-10-18") ?? "", /no company F-gas certificate/);
  assert.match(companyFgasCertProblem({ body: "", number: "X" }, booked, "2026-10-18") ?? "", /no company F-gas certificate/);
  assert.equal(companyFgasCertProblem({ ...cert, expiresOn: undefined }, booked, "2026-10-18"), null, "no expiry on record");

  const fgas = item("fgas-company", { status: "under-review" });
  const problem = companyFgasCertProblem(cert, booked, "2026-10-18");
  const noted = reviewCompliance(fgas, "approved", TECH, "Checked the certificate", undefined, NOW, { companyFgasProblem: problem });
  assert.ok(!noted.ok && /expires on 30 Nov 2026[\s\S]*attach the certified company's certificate/.test(noted.error), "a note can't stand in for a lapsed certificate");
  const sub = reviewCompliance({ ...fgas, mediaIds: ["m-sub-cert"] }, "approved", TECH, "Under DEMO Cool Ltd's certificate", undefined, NOW, { companyFgasProblem: problem });
  assert.ok(sub.ok, "the subcontracting route: their certificate attached");
  assert.ok(reviewCompliance(fgas, "approved", TECH, "Checked it", undefined, NOW, { companyFgasProblem: null }).ok, "a current certificate in settings");

  // Approved on the settings certificate; the dates move past its expiry: it reopens, and the gate holds.
  const approved = { ...fgas, status: "approved" as const, reviewedBy: TECH.name, reviewedAt: NOW };
  const [reopened] = syncCompliance([approved], booked, NOW, undefined, { companyFgasProblem: problem });
  assert.equal(reopened?.status, "under-review");
  assert.match(reopened?.history?.at(-1)?.note ?? "", /Reopened automatically: The company F-gas certificate/);
  assert.deepEqual(syncCompliance([{ ...approved, mediaIds: ["m-sub-cert"] }], booked, NOW, undefined, { companyFgasProblem: problem }), [], "the subcontractor's certificate still stands");
  assert.deepEqual(syncCompliance([approved], booked, NOW, undefined, { companyFgasProblem: null }), []);
});

test("planning and noise reviewed before the approved design version existed are reopened for review; a review of this version stands", () => {
  const p = project((x) => (x.design = { status: "approved", designId: "d2", version: 2, approvedAt: "2026-10-20T16:30:00.000Z", approvedBy: "DEMO Tess" }));
  const v2 = { id: "d2", projectId: "p-1", version: 2, status: "approved", rooms: [], variants: [], overrides: [], createdAt: "2026-10-20T09:00:00.000Z" } as unknown as DesignRecord;
  const approvedAt = (at: string) =>
    checklist().map((i) =>
      i.key === "planning-pd" || i.key === "noise-assessment"
        ? { ...i, status: "approved" as const, reviewedBy: "DEMO Tess", reviewedAt: at, ...(i.key === "planning-pd" ? { planningOutcome: "pd" as const } : {}) }
        : i,
    );
  // Reviewed against version 1, the day before version 2 was drafted: both go back to waiting for review.
  const reopened = syncCompliance(approvedAt("2026-10-19T15:00:00.000Z"), p, NOW, v2).filter((c) => c.key === "planning-pd" || c.key === "noise-assessment");
  assert.deepEqual(reopened.map((c) => [c.key, c.status]).sort(), [["noise-assessment", "under-review"], ["planning-pd", "under-review"]]);
  assert.match(reopened[0]!.history!.at(-1)!.note!, /design version 2 was approved after this was reviewed/);
  // Reviewed while version 2 was in review (before it was signed): left as it is.
  assert.deepEqual(syncCompliance(approvedAt("2026-10-20T16:10:00.000Z"), p, NOW, v2).filter((c) => c.key === "planning-pd" || c.key === "noise-assessment"), []);
});

test("the design's planning and noise flags: planning constraints, unit count, size and noise in review or blocked, never other rules", async () => {
  const { planningNoiseFlags } = await import("./design-record.ts");
  const rule = (id: string, status: "pass" | "review" | "fail") => ({ id, title: id, status, detail: `${id} ${status}` });
  const flags = planningNoiseFlags({ rules: [rule("unit-count", "review"), rule("outdoor-volume", "pass"), rule("noise", "fail"), rule("planning", "review"), rule("pipe-length", "fail")] });
  // The planning constraints rule (a listed building, a conservation area, a "no" PD answer) asks for the customer note too.
  assert.deepEqual(flags.map((r) => r.id), ["unit-count", "noise", "planning"]);
  assert.deepEqual(planningNoiseFlags(undefined), []);
});

test("round 9: a leaseholder's or tenant's authority needs the written consent attached, and holds day 1 until then", () => {
  const own = item("ownership-authority", { status: "under-review" });
  const noted = reviewCompliance(own, "approved", ADMIN, "Leaseholder says the freeholder is fine with it", undefined, NOW, { tenure: "leaseholder" });
  assert.ok(!noted.ok && /attach the freeholder's or managing agent's written consent/.test(noted.error));
  const overridden = reviewCompliance(own, "approved", ADMIN, undefined, "Will chase it", NOW, { tenure: "tenant" });
  assert.ok(!overridden.ok && /landlord's written consent/.test(overridden.error), "an override can't stand in for it");
  assert.ok(reviewCompliance({ ...own, mediaIds: ["licence-pdf"] }, "approved", ADMIN, "Licence for alterations from the freeholder, 2 Nov 2026 (DEMO)", undefined, NOW, { tenure: "leaseholder" }).ok);
  assert.ok(reviewCompliance(own, "approved", ADMIN, "Owner-occupier, on the title register (DEMO)", undefined, NOW, { tenure: "owner" }).ok, "an owner: a note as before");

  const items = allSettledBut(["ownership-authority"]);
  const ctx = { ...gateCtx(items), authorityConsentNeeded: true };
  const b = blockersFor(project(), ctx, "ready-to-install").find((x) => x.code === "compliance:ownership-authority");
  assert.equal(b?.severity, "block");
  assert.match(b?.message ?? "", /no drilling until the freeholder's or landlord's written consent is attached/);
  assert.equal(blockersFor(project(), gateCtx(items), "ready-to-install").find((x) => x.code === "compliance:ownership-authority")?.severity, "warn", "an owner: flagged as before");
});

test("round 9: suspected asbestos at the survey: the check approves only on the test result (or the avoiding route) and a note", () => {
  const asb = item("asbestos", { status: "under-review" });
  const note = reviewCompliance(asb, "approved", TECH, "Looked at the drilling spots", undefined, NOW, { asbestosSuspected: true });
  assert.ok(!note.ok && /attach the test result or asbestos survey/.test(note.error), "the review's repro");
  assert.equal(reviewCompliance({ ...asb, mediaIds: ["lab-report"] }, "approved", TECH, undefined, undefined, NOW, { asbestosSuspected: true }).ok, false);
  assert.ok(reviewCompliance({ ...asb, mediaIds: ["lab-report"] }, "approved", TECH, "Sample DEMO-123: no asbestos detected (DEMO)", undefined, NOW, { asbestosSuspected: true }).ok);
  assert.ok(reviewCompliance(asb, "approved", TECH, "Post-2000 build, nothing suspected", undefined, NOW, {}).ok, "nothing suspected: as before");
  assert.equal(asbestosSuspectedAtSurvey({ house: { asbestosRisk: "suspected" }, electrics: { asbestosFlashGuard: "no" } }), true);
  assert.equal(asbestosSuspectedAtSurvey({ house: { asbestosRisk: "none-suspected" }, electrics: { asbestosFlashGuard: "possible" } }), true);
  assert.equal(asbestosSuspectedAtSurvey({ house: { asbestosRisk: "not-assessed" }, electrics: { asbestosFlashGuard: "n/a" } }), false);
});

test("round 9: supply capacity and the DNO is on the checklist before booking, and needs the electrician's written outcome", () => {
  const t = complianceTemplateFor("supply-and-dno")!;
  assert.equal(t.gate, "booking");
  assert.equal(t.ownerRole, "electrician");
  assert.equal(t.allowNa, false);
  assert.match(t.guidance, /cut-out \(main fuse\) rating[\s\S]*looped[\s\S]*maximum demand[\s\S]*28 days/);
  const i = item("supply-and-dno", { mediaIds: ["cutout-photo"] });
  assert.equal(reviewCompliance(i, "approved", TECH, undefined, undefined, NOW).ok, false, "a photo alone isn't the outcome");
  assert.equal(reviewCompliance(i, "not-applicable", TECH, "Small unit", undefined, NOW).ok, false);
  assert.ok(reviewCompliance(i, "approved", TECH, "60 A cut-out, not looped, max demand 38 A after diversity; connect and notify, UKPN ref DEMO-1 (DEMO)", undefined, NOW).ok);
});
