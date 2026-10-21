import { test } from "node:test";
import assert from "node:assert/strict";
import { generateQuote, type Survey } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { quoteEmail } = await import("../lib/email.ts");
const { newDraft, normaliseDraft, withUploadedPhotosOnly, mapSurveyPhotos } = await import("../lib/quote-draft.ts");

const base = {
  name: "Sam <script>",
  link: "https://dang.ac/q/1234",
  totalGbp: 7615,
  roomCount: 5,
  validUntil: "2026-11-17",
  installDays: "up to three days",
  vatLine: "No VAT to add",
  surveyPrice: "Free",
  surveyDuration: "about 90 minutes",
  supportEmail: "hello@dang.ac",
  supportPhone: null,
};

test("quote email: honest promise, validity date, one next step, escaped name", () => {
  const { subject, html } = quoteEmail(base);
  assert.equal(subject, "Your price: £7,615 for 5 rooms");
  assert.match(html, /valid until 17 Nov 2026/);
  assert.match(html, /confirm this price at your home survey/);
  assert.match(html, /book your home survey/);
  assert.match(html, /Installed over up to three days/);
  assert.ok(html.includes("Sam &lt;script&gt;"), "the customer's name is escaped");
  assert.doesNotMatch(html, /doesn't expire|guarantee|fixed price|price locked|single day|finance|warranty/i);
  assert.doesNotMatch(html, /0800 000 0000/);
});

test("quote email: phone only when real, VAT line only when settings give one", () => {
  const withPhone = quoteEmail({ ...base, supportPhone: "020 8123 4567", vatLine: null }).html;
  assert.match(withPhone, /call 020 8123 4567/);
  assert.doesNotMatch(withPhone, /VAT/);
  const paid = quoteEmail({ ...base, surveyPrice: "£150" }).html;
  assert.match(paid, /\(£150, about 90 minutes\)/);
});

const survey = (): Survey => ({
  ...newDraft("SW16 2BE").survey,
  addressLine: "12 Example Road",
  rooms: [
    {
      id: "r1",
      name: "Bedroom",
      type: "bedroom",
      size: "medium",
      floor: "first",
      glazing: "medium",
      orientation: "unsure",
      hasExternalWall: true,
      photos: [
        { id: "p1", kind: "room", storagePath: "11111111-1111-1111-1111-111111111111/room-a.jpg" },
        { id: "p2", kind: "room" },
      ],
    },
  ],
  outdoor: { location: "ground-rear", photos: [{ id: "p3", kind: "outdoor-location" }] },
  electrics: { condition: "modern-spare-ways", photos: [{ id: "p4", kind: "fuse-board", storagePath: "x/fuse-board-b.jpg" }] },
});

test("only uploaded photos count, so a failed upload can't raise confidence", () => {
  const all = survey();
  const kept = withUploadedPhotosOnly(all);
  assert.deepEqual(kept.rooms[0]!.photos.map((p) => p.id), ["p1"]);
  assert.deepEqual(kept.outdoor.photos, []);
  assert.equal(kept.electrics.photos.length, 1);
  assert.ok(generateQuote(kept).confidence.score < generateQuote(all).confidence.score);
});

test("an upload result is recorded on the right photo wherever it sits", () => {
  const s = mapSurveyPhotos(survey(), (p) => (p.id === "p3" ? { ...p, storagePath: "y/outdoor-location-c.jpg" } : p));
  assert.equal(s.outdoor.photos[0]!.storagePath, "y/outdoor-location-c.jpg");
  assert.equal(s.rooms[0]!.photos[1]!.storagePath, undefined);
});

test("a stored draft is normalised: defaults filled, step kept, unsaved photos dropped, junk refused", () => {
  const stored = { ...newDraft(), survey: survey(), contact: { name: "Sam" }, step: 3 };
  const d = normaliseDraft(JSON.parse(JSON.stringify(stored)))!;
  assert.equal(d.step, 3);
  assert.equal(d.contact.email, "", "missing contact fields take defaults");
  assert.equal(d.contact.timeframe, "1-3-months");
  assert.deepEqual(d.survey.rooms[0]!.photos.map((p) => p.id), ["p1"]);
  assert.equal(normaliseDraft(null), null);
  assert.equal(normaliseDraft({ survey: "nope" }), null);
  assert.equal(normaliseDraft({ ...stored, step: -1 })!.step, undefined);
});

test("postcode step: an unknown postcode in an outcode we cover is a soft note, not a dead end", async () => {
  const { postcodeOutcome } = await import("../components/quote/postcode-outcome.ts");
  // A new build in SW16 that postcodes.io doesn't know yet: they carry on.
  assert.deepEqual(postcodeOutcome(true, "not-found", true), { inArea: true, outOfArea: false, unverified: true, unknown: false });
  // Outside our area, unknown: most likely a typo, so they check it (no waitlist for a postcode that may not exist).
  assert.deepEqual(postcodeOutcome(true, "not-found", false), { inArea: false, outOfArea: false, unverified: false, unknown: true });
  // Known, or the lookup unreachable: coverage alone decides.
  assert.deepEqual(postcodeOutcome(true, "found", true), { inArea: true, outOfArea: false, unverified: false, unknown: false });
  assert.deepEqual(postcodeOutcome(true, "offline", false), { inArea: false, outOfArea: true, unverified: false, unknown: false });
  // Still typing, or checking: nothing yet.
  assert.equal(postcodeOutcome(false, "found", true).inArea, false);
  assert.equal(postcodeOutcome(true, "checking", true).inArea, false);
});
