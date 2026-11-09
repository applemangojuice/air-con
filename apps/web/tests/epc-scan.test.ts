import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { mapEpcColumns } = await import("../lib/epc-import.ts");
const { HomeCounter, LondonTally, areaOf, fieldAt, formatBytes, isLondonOutcode, BYTES_PER_HOME } = await import("../lib/epc-scan.ts");

test("one field is read without splitting the row, quotes and all", () => {
  const raw = 'a,"Flat 2, ""Rose"" Court",12 Road,,SW16 1AD,LONDON,"x, y",9';
  assert.equal(fieldAt(raw, 0), "a");
  assert.equal(fieldAt(raw, 1), 'Flat 2, "Rose" Court');
  assert.equal(fieldAt(raw, 2), "12 Road");
  assert.equal(fieldAt(raw, 3), "");
  assert.equal(fieldAt(raw, 4), "SW16 1AD");
  assert.equal(fieldAt(raw, 6), "x, y");
  assert.equal(fieldAt(raw, 7), "9");
  assert.equal(fieldAt(raw, 20), "", "past the end");
});

test("London areas", () => {
  assert.equal(areaOf("SW16"), "SW");
  assert.equal(areaOf("EC1A"), "EC");
  assert.equal(areaOf("E3"), "E");
  for (const o of ["SW16", "SE19", "CR0", "E3", "EC1A", "WC2N", "N1", "NW3", "W2", "UB7"]) assert.ok(isLondonOutcode(o), o);
  for (const o of ["M1", "S1", "SL1", "LS2", "B1", "WD17", "ME1"]) assert.ok(!isLondonOutcode(o), o);
});

test("the home counter is within a few percent at every size, and merges as a union", () => {
  for (const n of [10, 1_000, 20_000, 300_000]) {
    const c = new HomeCounter();
    for (let i = 0; i < n; i++) c.add(`u${100_000_000 + i}`);
    for (let i = 0; i < n; i += 3) c.add(`u${100_000_000 + i}`); // repeats don't count
    const err = Math.abs(c.estimate() - n) / n;
    assert.ok(err < 0.05, `${n}: estimated ${c.estimate()}`);
  }
  const a = new HomeCounter();
  const b = new HomeCounter();
  for (let i = 0; i < 6_000; i++) a.add(`h${i}`);
  for (let i = 3_000; i < 9_000; i++) b.add(`h${i}`);
  a.merge(b);
  assert.ok(Math.abs(a.estimate() - 9_000) / 9_000 < 0.06, `union ${a.estimate()}`);
  assert.equal(HomeCounter.fromBase64(a.toBase64()).estimate(), a.estimate(), "survives being stored");
});

const HEADER = "certificate_number,address1,address2,address3,postcode,posttown,current_energy_rating,uprn".split(",");
const cols = mapEpcColumns(HEADER);

test("the tally counts London districts only, a home once however many certificates it has", () => {
  const t = new LondonTally();
  const rows = [
    "c1,12 Example Road,,,SW16 1AD,LONDON,D,1001",
    "c2,12 Example Road,,,SW16 1AD,LONDON,C,1001", // same home, newer certificate
    'c3,"Flat 1, Rose Court",3 Mill Lane,,SW16 2BE,LONDON,E,', // no UPRN: by address
    'c4,"Flat 1, Rose Court",3 Mill Lane,,SW16 2BE,LONDON,D,',
    "c5,1 High Street,,,SW2 1AA,LONDON,C,2001",
    "c6,9 Far Road,,,M1 1AA,MANCHESTER,C,3001",
    "c7,1 Hill,,,CR0 1AB,CROYDON,B,4001",
  ];
  const london = rows.map((r) => t.addRow(r, cols));
  assert.deepEqual(london, [true, true, true, true, true, false, true]);
  const d = t.districts();
  assert.deepEqual(
    d.map((x) => [x.outcode, x.certificates, x.homes]),
    [
      ["CR0", 1, 1],
      ["SW2", 1, 1],
      ["SW16", 4, 2],
    ],
  );
  assert.equal(d[2].bytes, 2 * BYTES_PER_HOME);

  // Stored and brought back (a resumed count), then merged with more files' counts.
  const again = LondonTally.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const more = new LondonTally();
  more.addRow("c8,12 Example Road,,,SW16 1AD,LONDON,B,1001", cols); // a home already counted
  more.addRow("c9,40 New Road,,,SW16 1AD,LONDON,B,1002", cols);
  again.merge(more);
  assert.deepEqual(
    again.districts().find((x) => x.outcode === "SW16"),
    { outcode: "SW16", certificates: 6, homes: 3, bytes: 3 * BYTES_PER_HOME },
  );
});

test("sizes read naturally", () => {
  assert.equal(formatBytes(1_500_000), "1.5 MB");
  assert.equal(formatBytes(340_000_000), "340 MB");
  assert.equal(formatBytes(2_300_000_000), "2.3 GB");
});
