import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CATALOGUE_CSV_COLUMNS,
  DEMO_CATALOGUE,
  DEMO_COMPATIBILITY,
  PROVISIONAL_RULE_WARNING,
  UNVERIFIED_COMBINATION,
  catalogueFromCsv,
  catalogueItemErrors,
  catalogueToCsv,
  compatibilityRuleErrors,
  effectiveConfidence,
  findRule,
  isConnectable,
  isCustomerSafe,
  isStale,
  mergeCsvRow,
  modelMatches,
  parseCsv,
  planSeedMerge,
  singlePairFor,
  stillResearchPrice,
  validateCombination,
  type CatalogueItem,
  type CompatibilityRule,
} from "./catalogue.ts";
import { RESEARCHED_CATALOGUE, RESEARCHED_COMPATIBILITY, RESEARCH_CAVEATS } from "./catalogue-data.ts";

const item = (id: string) => {
  const found = [...DEMO_CATALOGUE, ...RESEARCHED_CATALOGUE].find((i) => i.id === id);
  assert.ok(found, `fixture ${id}`);
  return found;
};
const duo = DEMO_COMPATIBILITY.find((r) => r.id === "demo-compat-duo50")!;
const rule = (over: Partial<CompatibilityRule> = {}): CompatibilityRule => ({ ...duo, ...over });

/* ------------------------------------------------------------------ */
/* validateCombination                                                 */
/* ------------------------------------------------------------------ */

