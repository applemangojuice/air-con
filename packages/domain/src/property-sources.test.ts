import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyProperty, emptyConstraints, emptyMarketing, emptyPlanning, prefillFromIntel, type PropertyIntel } from "./intelligence.ts";
import {
  addressLineFrom,
  boundingBox,
  constraintsAtPoint,
  epcBulkRow,
  parsePlanningAreas,
  parsePostcodesBulk,
  planningAreasUrl,
  pointInArea,
  postcodesBulkRequest,
  epcCertificateUrl,
  epcFromCertificate,
  epcSearchUrl,
  intelFromSearchHit,
  latestHitPerAddress,
  lookupNeeds,
  mergeLookedUp,
  normaliseEpcDate,
  normaliseRating,
  normaliseUprn,
  parseEpcSearch,
  parsePlanningConstraints,
  parsePostcodeLookup,
  planningConstraintsUrl,
  postcodeLookupUrl,
  withCertificate,
  withConstraints,
  withPoint,
} from "./property-sources.ts";

const NOW = "2026-10-21T12:00:00.000Z";

/** The shape of GET /api/domestic/search (the service's OpenAPI example, three homes). */
const SEARCH = {
  data: [
    {
      addressLine1: "12 Larkhall Rise",
      addressLine2: null,
      uprn: 100023336956,
      certificateNumber: "0000-0000-0000-0000-0001",
      council: "Lambeth",
      currentEnergyEfficiencyBand: "d",
      postcode: "SW16 2QT",
      registrationDate: "2019-03-02",
      schemaType: "RdSAP-Schema-18.0",
    },
    {
      addressLine1: "12 Larkhall Rise",
      uprn: 100023336956,
      certificateNumber: "0000-0000-0000-0000-0002",
      currentEnergyEfficiencyBand: "c",
      postcode: "SW16 2QT",
      registrationDate: "2024-06-11",
    },
    {
      addressLine1: "Flat 2",
      addressLine2: "14 Larkhall Rise",
      addressLine3: "Streatham",
      uprn: null,
      certificateNumber: "0000-0000-0000-0000-0003",
      currentEnergyEfficiencyBand: "e",
      postcode: "sw16 2qt",
      registrationDate: "2022-01-05",
    },
    { addressLine1: "", certificateNumber: "0000-0000-0000-0000-0004", postcode: "SW16 2QT" },
  ],
  pagination: { totalRecords: 4, currentPage: 1, totalPages: 1, nextPage: null, prevPage: null, pageSize: 500 },
};

/** The shape of GET /api/certificate (the warehouse's JSON export of an RdSAP certificate, trimmed). */
const CERTIFICATE = {
  data: {
    assessment_id: "0000-0000-0000-0000-0002",
    address: { address_id: "UPRN-000100023336956", address_line1: "12 Larkhall Rise", postcode: "SW16 2QT" },
    built_form: { description: "Semi-Detached", value: "2" },
    construction_age_band: { description: "England and Wales: 1930-1949", value: "C" },
    current_energy_efficiency_band: "c",
    potential_energy_efficiency_band: "b",
    date_of_registration: "2024-06-11",
    habitable_room_count: 5,
    hot_water_description: "From main system",
    main_heating_descriptions: ["Boiler and radiators, mains gas"],
    property_summary: [
      { name: "wall", description: "Cavity wall, as built, no insulation (assumed)", energy_efficiency_rating: 2 },
      { name: "roof", description: "Pitched, 270 mm loft insulation", energy_efficiency_rating: 4 },
    ],
    property_type: { description: "House", value: "0" },
    total_floor_area: 104.0,
    window_description: "Fully double glazed",
  },
};

test("search: one row per certificate, addresses joined like the importer, junk rows dropped", () => {
  const hits = parseEpcSearch(SEARCH);
  assert.equal(hits.length, 3);
  assert.deepEqual(hits[2], {
    certificateNumber: "0000-0000-0000-0000-0003",
    line1: "Flat 2, 14 Larkhall Rise",
    postcode: "SW16 2QT",
    uprn: undefined,
    registeredAt: "2022-01-05",
    band: "E",
  });
  assert.equal(hits[0]!.uprn, "100023336956");
  assert.deepEqual(parseEpcSearch(null), []);
  assert.deepEqual(parseEpcSearch({ data: "nope" }), []);
});

test("search: the newest certificate per home wins, sorted by house number", () => {
  const latest = latestHitPerAddress(parseEpcSearch(SEARCH));
  assert.deepEqual(
    latest.map((h) => [h.line1, h.certificateNumber]),
    [
      ["12 Larkhall Rise", "0000-0000-0000-0000-0002"],
      ["Flat 2, 14 Larkhall Rise", "0000-0000-0000-0000-0003"],
    ],
  );
});

