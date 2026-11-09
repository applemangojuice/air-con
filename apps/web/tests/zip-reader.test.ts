import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();
const { listZipEntries, openZipEntry, readZipEntryFirstLine, zipEntryProblem, ZipError } = await import("../lib/zip-reader.ts");

/**
 * A small zip writer for the tests: stored or deflate entries, and with
 * `zip64` the large-file layout (64-bit sizes and offsets in extra fields, and
 * the ZIP64 end records) that archives over 4 GB use.
 */
function makeZip(files: { name: string; text: string; method?: 0 | 8 }[], opts: { zip64?: boolean; comment?: string } = {}) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.text, "utf8");
    const method = f.method ?? 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(opts.zip64 ? 0xffffffff : data.length, 18);
    local.writeUInt32LE(opts.zip64 ? 0xffffffff : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localExtra = opts.zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (opts.zip64) {
      localExtra.writeUInt16LE(1, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(raw.length), 4);
      localExtra.writeBigUInt64LE(BigInt(data.length), 12);
    }
    local.writeUInt16LE(localExtra.length, 28);
    parts.push(local, name, localExtra, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(45, 4);
    cd.writeUInt16LE(45, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(opts.zip64 ? 0xffffffff : data.length, 20);
    cd.writeUInt32LE(opts.zip64 ? 0xffffffff : raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    const cdExtra = opts.zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (opts.zip64) {
      cdExtra.writeUInt16LE(1, 0);
      cdExtra.writeUInt16LE(24, 2);
      cdExtra.writeBigUInt64LE(BigInt(raw.length), 4);
      cdExtra.writeBigUInt64LE(BigInt(data.length), 12);
      cdExtra.writeBigUInt64LE(BigInt(offset), 20);
    }
    cd.writeUInt16LE(cdExtra.length, 30);
    cd.writeUInt32LE(opts.zip64 ? 0xffffffff : offset, 42);
    central.push(cd, name, cdExtra);
    offset += local.length + name.length + localExtra.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const cdOffset = offset;
  const tail: Buffer[] = [];
  if (opts.zip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeBigUInt64LE(BigInt(files.length), 24);
    z.writeBigUInt64LE(BigInt(files.length), 32);
    z.writeBigUInt64LE(BigInt(cdBuf.length), 40);
    z.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdBuf.length), 8);
    loc.writeUInt32LE(1, 16);
    tail.push(z, loc);
  }
  const comment = Buffer.from(opts.comment ?? "", "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(opts.zip64 ? 0xffff : files.length, 8);
  end.writeUInt16LE(opts.zip64 ? 0xffff : files.length, 10);
  end.writeUInt32LE(opts.zip64 ? 0xffffffff : cdBuf.length, 12);
  end.writeUInt32LE(opts.zip64 ? 0xffffffff : cdOffset, 16);
  end.writeUInt16LE(comment.length, 20);
  return new Blob([...parts, cdBuf, ...tail, end, comment].map((b) => new Uint8Array(b)));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

const CSV_A = "LMK_KEY,ADDRESS1,POSTCODE\r\na,12 Example Road,SW16 1AD\r\nb,\"Flat 2, Rose Court\",SW17 2FJ\r\n";
const CSV_B = "LMK_KEY,ADDRESS1,POSTCODE\r\n" + "x,1 Far Road,M1 1AA\r\n".repeat(5000);

for (const zip64 of [false, true]) {
  test(`lists and streams entries out of a zip${zip64 ? " (ZIP64 layout)" : ""}`, async () => {
    const zip = makeZip(
      [
        { name: "certificates-2012.csv", text: CSV_A },
        { name: "certificates-2013.csv", text: CSV_B, method: 0 },
      ],
      { zip64, comment: "EPC bulk download" },
    );
    const entries = await listZipEntries(zip);
    assert.deepEqual(
      entries.map((e) => [e.name, e.method, e.uncompressedSize]),
      [
        ["certificates-2012.csv", 8, Buffer.byteLength(CSV_A)],
        ["certificates-2013.csv", 0, Buffer.byteLength(CSV_B)],
      ],
    );
    assert.equal(await readAll(await openZipEntry(zip, entries[0])), CSV_A);
    assert.equal(await readAll(await openZipEntry(zip, entries[1])), CSV_B);
    assert.equal(await readZipEntryFirstLine(zip, entries[1]), "LMK_KEY,ADDRESS1,POSTCODE");
  });
}

test("a damaged, cut-short or non-zip file is refused with a reason", async () => {
  await assert.rejects(listZipEntries(new Blob(["just,a,csv\n1,2,3\n"])), ZipError);
  const good = makeZip([{ name: "a.csv", text: CSV_A }]);
  const buf = new Uint8Array(await good.arrayBuffer());
  // Cut the middle out: the table of contents now points past the data.
  const cut = new Blob([buf.slice(0, 10), buf.slice(buf.length - 22)]);
  await assert.rejects(listZipEntries(cut), /cut short|damaged/);
});

test("compression browsers can't unpack, and passwords, are named", () => {
  const base = { name: "certificates-2020.csv", compressedSize: 1, uncompressedSize: 1, localHeaderOffset: 0, encrypted: false };
  assert.equal(zipEntryProblem({ ...base, method: 8 }), null);
  assert.equal(zipEntryProblem({ ...base, method: 0 }), null);
  assert.match(zipEntryProblem({ ...base, method: 9 }) ?? "", /Deflate64/);
  assert.match(zipEntryProblem({ ...base, method: 8, encrypted: true }) ?? "", /password/);
});
