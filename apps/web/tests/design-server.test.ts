import { test } from "node:test";
import assert from "node:assert/strict";
import { editsFromDesign, type DesignEdits } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// The real demo seed on the in-memory backend: design studio and catalogue
// server end to end, nothing on disk or a real database.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { demoId } = await import("../lib/demo-seed/ids.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const staffRepo = await import("../lib/repo/staff.ts");
const mediaRepo = await import("../lib/repo/media.ts");
const designsRepo = await import("../lib/repo/designs.ts");
const { loadProject, londonToday } = await import("../lib/project-service.ts");
const design = await import("../lib/design-server.ts");
const catalogue = await import("../lib/catalogue-server.ts");
const { DEFAULT_SETTINGS } = await import("@aircon/domain");

await resetDemoData({ now: new Date().toISOString(), settings: DEFAULT_SETTINGS });
for (const s of Object.values(DEMO_STAFF)) if (!(await staffRepo.get(s.id))) await staffRepo.insert(s, null);

const TECH = DEMO_STAFF["tech-lead"];
const SURVEYOR = DEMO_STAFF.surveyor;
const DEMO1 = demoId("demo1:project"); // survey booked, not done
const DEMO4 = demoId("demo4:project"); // design in review
const today = londonToday();

test("viewer: only a technical lead with current F-gas may approve; surveyors edit", () => {
  const tech = design.viewerFor(TECH, today);
  assert.equal(tech.canApprove, true);
  assert.equal(tech.qualificationRef, "DEMO-FGAS-0001");
  const surveyor = design.viewerFor(SURVEYOR, today);
  assert.equal(surveyor.canEdit, true);
  assert.equal(surveyor.canApprove, false);
  assert.match(surveyor.approveBlockedReason!, /technical lead/);
  const lapsed = design.viewerFor({ ...TECH, qualifications: [{ ...TECH.qualifications[0]!, expiresOn: "2020-01-01" }] }, today);
  assert.equal(lapsed.canApprove, false);
  assert.match(lapsed.approveBlockedReason!, /F-gas/);
  const external = design.viewerFor(DEMO_STAFF["external-installer"], today);
  assert.equal(external.canSeeCosts, false);
  assert.equal(external.canEdit, false);
});

test("the page loads the seeded design, its photos and a cost-free catalogue for people who mayn't see costs", async () => {
  const page = await design.loadDesignPage(DEMO4, design.viewerFor(TECH, today));
  assert.ok(page);
  assert.equal(page.design?.status, "in-review");
  assert.equal(page.survey?.status, "submitted");
  assert.ok(page.media.length > 0 && page.media.every((m) => m.url));
  assert.ok(page.catalogue.some((i) => i.costPence !== null));
  const blind = await design.loadDesignPage(DEMO4, design.viewerFor(DEMO_STAFF["external-installer"], today));
  assert.ok(blind!.catalogue.every((i) => i.costPence === null && !i.costSource));
});

test("no design without a submitted survey", async () => {
  const r = await design.draftNewDesign(DEMO1, SURVEYOR);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /survey needs submitting/);
});

test("save → new version only when changed; reasons required; stale bases refused; approve locks the layout", async () => {
  // Redraft from the survey with the engine (v2), as a surveyor.
  const drafted = await design.draftNewDesign(DEMO4, SURVEYOR);
  assert.ok(drafted.ok, drafted.ok ? "" : drafted.error);
  const v2 = drafted.value;
  assert.equal(v2.version, 2);
  assert.equal((await designsRepo.get(demoId("demo4:design:1")))?.status ?? "superseded", "superseded");
  assert.equal((await loadProject(DEMO4))!.design.designId, v2.id);

  // Nothing changed: no new version.
  const same = await design.saveDesign(DEMO4, SURVEYOR, { baseId: v2.id, baseVersion: 2, edits: editsFromDesign(v2) });
  assert.ok(same.ok);
  if (same.ok) assert.equal(same.value.unchanged, true);

  // A bigger unit in the main bedroom, no reason yet.
  const edits: DesignEdits = editsFromDesign(v2);
  edits.rooms[0]!.chosenKw = 3.5;
  const saved = await design.saveDesign(DEMO4, SURVEYOR, { baseId: v2.id, baseVersion: 2, edits });
  assert.ok(saved.ok, saved.ok ? "" : saved.error);
  const v3 = saved.ok ? saved.value.design : v2;
  assert.equal(v3.version, 3);
  assert.ok(design.approvalErrorsFor(v3).some((e) => e.startsWith("Give a reason for the change to Main bedroom: capacity")));

  // A retry of the same save (the reply was lost) is recognised, not doubled.
  const retry = await design.saveDesign(DEMO4, SURVEYOR, { baseId: v2.id, baseVersion: 2, edits });
  assert.ok(retry.ok);
  if (retry.ok) assert.equal(retry.value.design.id, v3.id);
  // A genuinely different save on the old base is a conflict.
  const stale = await design.saveDesign(DEMO4, SURVEYOR, { baseId: v2.id, baseVersion: 2, edits: { ...edits, notes: "Other change" } });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict, true);

  // Junk is refused before anything is read.
  const junk = await design.saveDesign(DEMO4, SURVEYOR, { baseId: v3.id, baseVersion: 3, edits: { ...edits, rooms: [{ ...edits.rooms[0]!, chosenKw: 4.2 }] } });
  assert.equal(junk.ok, false);

  // Give the reason, take the engine's unit for the new size (as the studio does), and submit for review.
  const followed = editsFromDesign(v3);
  followed.variants = followed.variants.map((v) => ({ ...v, roomUnits: v3.variants.find((x) => x.id === v.id)!.suggested!.roomUnits }));
  const submitted = await design.saveDesign(DEMO4, SURVEYOR, {
    baseId: v3.id,
    baseVersion: 3,
    edits: { ...followed, reasons: { "rooms.r1.chosenKw": "Loft room above runs hot in summer (DEMO)" } },
    submit: true,
  });
  assert.ok(submitted.ok, submitted.ok ? "" : submitted.error);
  const v4 = submitted.ok ? submitted.value.design : v3;
  assert.equal(v4.status, "in-review");
  assert.equal((await loadProject(DEMO4))!.design.status, "in-review");

  // A surveyor can't approve; the tech lead can once the errors are clear.
  const notAllowed = await design.approveDesignRecord(DEMO4, SURVEYOR, { designId: v4.id, version: 4, combinationTableChecked: true });
  assert.equal(notAllowed.ok, false);
  const errors = design.approvalErrorsFor(v4);
  assert.deepEqual(errors, [], errors.join(" | "));
  const approved = await design.approveDesignRecord(DEMO4, TECH, { designId: v4.id, version: 4, combinationTableChecked: false });
  assert.ok(approved.ok, approved.ok ? "" : approved.error);
  if (approved.ok) {
    assert.equal(approved.value.design.status, "approved");
    assert.equal(approved.value.design.approval?.qualificationRef, "DEMO-FGAS-0001");
    assert.equal(approved.value.lockFailures, 0);
    const photos = await mediaRepo.listByIds(approved.value.design.rooms.flatMap((r) => r.layoutMediaIds));
    assert.ok(photos.length > 0 && photos.every((m) => m.locked));
  }
  const project = (await loadProject(DEMO4))!;
  assert.equal(project.design.status, "approved");
  assert.equal(project.design.approvedBy, TECH.name);
  // Approving again is harmless.
  const again = await design.approveDesignRecord(DEMO4, TECH, { designId: v4.id, version: 4, combinationTableChecked: false });
  assert.ok(again.ok);
});