test("a search hit becomes a summary record keyed on its UPRN, waiting for its certificate", () => {
  const hit = latestHitPerAddress(parseEpcSearch(SEARCH))[0]!;
  const intel = intelFromSearchHit(hit, NOW);
  assert.equal(intel.id, "100023336956");
  assert.equal(intel.address.outcode, "SW16");
  assert.equal(intel.epc?.currentRating, "C");
  assert.equal(intel.sources?.epc?.detail, "summary");
  assert.deepEqual(lookupNeeds(intel), { epcDetail: true, geo: true, constraints: true, any: true });
  // No UPRN: the same synthetic id the importer would give it.
  const flat = intelFromSearchHit(latestHitPerAddress(parseEpcSearch(SEARCH))[1]!, NOW);
  assert.match(flat.id, /^addr-/);
});

test("certificate: the new service's coded JSON reads as the profile the classifier needs", () => {
  const epc = epcFromCertificate(CERTIFICATE)!;
  assert.equal(epc.propertyType, "House");
  assert.equal(epc.builtForm, "Semi-Detached");
  assert.equal(epc.constructionAgeBand, "England and Wales: 1930-1949");
  assert.equal(epc.totalFloorAreaM2, 104);
  assert.equal(epc.habitableRooms, 5);
  assert.equal(epc.wallDescription, "Cavity wall, as built, no insulation (assumed)");
  assert.equal(epc.mainHeatDescription, "Boiler and radiators, mains gas");
  assert.equal(epc.currentRating, "C");
  assert.equal(epc.lodgedAt, "2024-06-11");
  assert.equal(epc.certificateNumber, "0000-0000-0000-0000-0002");

  const base = intelFromSearchHit(latestHitPerAddress(parseEpcSearch(SEARCH))[0]!, NOW);
  const full = withCertificate(base, epc, NOW);
  assert.equal(full.sources?.epc?.detail, "full");
  assert.equal(lookupNeeds(full).epcDetail, false);
  const prefill = prefillFromIntel(full);
  assert.deepEqual(prefill, { type: "semi-detached", era: "1930-1950", bedrooms: 3, floorAreaM2: 104 });
  assert.ok(classifyProperty(full).archetypeId, "classifies to an archetype");
});

test("certificate: codes without descriptions, bulk CSV rows and the retired API's kebab-case all parse", () => {
  const codesOnly = epcFromCertificate({ data: { property_type: "2", built_form: "4", property_age_band: "B", total_floor_area: "61" } })!;
  assert.equal(codesOnly.propertyType, "Flat");
  assert.equal(codesOnly.builtForm, "Mid-Terrace");
  assert.equal(codesOnly.constructionAgeBand, "England and Wales: 1900-1929");
  assert.equal(codesOnly.totalFloorAreaM2, 61);

  const csvRow = epcFromCertificate({
    PROPERTY_TYPE: "House",
    BUILT_FORM: "Mid-Terrace",
    CONSTRUCTION_AGE_BAND: "England and Wales: before 1900",
    TOTAL_FLOOR_AREA: "92",
    NUMBER_HABITABLE_ROOMS: "5",
    CURRENT_ENERGY_RATING: "e",
    LODGEMENT_DATE: "22/02/2021",
  })!;
  assert.equal(csvRow.builtForm, "Mid-Terrace");
  assert.equal(csvRow.currentRating, "E");
  assert.equal(csvRow.lodgedAt, "2021-02-22");

  const kebab = epcFromCertificate({ "property-type": "Bungalow", "built-form": "Detached", "total-floor-area": "70", "lmk-key": "abc" })!;
  assert.equal(kebab.propertyType, "Bungalow");
  assert.equal(kebab.certificateNumber, "abc");

  assert.equal(epcFromCertificate({ data: { error: "Certificate not found" } }), undefined);
  assert.equal(epcFromCertificate("nonsense"), undefined);
});

test("normalisers: dates, UPRNs and bands from every source", () => {
  assert.equal(normaliseEpcDate("2021-02-22T00:00:00Z"), "2021-02-22");
  assert.equal(normaliseEpcDate("2/3/2021"), "2021-03-02");
  assert.equal(normaliseEpcDate("soon"), undefined);
  assert.equal(normaliseUprn("UPRN-000100023336956"), "100023336956");
  assert.equal(normaliseUprn(100023336956), "100023336956");
  assert.equal(normaliseUprn("UPRN-000000000000"), undefined);
  assert.equal(normaliseRating("b"), "B");
  assert.equal(normaliseRating("Z"), undefined);
  assert.equal(addressLineFrom("Flat 2", null, "14 Road"), "Flat 2, 14 Road");
});

