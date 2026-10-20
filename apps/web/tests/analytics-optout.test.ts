import { test } from "node:test";
import assert from "node:assert/strict";

// Usage analytics can be turned off in a browser (PECR reg 6: the identifier is
// storage on the device, and not strictly necessary). A fake browser: storage,
// location and the beacon, so nothing leaves the test.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  keys() {
    return [...this.map.keys()];
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
const beacons: string[] = [];
const g = globalThis as Record<string, unknown>;
g.window = { localStorage: local, sessionStorage: session, location: { search: "?utm_source=leaflet", pathname: "/" }, innerWidth: 390 };
g.document = { referrer: "" };
Object.defineProperty(globalThis, "navigator", {
  value: { sendBeacon: (_url: string, body: string) => (beacons.push(body), true) },
  configurable: true,
  writable: true,
});

const analytics = await import("../lib/analytics-client.ts");

test("on by default: an identifier and the first touch are kept, and events are sent", () => {
  analytics.track("page_view");
  assert.equal(beacons.length, 1);
  assert.ok(local.getItem("aircon.vid"), "a visitor id");
  assert.equal(analytics.getAttribution().utmSource, "leaflet");
});

test("off: what was stored is removed, nothing more is stored and no event is sent", () => {
  analytics.setAnalyticsOptOut(true);
  assert.equal(analytics.analyticsOptedOut(), true);
  assert.deepEqual(local.keys(), ["aircon.analytics-off"], "only the choice itself is kept");
  assert.equal(session.getItem("aircon.sid"), null);
  analytics.track("page_view");
  assert.equal(beacons.length, 1, "no new event");
  assert.equal(analytics.getVisitorId(), "");
  assert.deepEqual(analytics.getAttribution(), {}, "a saved quote carries no attribution either");
  assert.deepEqual(local.keys(), ["aircon.analytics-off"]);

  // And back on again.
  analytics.setAnalyticsOptOut(false);
  assert.equal(analytics.analyticsOptedOut(), false);
  analytics.track("page_view");
  assert.equal(beacons.length, 2);
});

test("the browser's Global Privacy Control signal counts as off", () => {
  (globalThis.navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
  assert.equal(analytics.privacySignalOn(), true);
  assert.equal(analytics.analyticsOptedOut(), true);
  const before = beacons.length;
  analytics.track("page_view");
  assert.equal(beacons.length, before);
  (globalThis.navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl = false;
});

test("analytics keep how far a visitor got, never the postcode they typed or the quote's price", async () => {
  const { analyticsMeta } = await import("../lib/analytics-meta.ts");
  assert.deepEqual(analyticsMeta({ status: "saved", rooms: 3, postcode: "SW16 2BE", totalGbp: 6123, marketing: true }), { status: "saved", rooms: 3 });
  assert.equal(analyticsMeta({ postcode: "SW16 2BE" }), null);
  assert.equal(analyticsMeta(undefined), null);
  assert.deepEqual(analyticsMeta({ step: "house", to: "rooms" }), { step: "house", to: "rooms" });
  // The quote form itself no longer sends them.
  const { readFileSync } = await import("node:fs");
  const wizard = readFileSync(new URL("../components/quote/wizard.tsx", import.meta.url), "utf8");
  for (const call of wizard.match(/track\("[^"]+",\s*\{[^}]*\}/g) ?? []) assert.doesNotMatch(call, /postcode|totalGbp|marketing/, call);
});
