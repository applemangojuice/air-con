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

test("quote email: no name yet reads 'Hi,' not 'Hi ,'", () => {
  const { html } = quoteEmail({ ...base, name: "" });
  assert.match(html, />Hi,</);
  assert.doesNotMatch(html, /Hi ,/);
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

test("address matching: a bare house number finds its street, ambiguity stays as typed", async () => {
  const { matchHouse } = await import("../lib/address-lookup.ts");
  const known = [
    { line1: "12 Example Road", intelId: "i-12" },
    { line1: "112 Example Road" },
    { line1: "12a Example Road" },
    { line1: "Flat 1, 14 Example Road" },
    { line1: "Flat 2, 14 Example Road" },
    { line1: "Rose Cottage, Example Road" },
  ];
  assert.equal(matchHouse("12", known)?.intelId, "i-12", "12 is 12, not 112 or 12a");
  assert.equal(matchHouse("12A", known)?.line1, "12a Example Road");
  assert.equal(matchHouse("12 example road", known)?.intelId, "i-12", "a full line matches itself, whatever the case");
  assert.equal(matchHouse("rose cottage", known)?.line1, "Rose Cottage, Example Road");
  assert.equal(matchHouse("14", known), undefined, "two flats at 14: let them say which");
  assert.equal(matchHouse("", known), undefined);
  assert.equal(matchHouse("12", []), undefined);
});

test("a draft remembers where its prefill came from", () => {
  const stored = { ...newDraft("SW16 2BE"), prefillSource: "neighbours" as const, configured: true };
  const d = normaliseDraft(JSON.parse(JSON.stringify(stored)))!;
  assert.equal(d.prefillSource, "neighbours");
  assert.equal(normaliseDraft(JSON.parse(JSON.stringify(newDraft())))!.prefillSource, undefined);
});

test("room plan: switch a room off and it stays off, in place, when the answers change", async () => {
  const { addBedroom, addLivingRoom, allRooms, canAddLivingRoom, configure, declineRoom, declinedFromSaved, includeRoom, roomsPhrase } = await import("../lib/room-plan.ts");
  const start = configure({ ...newDraft("SW16 2BE"), survey: { ...newDraft("SW16 2BE").survey, addressLine: "12 Example Road" } });
  const names = (d: typeof start) => d.survey.rooms.map((r) => r.name);
  assert.deepEqual(names(start), ["Living room", "Kitchen", "Main bedroom", "Bedroom 2", "Bedroom 3"]);
  assert.equal(roomsPhrase(start.survey.rooms), "3 bedrooms, a kitchen and a living room");

  const b3 = start.survey.rooms.find((r) => r.name === "Bedroom 3")!;
  const off = declineRoom(start, b3.id);
  assert.equal(roomsPhrase(off.survey.rooms), "2 bedrooms, a kitchen and a living room");
  assert.deepEqual(allRooms(off).map((x) => [x.room.name, x.included]).at(-1), ["Bedroom 3", false], "still listed, in its place");
  assert.ok(generateQuote(off.survey).totalGbp < generateQuote(start.survey).totalGbp, "the price follows");

  // Changing the size re-lays the rooms; Bedroom 3 stays off.
  const resized = configure({ ...off, survey: { ...off.survey, property: { ...off.survey.property, floorAreaM2: 130 } } });
  assert.ok(!names(resized).includes("Bedroom 3"));
  assert.equal(includeRoom(resized, resized.declinedRooms![0]!.id).survey.rooms.at(-1)!.name, "Bedroom 3", "back where it was");

  // + Bedroom brings back the one switched off first, then adds another.
  assert.ok(names(addBedroom(off)).includes("Bedroom 3"));
  assert.ok(names(addBedroom(start)).includes("Bedroom 4"));
  // + Living room makes it two living rooms, once.
  const two = addLivingRoom(start);
  assert.equal(two.layout, "two-receptions");
  assert.equal(roomsPhrase(two.survey.rooms), "3 bedrooms, a kitchen and 2 living rooms");
  assert.equal(canAddLivingRoom(two), false);
  // Open plan reads as one space.
  assert.equal(roomsPhrase(configure({ ...start, layout: "open-plan" }).survey.rooms), "3 bedrooms and an open-plan kitchen and living area");
  // A resumed draft knows which generated rooms were switched off.
  assert.deepEqual(declinedFromSaved({ ...off, declinedRooms: undefined }).map((r) => r.name), ["Bedroom 3"]);
  assert.equal(roomsPhrase([]), "no rooms yet");
});
