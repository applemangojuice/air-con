import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { addressProvider, lookupAddresses, osFirstLine, titleCase } = await import("../lib/address-provider.ts");

type Call = { url: string; init?: unknown };

function fakeFetch(pages: { status?: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: unknown) => {
    calls.push({ url, init });
    const page = pages[Math.min(calls.length - 1, pages.length - 1)];
    return new Response(JSON.stringify(page.body ?? {}), { status: page.status ?? 200 });
  };
  return { fetcher, calls };
}

const dpa = (fields: Record<string, string>) => ({ DPA: { POST_TOWN: "LONDON", POSTCODE: "SW16 2BE", ...fields } });

test("title case keeps numbers, flat letters and apostrophes right", () => {
  assert.equal(titleCase("FLAT 2A, ST. JOHN'S COURT"), "Flat 2A, St. John's Court");
  assert.equal(titleCase("12B EXAMPLE ROAD"), "12B Example Road");
  assert.equal(titleCase("UPPER-MAISONETTE"), "Upper-Maisonette");
});

test("an OS Places record becomes the first line of the address", () => {
  assert.equal(osFirstLine({ BUILDING_NUMBER: "12", THOROUGHFARE_NAME: "EXAMPLE ROAD" }), "12 Example Road");
  assert.equal(
    osFirstLine({ SUB_BUILDING_NAME: "FLAT 2", BUILDING_NAME: "ROSE COURT", BUILDING_NUMBER: "40", THOROUGHFARE_NAME: "EXAMPLE ROAD" }),
    "Flat 2, Rose Court, 40 Example Road",
  );
  assert.equal(osFirstLine({ BUILDING_NAME: "THE OLD FORGE", THOROUGHFARE_NAME: "MILL LANE" }), "The Old Forge, Mill Lane");
  // A home has no organisation name; an address that's only an organisation keeps it.
  assert.equal(osFirstLine({ ORGANISATION_NAME: "ACME LTD", BUILDING_NUMBER: "3", THOROUGHFARE_NAME: "HIGH STREET" }), "3 High Street");
  assert.equal(osFirstLine({ ORGANISATION_NAME: "ACME LTD" }), "Acme Ltd");
  // No structured fields: the one-line address without its town and postcode.
  assert.equal(osFirstLine({ ADDRESS: "7, EXAMPLE ROAD, LONDON, SW16 2BE", POST_TOWN: "LONDON", POSTCODE: "SW16 2BE" }), "7, Example Road");
});

test("OS Places wins over getAddress, template values count as unset", () => {
  assert.equal(addressProvider({ OS_PLACES_API_KEY: "os", GETADDRESS_API_KEY: "ga" })?.provider, "os-places");
  assert.equal(addressProvider({ GETADDRESS_API_KEY: "ga" })?.provider, "getaddress");
  assert.equal(addressProvider({ OS_PLACES_API_KEY: "your-os-places-key" }), null);
  assert.equal(addressProvider({}), null);
});

test("not configured: no call, the customer types", async () => {
  const { fetcher, calls } = fakeFetch([{}]);
  assert.deepEqual(await lookupAddresses("SW16 2BE", {}, fetcher), { configured: false, addresses: [] });
  assert.equal(calls.length, 0);
});

test("OS Places: one paid call for a normal postcode, sorted and de-duplicated, cached a day", async () => {
  const { fetcher, calls } = fakeFetch([
    {
      body: {
        header: { totalresults: 3 },
        results: [
          dpa({ BUILDING_NUMBER: "10", THOROUGHFARE_NAME: "EXAMPLE ROAD" }),
          dpa({ BUILDING_NUMBER: "2", THOROUGHFARE_NAME: "EXAMPLE ROAD" }),
          dpa({ BUILDING_NUMBER: "2", THOROUGHFARE_NAME: "EXAMPLE ROAD" }),
        ],
      },
    },
  ]);
  const result = await lookupAddresses("sw16 2be", { OS_PLACES_API_KEY: "k" }, fetcher);
  assert.deepEqual(result, { configured: true, provider: "os-places", addresses: ["2 Example Road", "10 Example Road"] });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://api.os.uk/search/places/v1/postcode");
  assert.equal(url.searchParams.get("postcode"), "SW162BE");
  assert.equal(url.searchParams.get("dataset"), "DPA");
  assert.equal(url.searchParams.get("key"), "k");
  assert.deepEqual(calls[0].init, { next: { revalidate: 86_400 } });
});

test("OS Places: a big block pages on, but never past three paid calls", async () => {
  const full = (from: number) => ({
    header: { totalresults: 450 },
    results: Array.from({ length: 100 }, (_, i) => dpa({ SUB_BUILDING_NAME: `FLAT ${from + i}`, BUILDING_NAME: "TALL HOUSE" })),
  });
  const { fetcher, calls } = fakeFetch([{ body: full(1) }, { body: full(101) }, { body: full(201) }, { body: full(301) }]);
  const result = await lookupAddresses("SW16 2BE", { OS_PLACES_API_KEY: "k" }, fetcher);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[1].url).searchParams.get("offset"), "100");
  assert.equal(result.addresses.length, 300);
  assert.equal(result.addresses[0], "Flat 1, Tall House");
});

test("OS Places: an unknown postcode is an empty list; an outage lets people type", async () => {
  const unknown = fakeFetch([{ status: 400, body: { error: { statuscode: 400 } } }]);
  assert.deepEqual(await lookupAddresses("SW16 9ZZ", { OS_PLACES_API_KEY: "k" }, unknown.fetcher), {
    configured: true,
    provider: "os-places",
    addresses: [],
  });
  const empty = fakeFetch([{ body: { header: { totalresults: 0 } } }]);
  assert.deepEqual((await lookupAddresses("SW16 9ZZ", { OS_PLACES_API_KEY: "k" }, empty.fetcher)).addresses, []);

  const original = console.error;
  console.error = () => {};
  try {
    const down = fakeFetch([{ status: 401 }]);
    assert.deepEqual(await lookupAddresses("SW16 2BE", { OS_PLACES_API_KEY: "bad" }, down.fetcher), { configured: false, addresses: [] });
    const thrown = await lookupAddresses("SW16 2BE", { OS_PLACES_API_KEY: "k" }, async () => {
      throw new Error("network");
    });
    assert.deepEqual(thrown, { configured: false, addresses: [] });
  } finally {
    console.error = original;
  }
});

test("getAddress.io still works when it's the only key", async () => {
  const { fetcher, calls } = fakeFetch([
    { body: { addresses: ["12 Example Road, , , , London, ", "Flat 1, 3 Example Road, , , London, "] } },
    // `find` lines are "line1, line2, line3, locality, town, county"; the first two filled parts are kept, as before.
  ]);
  const result = await lookupAddresses("SW16 2BE", { GETADDRESS_API_KEY: "ga" }, fetcher);
  assert.deepEqual(result, { configured: true, provider: "getaddress", addresses: ["12 Example Road, London", "Flat 1, 3 Example Road"] });
  assert.match(calls[0].url, /^https:\/\/api\.getaddress\.io\/find\/SW162BE\?api-key=ga&sort=true$/);
});
