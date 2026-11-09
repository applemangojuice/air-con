/**
 * Read files out of a zip without unzipping it to disk.
 *
 * The government's EPC download is one zip (8.6 GB) holding one CSV per year,
 * far bigger unzipped than most laptops have room for. This reads the zip's
 * table of contents from the end of the file, then streams each CSV straight
 * out of the zip and through the browser's built-in decompressor, a piece at
 * a time. Nothing is written to disk and only a few megabytes are in memory.
 *
 * Handles ZIP64 (archives and files over 4 GB), "stored" and "deflate"
 * entries: what the EPC zip and almost every zip tool use. Anything else
 * (Deflate64, encryption, split archives) is refused with a plain reason.
 *
 * Uses only Blob, DataView and DecompressionStream, so it runs in the browser
 * and in Node (tests open real zips with fs.openAsBlob).
 */

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  encrypted: boolean;
}

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

async function bytes(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

function u64(view: DataView, offset: number): number {
  const big = view.getBigUint64(offset, true);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError("This zip is too large to read.");
  return Number(big);
}

const METHOD_NAMES: Record<number, string> = { 9: "Deflate64", 12: "BZIP2", 14: "LZMA", 93: "Zstandard", 95: "XZ" };

/** The files in a zip, from its table of contents (reads only the end of the file). */
export async function listZipEntries(file: Blob): Promise<ZipEntry[]> {
  // The end record is in the last 22 bytes plus up to 64 KB of comment.
  const tailStart = Math.max(0, file.size - (22 + 65_535));
  const tail = await bytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This doesn't look like a zip file (no table of contents at its end). Was the download complete?");

  if (tail.getUint16(eocd + 4, true) !== 0 || tail.getUint16(eocd + 6, true) !== 0) {
    throw new ZipError("This zip is split into several parts, which isn't supported.");
  }
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // ZIP64: a locator sits just before the end record and points at the real one.
  const locatorAt = eocd - 20;
  if (locatorAt >= 0 && tail.getUint32(locatorAt, true) === ZIP64_LOCATOR_SIG) {
    const z64Offset = u64(tail, locatorAt + 8);
    const z64 = await bytes(file, z64Offset, z64Offset + 56);
    if (z64.getUint32(0, true) !== ZIP64_EOCD_SIG) throw new ZipError("This zip's large-file table of contents is damaged.");
    count = u64(z64, 32);
    cdSize = u64(z64, 40);
    cdOffset = u64(z64, 48);
  }
  if (cdOffset + cdSize > file.size) throw new ZipError("This zip is cut short. Was the download complete?");

  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL_SIG) {
      throw new ZipError("This zip's table of contents is damaged.");
    }
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let uncompressedSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

    // ZIP64 extra field: the 64-bit values, only for those set to 0xFFFFFFFF above, in this order.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const size = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) {
          uncompressedSize = u64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(cd, q);
      }
      e += 4 + size;
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset, encrypted: (flags & 1) === 1 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Why an entry can't be read, or null when it can. */
export function zipEntryProblem(entry: ZipEntry): string | null {
  if (entry.encrypted) return `${entry.name} is password-protected.`;
  if (entry.method !== 0 && entry.method !== 8) {
    const how = METHOD_NAMES[entry.method] ?? `method ${entry.method}`;
    return `${entry.name} is compressed with ${how}, which browsers can't unpack.`;
  }
  return null;
}

/**
 * An entry's contents, decompressed, as a stream of bytes. `onRead` hears how
 * many bytes of the zip itself have been read, for an honest progress bar.
 */
export async function openZipEntry(
  file: Blob,
  entry: ZipEntry,
  onRead?: (compressedBytes: number) => void,
): Promise<ReadableStream<Uint8Array>> {
  const problem = zipEntryProblem(entry);
  if (problem) throw new ZipError(problem);
  // The local header repeats the name and has its own extra field; the data follows it.
  const local = await bytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (local.getUint32(0, true) !== LOCAL_SIG) throw new ZipError(`${entry.name}: the zip is damaged at this file.`);
  const dataStart = entry.localHeaderOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  let raw = file.slice(dataStart, dataStart + entry.compressedSize).stream() as ReadableStream<Uint8Array>;
  if (onRead) {
    raw = raw.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          onRead(chunk.byteLength);
          controller.enqueue(chunk);
        },
      }),
    );
  }
  if (entry.method === 0) return raw;
  return raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

/** Read an entry's first line (its CSV header) and stop, without unpacking the rest. */
export async function readZipEntryFirstLine(file: Blob, entry: ZipEntry, maxBytes = 1_000_000): Promise<string> {
  const reader = (await openZipEntry(file, entry)).getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const nl = text.indexOf("\n");
      if (nl >= 0) return text.slice(0, nl).replace(/\r$/, "");
    }
    return text;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
