import { test } from "node:test";
import assert from "node:assert/strict";
import type { PropertyIntel } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { createLocalClient } = await import("../lib/db/local-client.ts");
const { lookupPostcode, enrichAndStore, epcBearerToken, searchEpcByPostcode } = await import("../lib/property-lookup.ts");
const { markPropertyQuoted } = await import("../lib/intel-server.ts");

const NOW = () => new Date("2026-10-21T12:00:00.000Z");

/** A fake network: answers by host and path, and records every call. */
function fakeNetwork(overrides: Partial<Record<"search" | "certificate" | "postcode" | "planning", { status: number; json: unknown } | "down">> = {}) {
  const calls: { url: string; auth?: string }[] = [];
  const answers = {
    search: {
      status: 200,
      json: {
        data: [
          { addressLine1: "12 Larkhall Rise", uprn: 100023336956, certificateNumber: "1111-1111-1111-1111-1111", currentEnergyEfficiencyBand: "d", postcode: "SW16 2QT", registrationDate: "2024-06-11" },
          { addressLine1: "14 Larkhall Rise", uprn: 100023336957, certificateNumber: "2222-2222-2222-2222-2222", currentEnergyEfficiencyBand: "e", postcode: "SW16 2QT", registrationDate: "2021-02-01" },
        ],
        pagination: { totalRecords: 2, currentPage: 1, totalPages: 1 },
      },
    },
    certificate: {
      status: 200,
      json: {
        data: {
          assessment_id: "1111-1111-1111-1111-1111",
          property_type: { description: "House", value: "0" },
          built_form: { description: "Mid-Terrace", value: "4" },
          construction_age_band: { description: "England and Wales: 1900-1929", value: "B" },
          total_floor_area: 96,
          habitable_room_count: 5,
          current_energy_efficiency_band: "d",
          date_of_registration: "2024-06-11",
        },
      },
    },
    postcode: { status: 200, json: { status: 200, result: { latitude: 51.4278, longitude: -0.1282, admin_district: "Lambeth" } } },
    planning: { status: 200, json: { entities: [{ dataset: "conservation-area", name: "Streatham Hill", reference: "CA42" }], count: 1 } },
    ...overrides,
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, auth });
    const which = url.includes("/api/domestic/search")
      ? "search"
      : url.includes("/api/certificate")
        ? "certificate"
        : url.includes("postcodes.io")
          ? "postcode"
          : url.includes("planning.data.gov.uk")
            ? "planning"
            : null;
    const answer = which ? answers[which] : { status: 404, json: null };
    if (answer === "down") throw new Error("connect ETIMEDOUT");
    return new Response(JSON.stringify(answer.json), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, calls };
}

test("a postcode the book doesn't know: one EPC search, homes saved, newest certificate each", async () => {
  const db = createLocalClient({ backend: "memory" });
  const net = fakeNetwork();
  const found = await lookupPostcode(db, "sw16 2qt", { fetcher: net.fetcher, token: "tok", now: NOW });
  assert.deepEqual(
    found.map((p) => [p.id, p.address.line1, p.epc?.currentRating]),
    [
      ["100023336956", "12 Larkhall Rise", "D"],
      ["100023336957", "14 Larkhall Rise", "E"],
    ],
  );
  assert.equal(net.calls.length, 1, "only the search: certificates wait until a home is picked");
  assert.equal(net.calls[0]!.auth, "Bearer tok");
  assert.match(net.calls[0]!.url, /postcode=SW16\+2QT/);

  const { data } = await db.from("properties").select("id, postcode, outcode, epc_rating, lead_status").order("id");
  assert.equal(data?.length, 2);
  assert.equal(data?.[0]?.outcode, "SW16");
  const { data: log } = await db.from("property_assessments").select("property_id, source");
  assert.equal(log?.length, 2);
  assert.equal(log?.[0]?.source, "live-lookup");
});

