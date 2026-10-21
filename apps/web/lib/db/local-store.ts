/**
 * Table persistence for the local data backend.
 *
 *   file    one JSON file per table in the data dir, written atomically
 *           (temp file, then rename) and cached in memory until its mtime
 *           or size changes, so another process's writes are picked up.
 *   memory  an in-process Map, gone when the process exits.
 *
 * Writes are serialised by one async mutex per data dir (per store for
 * memory). It lives on globalThis so Next.js module duplication (route
 * handlers, server components and actions can each load their own copy of
 * this module) still shares one lock and one cache. It is a per-process
 * lock: two processes writing the same file can still lose an update, which
 * is fine for a single dev or demo server.
 */

import { mkdir, readFile, rename, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Row } from "./local-schema.ts";
import { QueryError } from "./local-filters.ts";

export interface TableStore {
  readonly kind: "file" | "memory";
  /** Current rows. Shared with the cache: callers must not mutate them. */
  read(table: string): Promise<readonly Row[]>;
  /**
   * Serialised read-modify-write. `fn` gets the current rows and returns the
   * table's new rows (a new array; never mutate the input) plus a result.
   * Throwing aborts the write.
   */
  mutate<T>(table: string, fn: (rows: readonly Row[]) => { rows: Row[]; result: T }): Promise<T>;
  /** Runs `fn` under the store's write lock (storage uses it too). */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

export type Mutex = <T>(fn: () => Promise<T>) => Promise<T>;

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function assertTableName(table: string): void {
  if (!TABLE_NAME_RE.test(table)) {
    throw new QueryError("42P01", `relation "${table}" does not exist`, 404);
  }
}

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

export function createMemoryStore(): TableStore {
  const tables = new Map<string, Row[]>();
  const lock = createMutex();
  return {
    kind: "memory",
    async read(table) {
      assertTableName(table);
      return tables.get(table) ?? [];
    },
    mutate(table, fn) {
      assertTableName(table);
      return lock(async () => {
        const { rows, result } = fn(tables.get(table) ?? []);
        tables.set(table, rows);
        return result;
      });
    },
    exclusive: (fn) => lock(fn),
  };
}

/* ------------------------------------------------------------------ */
/* File                                                                */
/* ------------------------------------------------------------------ */

interface CachedTable {
  mtimeMs: number;
  size: number;
  rows: Row[];
}

interface FileDirState {
  lock: Mutex;
  cache: Map<string, CachedTable>;
}

const GLOBAL_KEY = Symbol.for("aircon.local-db.file-dirs");

function dirState(dir: string): FileDirState {
  const g = globalThis as unknown as Record<symbol, Map<string, FileDirState> | undefined>;
  const all = (g[GLOBAL_KEY] ??= new Map());
  let state = all.get(dir);
  if (!state) {
    state = { lock: createMutex(), cache: new Map() };
    all.set(dir, state);
  }
  return state;
}

/** One row per line: valid JSON, readable, and diff-friendly. */
export function serialiseRows(rows: readonly Row[]): string {
  if (rows.length === 0) return "[]\n";
  return `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;
}

/** Write to a temp file in the same directory, then rename over the target. */
export async function writeAtomic(file: string, contents: string | Uint8Array): Promise<void> {
  const tmp = `${file}.~tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await writeFile(tmp, contents);
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export function createFileStore(dir: string): TableStore {
  const state = dirState(dir);
  const fileFor = (table: string) => join(dir, `${table}.json`);

  async function load(table: string): Promise<Row[]> {
    assertTableName(table);
    const file = fileFor(table);
    let info;
    try {
      info = await stat(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        state.cache.delete(table);
        return [];
      }
      throw err;
    }
    const cached = state.cache.get(table);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.rows;

    const text = await readFile(file, "utf8");
    let rows: Row[];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not an array");
      rows = parsed as Row[];
    } catch (err) {
      throw new QueryError(
        "XX001",
        `local data file ${file} is corrupt (${(err as Error).message}); fix or delete it`,
        500,
      );
    }
    state.cache.set(table, { mtimeMs: info.mtimeMs, size: info.size, rows });
    return rows;
  }

  return {
    kind: "file",
    read: load,
    mutate(table, fn) {
      assertTableName(table);
      return state.lock(async () => {
        const current = await load(table);
        const { rows, result } = fn(current);
        if (rows !== current) {
          const file = fileFor(table);
          await mkdir(dir, { recursive: true });
          await writeAtomic(file, serialiseRows(rows));
          const info = await stat(file);
          state.cache.set(table, { mtimeMs: info.mtimeMs, size: info.size, rows });
        }
        return result;
      });
    },
    exclusive: (fn) => state.lock(fn),
  };
}
