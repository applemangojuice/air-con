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
  // A supplier price list (id, kind, label and cost columns only) updates prices and nothing else.
  const priceList = "id,kind,label,costGbpExVat,costSupplier\npanasonic-cu-tz25cke,outdoor,Panasonic TZ 2.5 kW outdoor,512.00,Test supplier\n";
  const before = (await catalogue.getItem("panasonic-cu-tz25cke"))!;
  const pricePreview = await catalogue.previewCsv(priceList);
  assert.equal(pricePreview.counts.update, 1);
  const priced = await catalogue.applyCsv(priceList, TECH);
  assert.ok(priced.ok);
  const after = (await catalogue.getItem("panasonic-cu-tz25cke"))!;
  assert.equal(after.costPence, 51_200);
  assert.deepEqual(after.specs, before.specs);
  assert.deepEqual(after.sources, before.sources);

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

test("catalogue editor: every researched item passes the editor's schema, and a refusal names the field, the length and the limit", async () => {
  const { RESEARCHED_CATALOGUE } = await import("@aircon/domain/catalogue-data");
  const refused = RESEARCHED_CATALOGUE.map((item) => ({ id: item.id, r: catalogue.catalogueItemSchema.safeParse(item) }))
    .filter((x) => !x.r.success)
    .map((x) => `${x.id}: ${x.r.success ? "" : catalogue.issuesOf(x.r.error, RESEARCHED_CATALOGUE.find((i) => i.id === x.id)).join("; ")}`);
  assert.deepEqual(refused, [], "Load researched catalogue, then Save, works for every item (the Daikin Perfera outdoor units included)");
  // The Perfera's heating range is the long one: it saves through the editor.
  const perfera = RESEARCHED_CATALOGUE.find((i) => i.id === "daikin-rxm35a5v1b9")!;
  assert.ok((perfera.specs?.operatingRangeHeatingC ?? "").length > 60);
  await catalogue.loadResearchedCatalogue(false, TECH);
  const saved = await catalogue.saveItem(perfera, TECH, "update");
  assert.ok(saved.ok, saved.ok ? "" : saved.errors.join(" "));

  // Too long: the form's label, how long it is and the limit, never a zod path or "Invalid input".
  const long = "x".repeat(catalogue.SPEC_TEXT_MAX + 11);
  const tooLong = await catalogue.saveItem({ ...perfera, specs: { ...perfera.specs, operatingRangeHeatingC: long } }, TECH, "update");
  assert.ok(!tooLong.ok);
  assert.deepEqual(tooLong.errors, [`Operating range, heating: ${long.length} characters, at most ${catalogue.SPEC_TEXT_MAX}`]);
  const several = await catalogue.saveItem(
    { ...perfera, label: "", costSource: { url: "ftp://nope" }, sources: [{ url: "https://example.com", title: "t".repeat(301) }], specs: { ...perfera.specs, coolingKw: "lots" } },
    TECH,
    "update",
  );
  assert.ok(!several.ok);
  const text = several.errors.join(" | ");
  assert.match(text, /Label: Give the item a label/);
  assert.match(text, /Link to the price: Links must start http:\/\/ or https:\/\//);
  assert.match(text, /Title of link 1: 301 characters, at most 300/);
  assert.match(text, /Cooling capacity: should be a number/);
  assert.doesNotMatch(text, /Invalid input|specs\.|costSource\./);

  // The manufacturer's limits save through the editor; the fewest indoor units is a whole number.
  const multi = RESEARCHED_CATALOGUE.find((i) => i.id === "panasonic-cu-2z50cbe")!;
  const limits = await catalogue.saveItem({ ...multi, specs: { ...multi.specs, maxIndoorHeightDiffM: 5, minConnectedKw: 3.2 } }, TECH, "update");
  assert.ok(limits.ok, limits.ok ? "" : limits.errors.join(" "));
  assert.deepEqual([limits.ok && limits.value.specs?.minPipeM, limits.ok && limits.value.specs?.maxIndoorHeightDiffM, limits.ok && limits.value.specs?.minIndoorUnits], [3, 5, 2]);
  const half = await catalogue.saveItem({ ...multi, specs: { ...multi.specs, minIndoorUnits: 2.5 } }, TECH, "update");
  assert.ok(!half.ok);
  assert.match(half.errors.join(" "), /Fewest indoor units connected \(multi-split\)/);
});

test("two tabs: a stale catalogue or staff editor never silently undoes a price rise, a retirement or a deactivation", async () => {
  const catalogueRepo = await import("../lib/repo/catalogue.ts");
  await catalogue.loadResearchedCatalogue(false, TECH);
  const id = "panasonic-cu-z25cke";
  const tabA = (await catalogueRepo.getStamped(id))!;
  const tabB = (await catalogueRepo.getStamped(id))!;
  await new Promise((r) => setTimeout(r, 5));
  // Tab B raises the trade price.
  const raised = await catalogue.saveItem({ ...tabB.item, costPence: 112_000 }, TECH, "update", { expectedUpdatedAt: tabB.updatedAt });
  assert.ok(raised.ok, raised.ok ? "" : raised.errors.join(" "));
  // Stale tab A renames it: refused, and the price stands.
  const stale = await catalogue.saveItem({ ...tabA.item, label: `${tabA.item.label} (renamed)` }, TECH, "update", { expectedUpdatedAt: tabA.updatedAt });
  assert.ok(!stale.ok && stale.errors[0] === catalogue.STALE_ITEM);
  assert.equal((await catalogue.getItem(id))!.costPence, 112_000);
  // A save with the token its own last save gave works.
  const again = await catalogue.saveItem({ ...(await catalogue.getItem(id))!, label: "Renamed (DEMO)" }, TECH, "update", { expectedUpdatedAt: raised.ok ? raised.version : "" });
  assert.ok(again.ok, again.ok ? "" : again.errors.join(" "));
  // Retired, then a save from a form still showing it in use: it stays retired.
  await catalogue.setItemActive(id, false, TECH);
  const fresh = (await catalogueRepo.getStamped(id))!;
  const keeps = await catalogue.saveItem({ ...fresh.item, active: true, notes: "DEMO note" }, TECH, "update", { expectedUpdatedAt: fresh.updatedAt });
  assert.ok(keeps.ok);
  assert.equal((await catalogue.getItem(id))!.active, false, "Retire / Restore is its own action: a save never brings an item back into use");

  // Staff: deactivated in one tab, a stale editor's save is refused (never reactivated unseen).
  const person = Object.values(DEMO_STAFF).find((s) => s.roles.includes("installer"))!;
  const before = (await staffRepo.getStamped(person.id))!;
  await new Promise((r) => setTimeout(r, 5));
  const off = await staffRepo.updateIfUnchanged({ ...before.member, active: false }, null, before.updatedAt);
  assert.ok(off);
  assert.equal(await staffRepo.updateIfUnchanged({ ...before.member, phone: "07700 900123" }, null, before.updatedAt), null);
  assert.equal((await staffRepo.get(person.id))!.active, false);
  // A photo upload writes only the photo, so an editor open beside it still saves.
  await staffRepo.setPhoto(person.id, crypto.randomUUID(), null);
  assert.ok(await staffRepo.updateIfUnchanged({ ...off!.member, active: true }, null, off!.updatedAt));
});