test("URLs: postcode formatted, certificate escaped, constraint datasets listed", () => {
  assert.equal(
    epcSearchUrl("sw162qt"),
    "https://api.get-energy-performance-data.communities.gov.uk/api/domestic/search?postcode=SW16+2QT&page_size=500",
  );
  assert.match(epcCertificateUrl("0000-0000-0000-0000-0002"), /certificate_number=0000-0000-0000-0000-0002$/);
  assert.equal(postcodeLookupUrl("sw16 2qt"), "https://api.postcodes.io/postcodes/SW162QT");
  const url = new URL(planningConstraintsUrl({ latitude: 51.4278, longitude: -0.1282 }));
  assert.deepEqual(url.searchParams.getAll("dataset"), ["conservation-area", "article-4-direction-area", "listed-building-outline"]);
  assert.equal(url.searchParams.get("latitude"), "51.427800");
});

test("postcodes.io and planning data answers", () => {
  assert.deepEqual(parsePostcodeLookup({ status: 200, result: { latitude: 51.42, longitude: -0.13, admin_district: "Lambeth" } }), {
    latitude: 51.42,
    longitude: -0.13,
    district: "Lambeth",
  });
  assert.equal(parsePostcodeLookup({ status: 404, error: "Postcode not found" }), undefined);

  const found = parsePlanningConstraints({
    entities: [
      { dataset: "conservation-area", name: "Streatham Common", reference: "CA12" },
      { dataset: "article-4-direction-area", name: "", reference: "A4-3" },
    ],
    count: 2,
  })!;
  assert.deepEqual(found.constraints, { conservationArea: true, listedBuilding: false, article4: true });
  assert.deepEqual(found.names, ["Conservation area: Streatham Common", "Article 4 direction: A4-3"]);
  assert.deepEqual(parsePlanningConstraints({ entities: [], count: 0 })!.constraints, emptyConstraints());
  assert.equal(parsePlanningConstraints({ detail: "error" }), undefined);
});

test("constraints only add; geo and constraints are recorded so they're fetched once", () => {
  const intel = intelFromSearchHit(latestHitPerAddress(parseEpcSearch(SEARCH))[0]!, NOW);
  intel.constraints.listedBuilding = true; // say an import flagged it
  const point = withPoint(intel, { latitude: 51.4, longitude: -0.1 }, NOW);
  const checked = withConstraints(point, { constraints: emptyConstraints(), names: [] }, NOW);
  assert.equal(checked.constraints.listedBuilding, true);
  assert.equal(classifyProperty(checked).planningRisk, "high");
  const needs = lookupNeeds(checked);
  assert.equal(needs.geo, false);
  assert.equal(needs.constraints, false);
});

test("merge: the book's id, audit and marketing survive; a newer certificate replaces an older summary", () => {
  const existing: PropertyIntel = {
    id: "addr-legacy-12larkhall",
    address: { line1: "12 Larkhall Rise", postcode: "SW16 2QT", outcode: "SW16" },
    epc: { propertyType: "House", builtForm: "Semi-Detached", lodgedAt: "2019-03-02", certificateNumber: "0000-0000-0000-0000-0001" },
    planning: { ...emptyPlanning(), loftConversion: true },
    constraints: emptyConstraints(),
    marketing: { ...emptyMarketing(), leadStatus: "mailed", campaign: "spring" },
    audit: { difficulty: "standard", confidence: 90, auditedAt: NOW, auditor: "MH" },
  };
  const fresh = intelFromSearchHit(latestHitPerAddress(parseEpcSearch(SEARCH))[0]!, NOW);
  const merged = mergeLookedUp(existing, fresh);
  assert.equal(merged.id, "addr-legacy-12larkhall");
  assert.equal(merged.uprn, "100023336956");
  assert.equal(merged.planning.loftConversion, true);
  assert.equal(merged.marketing.campaign, "spring");
  assert.ok(merged.audit);
  // 2024 certificate is newer than the 2019 one: the old profile goes, the new certificate is fetched.
  assert.equal(merged.epc?.certificateNumber, "0000-0000-0000-0000-0002");
  assert.equal(lookupNeeds(merged).epcDetail, true);

  // Same certificate seen again: nothing known is lost, and an imported full profile isn't marked "summary".
  const same = mergeLookedUp({ ...existing, epc: { ...existing.epc, certificateNumber: "0000-0000-0000-0000-0002", lodgedAt: "2024-06-11" } }, fresh);
  assert.equal(same.epc?.propertyType, "House");
  assert.equal(same.sources?.epc, undefined);
  assert.equal(lookupNeeds(same).epcDetail, false);

  assert.equal(mergeLookedUp(undefined, fresh), fresh);
});