test("catalogue: create, update, validation, CSV preview and apply, research seed keeps edits", async () => {
  const base = {
    id: "test-sleeve-90",
    kind: "material",
    label: "Wall sleeve 90 mm (test)",
    unit: "each",
    category: "sealing",
    costPence: 450,
    status: "available",
    confidence: "provisional",
    sources: [],
    active: true,
  };
  const created = await catalogue.saveItem(base, TECH, "create");
  assert.ok(created.ok, created.ok ? "" : created.errors.join(" "));
  const dup = await catalogue.saveItem(base, TECH, "create");
  assert.equal(dup.ok, false);
  const bad = await catalogue.saveItem({ ...base, costPence: -5, sources: [{ url: "javascript:alert(1)" }] }, TECH, "update");
  assert.equal(bad.ok, false);
  const verifiedNoSource = await catalogue.saveItem({ ...base, confidence: "verified" }, TECH, "update");
  assert.equal(verifiedNoSource.ok, false);

  const csv = await catalogue.exportCatalogueCsv();
  assert.ok(csv.includes("test-sleeve-90"));
  const changed = csv.replace("Wall sleeve 90 mm (test)", "Wall sleeve 90 mm (test renamed)");
  const preview = await catalogue.previewCsv(changed);
  assert.equal(preview.counts.update, 1);
  assert.equal(preview.counts.new, 0);
  const applied = await catalogue.applyCsv(changed, TECH);
  assert.ok(applied.ok);
  if (applied.ok) assert.equal(applied.value.written, 1);
  assert.equal((await catalogue.getItem("test-sleeve-90"))!.label, "Wall sleeve 90 mm (test renamed)");

  const first = await catalogue.loadResearchedCatalogue(false, TECH);
  assert.ok(first.items.added > 100);
  // A supplier price entered later survives a re-load without overwrite.
  const item = (await catalogue.getItem("panasonic-cs-tz25ckew"))!;
  await catalogue.saveItem({ ...item, costPence: 33_300, costSource: { supplier: "Test supplier", observedAt: "2026-10-18" } }, TECH, "update");
  const second = await catalogue.loadResearchedCatalogue(false, TECH);
  assert.equal(second.items.added, 0);
  assert.equal((await catalogue.getItem("panasonic-cs-tz25ckew"))!.costPence, 33_300);
  const third = await catalogue.loadResearchedCatalogue(true, TECH);
  assert.ok(third.items.replaced > 100);
  assert.equal((await catalogue.getItem("panasonic-cs-tz25ckew"))!.costPence, null);

  const rule = await catalogue.saveRule(
    { id: "test-rule", outdoorModel: "DM-DUO50", maxIndoorUnits: 2, connectableIndoorSeries: [], connectableIndoorModels: ["DM-*"], minConnectedKw: null, maxConnectedKw: null, maxTotalPipeM: 30, maxPipePerRoomM: 20, source: null, confidence: "verified" },
    TECH,
    "create",
  );
  assert.equal(rule.ok, false); // verified needs a source
  const del = await catalogue.deleteRule("does-not-exist", TECH);
  assert.equal(del.ok, false);
});