test("picking a home fills in its certificate, postcode centre and constraints, once", async () => {
  const db = createLocalClient({ backend: "memory" });
  const net = fakeNetwork();
  const [home] = await lookupPostcode(db, "SW16 2QT", { fetcher: net.fetcher, token: "tok", now: NOW });
  const full = await enrichAndStore(db, home!, { fetcher: net.fetcher, token: "tok", now: NOW });
  assert.equal(full.epc?.builtForm, "Mid-Terrace");
  assert.equal(full.epc?.totalFloorAreaM2, 96);
  assert.equal(full.sources?.epc?.detail, "full");
  assert.equal(full.sources?.geo?.district, "Lambeth");
  assert.equal(full.constraints.conservationArea, true);
  assert.deepEqual(full.sources?.constraints?.names, ["Conservation area: Streatham Hill"]);

  const { data } = await db.from("properties").select("archetype_id, planning_risk, floor_area_m2").eq("id", full.id).single();
  assert.equal(data?.planning_risk, "check");
  assert.equal(data?.floor_area_m2, 96);
  assert.ok(data?.archetype_id, "classified on save");

  const before = net.calls.length;
  await enrichAndStore(db, full, { fetcher: net.fetcher, token: "tok", now: NOW });
  assert.equal(net.calls.length, before, "nothing left to fetch: no calls");
});

test("services down or unset: nothing breaks, nothing is invented", async () => {
  const db = createLocalClient({ backend: "memory" });
  assert.deepEqual(await lookupPostcode(db, "SW16 2QT", { fetcher: fakeNetwork().fetcher, token: undefined }), [], "no token, no lookup");
  assert.equal(await searchEpcByPostcode("SW16 2QT", { fetcher: fakeNetwork({ search: "down" }).fetcher, token: "t" }), null);
  assert.equal(await searchEpcByPostcode("SW16 2QT", { fetcher: fakeNetwork({ search: { status: 401, json: {} } }).fetcher, token: "t" }), null);

  // Certificate and planning down: the summary record stands, the postcode centre is still learned.
  const net = fakeNetwork({ certificate: "down", planning: { status: 500, json: null } });
  const [home] = await lookupPostcode(db, "SW16 2QT", { fetcher: net.fetcher, token: "tok", now: NOW });
  const after = await enrichAndStore(db, home!, { fetcher: net.fetcher, token: "tok", now: NOW });
  assert.equal(after.epc?.builtForm, undefined);
  assert.equal(after.sources?.epc?.detail, "summary", "still waiting for its certificate");
  assert.ok(after.sources?.geo);
  assert.equal(after.sources?.constraints, undefined, "constraints will be tried again");
});

test("a later lookup keeps what the book already knew (audit, campaign) under the same id", async () => {
  const db = createLocalClient({ backend: "memory" });
  const net = fakeNetwork();
  const [home] = await lookupPostcode(db, "SW16 2QT", { fetcher: net.fetcher, token: "tok", now: NOW });
  const audited: PropertyIntel = {
    ...home!,
    marketing: { leadStatus: "mailed", campaign: "spring-letters" },
    audit: { difficulty: "standard", confidence: 85, auditedAt: "2026-09-01T00:00:00.000Z", auditor: "MH" },
  };
  await db.from("properties").update({ intel: audited, lead_status: "mailed" }).eq("id", home!.id);
  const again = await lookupPostcode(db, "SW16 2QT", { fetcher: net.fetcher, token: "tok", now: NOW });
  const same = again.find((p) => p.id === home!.id)!;
  assert.equal(same.marketing.campaign, "spring-letters");
  assert.equal(same.audit?.auditor, "MH");
});

test("a quote marks the home it was for as quoted, and only that home", async () => {
  const db = createLocalClient({ backend: "memory" });
  const [home] = await lookupPostcode(db, "SW16 2QT", { fetcher: fakeNetwork().fetcher, token: "tok", now: NOW });
  assert.equal(await markPropertyQuoted(db, home!.id, { postcode: "SW16 9ZZ", addressLine: "12 Larkhall Rise" }), false);
  assert.equal(await markPropertyQuoted(db, home!.id, { postcode: "SW16 2QT", addressLine: "99 Other Road" }), false);
  assert.equal(await markPropertyQuoted(db, home!.id, { postcode: "sw162qt", addressLine: "12 Larkhall Rise" }), true);
  const { data } = await db.from("properties").select("lead_status").eq("id", home!.id).single();
  assert.equal(data?.lead_status, "quoted");
});

test("the token is read from EPC_BEARER_TOKEN, and a template value counts as unset", () => {
  assert.equal(epcBearerToken({ EPC_BEARER_TOKEN: "abc123" }), "abc123");
  assert.equal(epcBearerToken({ EPC_BEARER_TOKEN: "your-epc-token" }), undefined);
  assert.equal(epcBearerToken({}), undefined);
});
