import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPLIANCE_GATE_GROUPS,
  COMPLIANCE_TEMPLATE,
  addComplianceEvidence,
  complianceProgress,
  complianceTemplateFor,
  instantiateCompliance,
  reviewCompliance,
  syncCompliance,
  type ComplianceItem,
} from "./compliance.ts";
import { GATE_IDS, blockersFor, createProject, type Project, type ReadinessContext } from "./project.ts";
import { generateQuote } from "./pricing.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
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
  "outdoor-siting",
  "structural-fixings",
  "asbestos",
  "concealed-services",
  "electrical-scope",
  "fgas-company",
  "fgas-engineer",
  "manufacturer-requirements",
  "working-at-height",
  "rams",
  "equipment-compatibility",
  "design-approval",
  "commissioning-approval",
  "electrical-certificate",
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
  const evidenceOnly = reviewCompliance(pd, "approved", TECH, undefined, undefined, NOW);
  assert.equal(evidenceOnly.ok, false);
  assert.equal(reviewCompliance(pd, "not-applicable", TECH, "No planning needed", undefined, NOW).ok, false, "never 'not applicable'");
  const ok = reviewCompliance(pd, "approved", TECH, "PD checks passed: technical lead confirms. DEMO.", undefined, NOW);
  assert.ok(ok.ok);
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
  });
  const changed = syncCompliance(items, p, NOW);
  const byKey = Object.fromEntries(changed.map((c) => [c.key, c]));
  assert.equal(byKey["design-approval"]?.status, "approved");
  assert.equal(byKey["design-approval"]?.reviewedBy, "DEMO Tess");
  assert.equal(byKey["warranty-registration"]?.status, "approved");
  assert.equal(byKey["commissioning-approval"], undefined, "not commissioned yet");

  // Idempotent: nothing more to change.
  const merged = items.map((i) => changed.find((c) => c.id === i.id) ?? i);
  assert.deepEqual(syncCompliance(merged, p, NOW), []);

  // A new draft design takes the approval away.
  const redraft = project((x) => (x.design = { status: "draft", designId: "d", version: 3 }));
  const reopened = syncCompliance(merged, redraft, NOW).find((c) => c.key === "design-approval");
  assert.equal(reopened?.status, "under-review");
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
