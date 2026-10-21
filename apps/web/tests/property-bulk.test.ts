import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyConstraints, emptyMarketing, emptyPlanning, lookupNeeds, propertyRow, type PropertyIntel } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { createLocalClient } = await import("../lib/db/local-client.ts");
const { enrichBook } = await import("../lib/property-bulk.ts");

const NOW = () => new Date("2026-10-21T12:00:00.000Z");

/** An imported home: full EPC profile, no location or planning check yet. */
function home(n: number, postcode: string): PropertyIntel {
  return {
    id: `1000${n}`,
    uprn: `1000${n}`,
    address: { line1: `${n} Larkhall Rise`, postcode, outcode: postcode.split(" ")[0]! },
    epc: { propertyType: "House", builtForm: "Mid-Terrace", constructionAgeBand: "England and Wales: 1900-1929", totalFloorAreaM2: 90, habitableRooms: 5 },
    planning: emptyPlanning(),
    constraints: emptyConstraints(),
    marketing: emptyMarketing(),
  };
}

const POINTS: Record<string, { latitude: number; longitude: number; admin_district: string }> = {
  "SW16 2QT": { latitude: 51.435, longitude: -0.125, admin_district: "Lambeth" }, // inside the conservation area
  "SW16 3AB": { latitude: 51.45, longitude: -0.125, admin_district: "Lambeth" }, // outside
  "SW17 1AA": { latitude: 51.43, longitude: -0.16, admin_district: "Wandsworth" },
};

const CONSERVATION = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[-0.14, 51.42], [-0.12, 51.42], [-0.12, 51.44], [-0.14, 51.44], [-0.14, 51.42]]] },
      properties: { entity: "44001", dataset: "conservation-area", name: "Streatham Common" },
    },
  ],
};

function fakeNetwork(opts: { planningDown?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${new URL(url).host}${new URL(url).pathname}`);
    if (url.includes("postcodes.io")) {
      const { postcodes } = JSON.parse(String(init?.body)) as { postcodes: string[] };
      return Response.json({ status: 200, result: postcodes.map((q) => ({ query: q, result: POINTS[q] ?? null })) });
    }
    if (url.includes("planning.data.gov.uk")) {
      if (opts.planningDown) return new Response("down", { status: 503 });
      return Response.json(CONSERVATION);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

async function seed(homes: PropertyIntel[]) {
  const db = createLocalClient({ backend: "memory" });
  await db.from("properties").upsert(homes.map((h) => propertyRow(h, NOW().toISOString())));
  return db;
}

test("a borough's worth in a handful of requests: postcodes in bulk, areas once per outcode", async () => {
  const homes = [
    ...Array.from({ length: 150 }, (_, i) => home(i, i % 2 ? "SW16 2QT" : "SW16 3AB")),
    home(900, "SW17 1AA"),
    home(901, "SW17 9ZZ"), // a postcode postcodes.io doesn't know
  ];
  const db = await seed(homes);
  const net = fakeNetwork();
  const report = await enrichBook(db, {}, { fetcher: net.fetcher, now: NOW });

  assert.equal(report.needed, 152);
  assert.equal(report.located, 151);
  assert.equal(report.checked, 151);
  assert.deepEqual(report.postcodesNotFound, ["SW17 9ZZ"]);
  // 4 distinct postcodes → 1 postcodes.io request; 2 outcodes located → 2 planning requests.
  assert.equal(net.calls.filter((c) => c.startsWith("POST api.postcodes.io")).length, 1);
  assert.equal(net.calls.filter((c) => c.includes("planning.data.gov.uk")).length, 2);

  const { data } = await db.from("properties").select("id, planning_risk, intel").in("id", ["10001", "10000", "1000900"]);
  const byId = new Map((data ?? []).map((r) => [r.id as string, r as { planning_risk: string; intel: PropertyIntel }]));
  assert.equal(byId.get("10001")!.planning_risk, "check", "SW16 2QT is inside the conservation area");
  assert.deepEqual(byId.get("10001")!.intel.sources?.constraints?.names, ["Conservation area: Streatham Common"]);
  assert.equal(byId.get("10000")!.planning_risk, "none");
  assert.equal(byId.get("10000")!.intel.sources?.geo?.district, "Lambeth");
  assert.equal(lookupNeeds(byId.get("10000")!.intel).any, false, "picking this home on the quote form now needs no outside call");
});

test("a second run has nothing to do; --recheck does it again", async () => {
  const db = await seed([home(1, "SW16 2QT")]);
  await enrichBook(db, {}, { fetcher: fakeNetwork().fetcher, now: NOW });
  const net = fakeNetwork();
  const again = await enrichBook(db, {}, { fetcher: net.fetcher, now: NOW });
  assert.equal(again.needed, 0);
  assert.equal(net.calls.length, 0);
  const re = await enrichBook(db, { recheck: true }, { fetcher: net.fetcher, now: NOW });
  assert.equal(re.checked, 1);
});

test("planning data down: homes are located, the constraint check waits for the next run", async () => {
  const db = await seed([home(1, "SW16 2QT")]);
  const report = await enrichBook(db, {}, { fetcher: fakeNetwork({ planningDown: true }).fetcher, now: NOW });
  assert.deepEqual(report.outcodesWithoutConstraints, ["SW16"]);
  const { data } = await db.from("properties").select("intel").eq("id", "10001").single();
  const intel = (data as { intel: PropertyIntel }).intel;
  assert.ok(intel.sources?.geo);
  assert.equal(intel.sources?.constraints, undefined);
  assert.equal(lookupNeeds(intel).constraints, true);
});

test("--outcodes keeps it to those districts", async () => {
  const db = await seed([home(1, "SW16 2QT"), home(2, "SW17 1AA")]);
  const report = await enrichBook(db, { outcodes: ["sw17"] }, { fetcher: fakeNetwork().fetcher, now: NOW });
  assert.equal(report.scanned, 1);
  assert.equal(report.located, 1);
});