test("a single split on its listed pair passes; any other outdoor unit is an error", () => {
  const ok = validateCombination(undefined, item("demo-out-brz25"), [item("demo-ind-brz25")], [6]);
  assert.deepEqual(ok, { ok: true, errors: [], warnings: [] });

  const wrong = validateCombination(undefined, item("demo-out-whs35"), [item("demo-ind-brz25")], [6]);
  assert.equal(wrong.ok, false);
  assert.match(wrong.errors[0]!, /DM-WHS35-O isn't listed as the pair for DM-BRZ25/);
});

test("a single split's run is checked against the outdoor unit's own limit", () => {
  const over = validateCombination(undefined, item("demo-out-brz25"), [item("demo-ind-brz25")], [21]);
  assert.equal(over.ok, false);
  assert.match(over.errors.join(" "), /21 m is over DM-BRZ25-O's 20 m limit/);

  // Research data: the pair is named by id on the indoor side.
  const pan = validateCombination(undefined, item("panasonic-cu-z25cke"), [item("panasonic-cs-z25ckew")], [12]);
  assert.equal(pan.ok, true);
});

test("more than one indoor unit with no rule is never guessed", () => {
  const check = validateCombination(undefined, item("demo-out-duo50"), [item("demo-ind-brz25"), item("demo-ind-brz25")], [5, 5]);
  assert.equal(check.ok, false);
  assert.deepEqual(check.errors, [UNVERIFIED_COMBINATION]);
});

test("a verified rule: list, ports, connected capacity and pipe limits", () => {
  const out = item("demo-out-duo50");
  const ok = validateCombination(duo, out, [item("demo-ind-brz25"), item("demo-ind-brz35")], [6, 10]);
  assert.deepEqual(ok, { ok: true, errors: [], warnings: [] });

  const three = validateCombination(duo, out, [item("demo-ind-brz25"), item("demo-ind-brz25"), item("demo-ind-brz25")], [3, 3, 3]);
  assert.match(three.errors.join(" "), /takes up to 2 indoor units; this has 3/);

  const low = validateCombination(rule({ minConnectedKw: 5.5 }), out, [item("demo-ind-brz25"), item("demo-ind-brz25")], [3, 3]);
  assert.match(low.errors.join(" "), /5\.0 kW is below DM-DUO50's minimum of 5\.5 kW/);

  const high = validateCombination(rule({ maxConnectedKw: 6 }), out, [item("demo-ind-brz35"), item("demo-ind-brz35")], [3, 3]);
  assert.match(high.errors.join(" "), /7\.0 kW is above DM-DUO50's maximum of 6\.0 kW/);

  const total = validateCombination(duo, out, [item("demo-ind-brz25"), item("demo-ind-brz25")], [18, 13]);
  assert.match(total.errors.join(" "), /Total pipe 31 m is over DM-DUO50's 30 m limit/);

  const perRoom = validateCombination(duo, out, [item("demo-ind-brz25"), item("demo-ind-brz25")], [21, 2]);
  assert.match(perRoom.errors.join(" "), /Indoor unit 1 \(DM-BRZ25\): pipe run 21 m is over the 20 m per-room limit/);
});

test("an indoor unit off the rule's list is an error; models may use * and series match exactly", () => {
  const out = item("demo-out-duo50");
  const stranger: CatalogueItem = { ...item("demo-ind-brz25"), id: "x", model: "OTHER-25", series: "Other" };
  const off = validateCombination(duo, out, [item("demo-ind-brz25"), stranger], [3, 3]);
  assert.match(off.errors.join(" "), /OTHER-25 isn't on DM-DUO50's list/);

  assert.ok(modelMatches("MSZ-AY*VGK", "msz-ay25vgk"));
  assert.ok(!modelMatches("MSZ-AY*VGK", "MSZ-AP25VGK"));
  assert.ok(modelMatches("cs-tz25ckew", "CS-TZ25CKEW"));
  const byPattern = rule({ connectableIndoorModels: ["DM-BRZ*"], connectableIndoorSeries: [] });
  assert.ok(isConnectable(byPattern, item("demo-ind-brz35")));
  assert.ok(!isConnectable(byPattern, item("demo-ind-whs35")));
  const bySeries = rule({ connectableIndoorModels: [], connectableIndoorSeries: ["whisper"] });
  assert.ok(isConnectable(bySeries, item("demo-ind-whs25")));
  // Descriptive research series strings never match by accident.
  const research = RESEARCHED_COMPATIBILITY.find((r) => r.outdoorModel === "CU-2Z50CBE")!;
  assert.ok(isConnectable(research, item("panasonic-cs-tz25ckew")));
  assert.ok(!isConnectable(research, item("daikin-ftxm25a5v1b")));
});

test("a provisional rule passes with the warning approval looks for; missing limits are warnings", () => {
  const out = item("panasonic-cu-2z50cbe");
  const research = findRule(out, RESEARCHED_COMPATIBILITY);
  assert.ok(research);
  const check = validateCombination(research, out, [item("panasonic-cs-tz25ckew"), item("panasonic-cs-tz35ckew")], [5, 8]);
  assert.equal(check.ok, true);
  assert.ok(check.warnings.includes(PROVISIONAL_RULE_WARNING));

  const unknown = validateCombination(
    rule({ minConnectedKw: null, maxConnectedKw: null, maxTotalPipeM: null, maxPipePerRoomM: null, source: null }),
    item("demo-out-duo50"),
    [item("demo-ind-brz25"), item("demo-ind-brz25")],
    [3, 3],
  );
  assert.equal(unknown.ok, true);
  assert.match(unknown.warnings.join(" "), /No connected-capacity range on record/);
  assert.match(unknown.warnings.join(" "), /No total pipe limit/);
  assert.match(unknown.warnings.join(" "), /No per-room pipe limit/);
  assert.match(unknown.warnings.join(" "), /No source recorded/);
});

test("discontinued or retired kit is an error; uncertain availability and unknown capacity are warnings", () => {
  const out = item("demo-out-duo50");
  const gone = validateCombination(duo, { ...out, status: "discontinued" }, [item("demo-ind-brz25"), item("demo-ind-brz25")], [3, 3]);
  assert.match(gone.errors.join(" "), /DM-DUO50 is discontinued/);
  const retired = validateCombination(duo, out, [{ ...item("demo-ind-brz25"), active: false }, item("demo-ind-brz25")], [3, 3]);
  assert.match(retired.errors.join(" "), /retired from the catalogue/);
  const unsure = validateCombination(duo, { ...out, status: "uncertain" }, [item("demo-ind-brz25"), item("demo-ind-brz25")], [3, 3]);
  assert.equal(unsure.ok, true);
  assert.match(unsure.warnings.join(" "), /Availability of DM-DUO50 is uncertain/);
  const noKw = { ...item("demo-ind-brz25"), specs: { ...item("demo-ind-brz25").specs, coolingKw: null } };
  const blind = validateCombination(duo, out, [noKw, item("demo-ind-brz25")], [3, 3]);
  assert.match(blind.warnings.join(" "), /Capacity unknown for DM-BRZ25/);
});

/* ------------------------------------------------------------------ */
/* Pairs, labels                                                       */
/* ------------------------------------------------------------------ */

test("singlePairFor follows the catalogue's own pairing, either way round, never a lookalike", () => {
  assert.equal(singlePairFor(item("demo-ind-whs35"), DEMO_CATALOGUE)?.id, "demo-out-whs35"); // outdoor names the indoor
  assert.equal(singlePairFor(item("panasonic-cs-xz35ckew"), RESEARCHED_CATALOGUE)?.id, "panasonic-cu-z35cke"); // indoor names the outdoor
  const orphan: CatalogueItem = { ...item("demo-ind-brz25"), id: "orphan", model: "ORPHAN-25" };
  assert.equal(singlePairFor(orphan, DEMO_CATALOGUE), undefined);
  const retired = DEMO_CATALOGUE.map((i) => (i.id === "demo-out-brz25" ? { ...i, active: false } : i));
  assert.equal(singlePairFor(item("demo-ind-brz25"), retired), undefined);
});

test("customer-safe means active, available and verified; provisional is usable but labelled", () => {
  assert.equal(isCustomerSafe(item("panasonic-cs-z25ckew")), true);
  assert.equal(isCustomerSafe(item("demo-ind-brz25")), false); // provisional
  assert.equal(isCustomerSafe(item("mitsubishi-electric-msz-ap35vgk")), false); // uncertain + provisional
  assert.equal(isCustomerSafe({ ...item("panasonic-cs-z25ckew"), active: false }), false);
});

test("verified figures go stale after 90 days", () => {
  const v = { confidence: "verified" as const, verifiedAt: "2026-07-01" };
  assert.equal(isStale(v, "2026-09-29"), false); // 90 days
  assert.equal(isStale(v, "2026-09-30"), true); // 91
  assert.equal(effectiveConfidence(v, "2026-12-01"), "stale");
  assert.equal(effectiveConfidence({ confidence: "provisional" }, "2030-01-01"), "provisional");
  assert.equal(isStale({ confidence: "stale" }, "2026-01-01"), true);
});

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

test("CSV round trip: the researched catalogue comes back exactly", () => {
  const csv = catalogueToCsv(RESEARCHED_CATALOGUE);
  assert.ok(csv.startsWith(`${CATALOGUE_CSV_COLUMNS.join(",")}\r\n`));
  const back = catalogueFromCsv(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.items, RESEARCHED_CATALOGUE);
});

test("CSV round trip: the DEMO catalogue keeps every value (absent specs come back as null)", () => {
  const back = catalogueFromCsv(catalogueToCsv(DEMO_CATALOGUE));
  assert.deepEqual(back.errors, []);
  const strip = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, strip(x)])) : v;
  assert.deepEqual(strip(back.items), strip(DEMO_CATALOGUE));
});

test("CSV escapes quotes, commas, newlines and spreadsheet formulas, and reads them back", () => {
  const tricky: CatalogueItem = {
    ...item("demo-mat-sleeve"),
    id: "tricky",
    label: '=HYPERLINK("x"), "quoted"',
    notes: "Line one\nline two, with a comma",
    customerBlurb: "@risk",
    costPence: 123456,
  };
  const csv = catalogueToCsv([tricky]);
  assert.match(csv, /"'=HYPERLINK\(""x""\), ""quoted"""/);
  assert.match(csv, /,'@risk,/);
  assert.match(csv, /,1234\.56,/);
  const back = catalogueFromCsv(csv);
  assert.deepEqual(back.errors, []);
  assert.equal(back.items[0]!.label, tricky.label);
  assert.equal(back.items[0]!.notes, tricky.notes);
  assert.equal(back.items[0]!.customerBlurb, "@risk");
  assert.equal(back.items[0]!.costPence, 123456);
});

test("CSV import reports row-level errors and leaves bad rows out", () => {
  const csv = [
    "id,kind,label,costGbpExVat,status,confidence,active,verifiedAt,ports,sources,spec.coolingKw",
    "good-1,material,Good thing,£1234.50,,,yes,,,,",
    'good-2,indoor,"Indoor, two",12,available,verified,TRUE,2026-10-01,,https://example.com/a | Title A,2.5',
    "bad kind,fridge,,12abc,lost,maybe,perhaps,18/10/2026,12,ftp://nope,lots",
    "good-1,material,Duplicate,,,,,,,,",
  ].join("\n");
  const { items, errors } = catalogueFromCsv(csv);
  assert.deepEqual(items.map((i) => i.id), ["good-1", "good-2"]);
  assert.equal(items[0]!.costPence, 123450);
  assert.equal(items[0]!.status, "available");
  assert.equal(items[0]!.confidence, "provisional");
  assert.equal(items[0]!.active, true);
  assert.equal(items[1]!.costPence, 1200);
  assert.deepEqual(items[1]!.sources, [{ url: "https://example.com/a", title: "Title A" }]);
  assert.equal(items[1]!.specs?.coolingKw, 2.5);
  const row4 = errors.filter((e) => e.startsWith("Row 4"));
  for (const bit of ["id may only use", "kind \"fridge\"", "label is blank", "cost \"12abc\"", "status \"lost\"", "confidence \"maybe\"", "Active \"perhaps\"", "Verified date", "ports should", "source \"ftp://nope\"", "Cooling capacity \"lots\""]) {
    assert.ok(row4.some((e) => e.includes(bit)), `row 4 mentions ${bit}: ${row4.join(" | ")}`);
  }
  assert.ok(errors.some((e) => e.startsWith("Row 5 (good-1)") && e.includes("more than once")));
});

test("CSV import: quoted £ costs, a missing header, an empty file", () => {
  const ok = catalogueFromCsv('id,kind,label,costGbpExVat\r\nx1,material,Thing,"£1,234.50"\r\n');
  assert.equal(ok.items[0]!.costPence, 123450);
  assert.match(catalogueFromCsv("id,label\nx,y").errors[0]!, /missing: kind/);
  assert.deepEqual(catalogueFromCsv("").errors, ["The file is empty."]);
  assert.deepEqual(parseCsv('a,"b\n""c"""\r\n\r\nd'), [["a", 'b\n"c"'], ["d"]]);
});

test("a partial CSV (a price list) only changes the columns it has", () => {
  const stored = item("panasonic-cs-tz25ckew");
  const csv = 'id,kind,label,costGbpExVat,costSupplier,costObservedAt\r\npanasonic-cs-tz25ckew,indoor,Panasonic TZ 2.5 kW,412.50,DEMO Trade Counter,2026-10-18\r\n';
  const { items, errors, columns } = catalogueFromCsv(csv);
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ["id", "kind", "label", "costGbpExVat", "costSupplier", "costObservedAt"]);
  const merged = mergeCsvRow(stored, items[0]!, columns);
  assert.equal(merged.costPence, 41_250);
  assert.deepEqual(merged.costSource, { supplier: "DEMO Trade Counter", observedAt: "2026-10-18" });
  // Everything the file didn't mention is as it was.
  assert.deepEqual(merged.specs, stored.specs);
  assert.deepEqual(merged.sources, stored.sources);
  assert.equal(merged.confidence, stored.confidence);
  assert.equal(merged.notes, stored.notes);
  assert.equal(merged.model, stored.model);
  // A brand-new id is the row as read.
  assert.deepEqual(mergeCsvRow(undefined, items[0]!, columns), items[0]);
  // A full export round-trips through the merge unchanged.
  const full = catalogueFromCsv(catalogueToCsv([stored]));
  assert.deepEqual(mergeCsvRow(stored, full.items[0]!, full.columns), stored);
});

/* ------------------------------------------------------------------ */
/* Seed merge and validation                                           */
/* ------------------------------------------------------------------ */

test("loading the researched seed keeps what's already there unless told to overwrite", () => {
  const priced = { ...RESEARCHED_CATALOGUE[0]!, costPence: 50_000 };
  const keep = planSeedMerge([priced], RESEARCHED_CATALOGUE, false);
  assert.equal(keep.added, RESEARCHED_CATALOGUE.length - 1);
  assert.equal(keep.kept, 1);
  assert.ok(!keep.upserts.some((i) => i.id === priced.id));
  const replace = planSeedMerge([priced], RESEARCHED_CATALOGUE, true);
  assert.equal(replace.replaced, 1);
  assert.equal(replace.upserts.find((i) => i.id === priced.id)!.costPence, null);
});

test("a researched retail price counts as ours only once someone has changed it", () => {
  const seed = new Map(RESEARCHED_CATALOGUE.map((i) => [i.id, i]));
  const pricedSeed = RESEARCHED_CATALOGUE.filter((i) => i.costPence !== null);
  assert.ok(pricedSeed.length >= 6, "the seed carries the research's retail prices");
  const sensira = pricedSeed.find((i) => i.kind === "indoor" && i.tier === "standard")!;
  // Straight from the seed: still the research's price.
  assert.equal(stillResearchPrice(sensira, seed), true);
  // A new trade price, a new supplier, or a new date seen: ours.
  assert.equal(stillResearchPrice({ ...sensira, costPence: sensira.costPence! - 1 }, seed), false);
  assert.equal(stillResearchPrice({ ...sensira, costSource: { ...sensira.costSource, supplier: "DEMO Trade Supplier" } }, seed), false);
  assert.equal(stillResearchPrice({ ...sensira, costSource: { ...sensira.costSource, observedAt: "2026-10-19" } }, seed), false);
  // Unpriced, not in the seed, or unpriced in the seed: never a research price.
  assert.equal(stillResearchPrice({ ...sensira, costPence: null }, seed), false);
  assert.equal(stillResearchPrice({ ...sensira, id: "my-own-unit" }, seed), false);
  const unpricedSeed = RESEARCHED_CATALOGUE.find((i) => i.costPence === null)!;
  assert.equal(stillResearchPrice({ ...unpricedSeed, costPence: 12_000 }, seed), false);
});

test("rule and item validation says what's wrong in plain words", () => {
  assert.deepEqual(compatibilityRuleErrors(duo), []);
  const bad = compatibilityRuleErrors({ ...duo, outdoorModel: " ", maxIndoorUnits: 0, connectableIndoorModels: [], connectableIndoorSeries: [], minConnectedKw: 9, maxConnectedKw: 4, source: null });
  assert.equal(bad.length, 5);
  assert.deepEqual(catalogueItemErrors(item("panasonic-cs-z25ckew")), []);
  const worse = catalogueItemErrors({ ...item("panasonic-cs-z25ckew"), id: "bad id", label: "", costPence: -1, model: "", sources: [] });
  assert.equal(worse.length, 5);
});

/* ------------------------------------------------------------------ */
/* The generated research module                                      */
/* ------------------------------------------------------------------ */

test("catalogue-data.ts is the research JSON, honestly mapped (regenerate with build-catalogue-data.mjs)", () => {
  const seed = JSON.parse(readFileSync(new URL("../../../docs/research/data/catalogue-seed.json", import.meta.url), "utf8"));
  assert.equal(RESEARCHED_CATALOGUE.length, seed.items.length + seed.materials.length);
  assert.equal(RESEARCHED_COMPATIBILITY.length, seed.compatibility.length);
  assert.deepEqual(RESEARCH_CAVEATS, seed.caveats);
  for (const raw of seed.items) {
    const it = item(raw.id);
    assert.equal(it.costPence, raw.costPence, raw.id);
    assert.equal(it.confidence, raw.confidence, raw.id);
    assert.equal(it.model, raw.model);
    assert.equal(it.verifiedAt, raw.confidence === "verified" ? "2026-10-18" : undefined, raw.id);
  }
  // Only six priced items; every material and tool unpriced; every multi-split rule provisional.
  assert.equal(RESEARCHED_CATALOGUE.filter((i) => i.costPence !== null).length, 6);
  assert.ok(RESEARCHED_CATALOGUE.filter((i) => i.kind === "material" || i.kind === "tool").every((i) => i.costPence === null));
  assert.ok(RESEARCHED_COMPATIBILITY.every((r) => r.confidence === "provisional"));
  // The superseded and unconfirmed models say so.
  assert.equal(item("mitsubishi-electric-msz-ap35vgk").status, "uncertain");
  assert.equal(item("daikin-ftxj25a2v1bw").status, "uncertain");
  assert.equal(item("panasonic-cs-tz35ckew").status, "available");
  // Customer lines only claim what the research found.
  assert.equal(item("panasonic-cs-z25ckew").customerBlurb, "As quiet as 19 dB(A) on its lowest setting, with Wi-Fi app control built in.");
  assert.equal(item("mitsubishi-electric-msz-hr25vf").customerBlurb, "As quiet as 21 dB(A) on its lowest setting.");
  assert.ok(RESEARCHED_CATALOGUE.every((i) => i.sources.every((s) => /^https?:\/\//.test(s.url))));
  assert.equal(new Set(RESEARCHED_CATALOGUE.map((i) => i.id)).size, RESEARCHED_CATALOGUE.length);
});

test("DEMO data is labelled DEMO everywhere, and its first nineteen ids match the web demo seed", () => {
  assert.ok(DEMO_CATALOGUE.every((i) => i.id.startsWith("demo-") && i.label.includes("(DEMO)") && i.confidence === "provisional"));
  const seed = readFileSync(new URL("../../../apps/web/lib/demo-seed/catalogue.ts", import.meta.url), "utf8");
  const seedIds = [...seed.matchAll(/id: "(demo-(?:ind|out|mat)-[a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(DEMO_CATALOGUE.slice(0, seedIds.length).map((i) => i.id), seedIds);
  assert.ok(DEMO_COMPATIBILITY.every((r) => r.source?.title?.includes("DEMO")));
});