test("bulk CSV rows: one home per row, keyed on UPRN or address, dates and bands normalised", () => {
  const row = epcBulkRow({
    CERTIFICATE_NUMBER: "1234-5678",
    ADDRESS1: "Flat 2",
    ADDRESS2: "14 Larkhall Rise",
    POSTCODE: "sw162qt",
    UPRN: "UPRN-000100023336957",
    PROPERTY_TYPE: "Flat",
    BUILT_FORM: "Mid-Terrace",
    CONSTRUCTION_AGE_BAND: "England and Wales: 1900-1929",
    TOTAL_FLOOR_AREA: "61",
    CURRENT_ENERGY_RATING: "d",
    LODGEMENT_DATE: "03/07/2022",
  })!;
  assert.equal(row.key, "uprn:100023336957");
  assert.equal(row.line1, "Flat 2, 14 Larkhall Rise");
  assert.equal(row.postcode, "SW16 2QT");
  assert.equal(row.lodgedAt, "2022-07-03");
  assert.equal(row.epc.builtForm, "Mid-Terrace");
  assert.equal(row.epc.currentRating, "D");
  assert.equal(row.epc.certificateNumber, "1234-5678");
  assert.equal(epcBulkRow({ CERTIFICATE_NUMBER: "x", POSTCODE: "SW16 2QT" }), undefined, "no address");
  assert.match(epcBulkRow({ ADDRESS1: "1 Road", POSTCODE: "SW16 2QT" })!.key, /^1 ROAD SW162QT$/);
});

test("postcodes.io bulk: request body capped at 100, answers keyed by formatted postcode", () => {
  const req = postcodesBulkRequest(Array.from({ length: 150 }, (_, i) => `sw16 ${i % 9}aa`));
  assert.equal(req.url, "https://api.postcodes.io/postcodes");
  assert.equal(JSON.parse(req.body).postcodes.length, 100);
  const points = parsePostcodesBulk({
    status: 200,
    result: [
      { query: "sw162qt", result: { latitude: 51.42, longitude: -0.13, admin_district: "Lambeth" } },
      { query: "ZZ1 1ZZ", result: null },
    ],
  });
  assert.deepEqual([...points.keys()], ["SW16 2QT"]);
  assert.equal(points.get("SW16 2QT")!.district, "Lambeth");
});

/** A square conservation area with a square hole in it, plus an Article 4 area elsewhere. */
const AREAS = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [[-0.14, 51.42], [-0.12, 51.42], [-0.12, 51.44], [-0.14, 51.44], [-0.14, 51.42]],
          [[-0.135, 51.425], [-0.13, 51.425], [-0.13, 51.43], [-0.135, 51.43], [-0.135, 51.425]],
        ],
      },
      properties: { entity: "44001", dataset: "conservation-area", name: "Streatham Common" },
    },
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [[[[-0.2, 51.5], [-0.19, 51.5], [-0.19, 51.51], [-0.2, 51.51], [-0.2, 51.5]]]] },
      properties: { entity: "77002", dataset: "article-4-direction-area", name: "Clapham" },
    },
    { type: "Feature", geometry: { type: "Point", coordinates: [-0.1, 51.4] }, properties: { entity: "1", dataset: "listed-building", name: "A point" } },
  ],
};

test("planning areas: shapes parsed once, points matched locally, holes respected", () => {
  const areas = parsePlanningAreas(AREAS);
  assert.equal(areas.length, 2, "points are skipped: only areas can contain a postcode");
  const inside = { latitude: 51.435, longitude: -0.125 };
  const inHole = { latitude: 51.4275, longitude: -0.1325 };
  const outside = { latitude: 51.45, longitude: -0.125 };
  assert.equal(pointInArea(inside, areas[0]!), true);
  assert.equal(pointInArea(inHole, areas[0]!), false);
  assert.equal(pointInArea(outside, areas[0]!), false);
  assert.deepEqual(constraintsAtPoint(areas, inside), {
    constraints: { conservationArea: true, listedBuilding: false, article4: false },
    names: ["Conservation area: Streatham Common"],
  });
  assert.equal(constraintsAtPoint(areas, { latitude: 51.505, longitude: -0.195 }).constraints.article4, true);
  assert.deepEqual(parsePlanningAreas({ nope: 1 }), []);
});

test("bounding box and the area query", () => {
  const box = boundingBox([{ latitude: 51.42, longitude: -0.13 }, { latitude: 51.44, longitude: -0.11 }], 0.01)!;
  assert.deepEqual(box.map((v) => Math.round(v * 1000) / 1000), [-0.14, 51.41, -0.1, 51.45]);
  assert.equal(boundingBox([]), undefined);
  const url = new URL(planningAreasUrl(box, 500));
  assert.equal(url.pathname, "/entity.geojson");
  assert.equal(url.searchParams.get("geometry_relation"), "intersects");
  assert.match(url.searchParams.get("geometry")!, /^POLYGON\(\(-0\.140000 51\.410000,/);
  assert.equal(url.searchParams.get("offset"), "500");
});
